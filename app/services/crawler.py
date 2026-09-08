import re
import xml.etree.ElementTree as ET
from typing import List, Optional
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from app.config import settings

SCRAPERAPI_ENDPOINT = "https://api.scraperapi.com/"

# Fixed: catches BOTH [param] (Next.js) and {param} (Express) dynamic routes
DYNAMIC_ROUTE_RE = re.compile(r"/(\[[^\]]+\]|\{[^\}]+\})")

# Cloudflare markers for crawler detection
CLOUDFLARE_MARKERS = [
    "just a moment",
    "checking your browser",
    "verify you are human",
    "performing security verification",
    "enable javascript and cookies to continue",
]


def _is_cloudflare_html(html: str) -> bool:
    """Return True if the response is a Cloudflare challenge page."""
    if not html:
        return True
    sample = html[:3000].lower()
    return any(marker in sample for marker in CLOUDFLARE_MARKERS)


def _normalize_path(url: str) -> str:
    """Extract and normalize the path from a URL for cross-domain comparison."""
    try:
        parsed = urlparse(url)
        path = parsed.path.rstrip("/") or "/"
        return path.lower()
    except Exception:
        return "/"


def _is_dynamic_route(path: str) -> bool:
    """
    Return True if the path contains a dynamic segment.
    Catches both [param] (Next.js) and {param} (Express/other) styles.
    """
    return bool(DYNAMIC_ROUTE_RE.search(path))


async def _fetch_direct(url: str, timeout: float = 20.0) -> Optional[str]:
    """Fetch a URL directly without ScraperAPI (used for sitemaps)."""
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        try:
            response = await client.get(url)
            if response.status_code == 200:
                return response.text
        except Exception:
            pass
    return None


async def _try_sitemap(base_url: str, limit: int) -> List[str]:
    """
    Attempt to retrieve the page list from /sitemap.xml.
    Handles both standard sitemaps and sitemap index files.
    """
    parsed = urlparse(base_url)
    sitemap_url = f"{parsed.scheme}://{parsed.netloc}/sitemap.xml"

    content = await _fetch_direct(sitemap_url)
    if not content:
        return []

    try:
        root = ET.fromstring(content)
        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}

        # Sitemap index — points to multiple sub-sitemaps
        sub_sitemaps = root.findall(".//sm:sitemap/sm:loc", ns)
        if sub_sitemaps:
            urls: List[str] = []
            for sub in sub_sitemaps[:3]:
                sub_content = await _fetch_direct(sub.text.strip())
                if sub_content:
                    try:
                        sub_root = ET.fromstring(sub_content)
                        for loc in sub_root.findall(".//sm:loc", ns):
                            urls.append(loc.text.strip())
                            if len(urls) >= limit:
                                return urls
                    except Exception:
                        pass
            return urls[:limit]

        # Standard sitemap
        urls = [loc.text.strip() for loc in root.findall(".//sm:loc", ns)]
        return urls[:limit]

    except Exception:
        return []


def _extract_links(html: str, parsed_base, base_domain: str) -> set:
    """Extract all same-domain links from an HTML page."""
    soup = BeautifulSoup(html, "lxml")
    urls = set()

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith("#"):
            continue
        if href.startswith("mailto:") or href.startswith("tel:"):
            continue
        full_url    = urljoin(base_domain, href)
        parsed_href = urlparse(full_url)
        if parsed_href.netloc == parsed_base.netloc:
            clean = (
                f"{parsed_href.scheme}://{parsed_href.netloc}"
                f"{parsed_href.path.rstrip('/')}"
            )
            if clean:
                urls.add(clean)

    return urls


async def _crawl_homepage_links(base_url: str, limit: int) -> List[str]:
    """
    Fallback: extract all internal links from the homepage.
    Tries standard ScraperAPI first (1 credit).
    If Cloudflare is detected, retries with ultra_premium (30 credits).
    """
    parsed_base = urlparse(base_url)
    base_domain = f"{parsed_base.scheme}://{parsed_base.netloc}"

    found_urls = set()
    found_urls.add(base_url.rstrip("/") or base_url)

    html = None

    # ── Try standard ScraperAPI first (1 credit) ──────────────────────────────
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.get(
                SCRAPERAPI_ENDPOINT,
                params={
                    "api_key": settings.SCRAPERAPI_KEY,
                    "url":     base_url,
                    "render":  "false",
                },
            )
            html = response.text
            print(
                f"[crawler] Standard ScraperAPI returned "
                f"{len(html):,} chars for {base_url}"
            )
        except Exception as e:
            print(f"[crawler] Standard ScraperAPI failed for {base_url}: {e}")

    # ── If Cloudflare blocked or response too small, try ultra_premium ─────────
    if not html or _is_cloudflare_html(html) or len(html) < 5000:
        print(
            f"[crawler] Standard ScraperAPI insufficient for {base_url} "
            f"— trying ultra_premium (30 credits)"
        )
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                up_response = await client.get(
                    SCRAPERAPI_ENDPOINT,
                    params={
                        "api_key":       settings.SCRAPERAPI_KEY,
                        "url":           base_url,
                        "render":        "false",
                        "ultra_premium": "true",
                    },
                )
                if not _is_cloudflare_html(up_response.text):
                    html = up_response.text
                    print(
                        f"[crawler] ultra_premium returned "
                        f"{len(html):,} chars for {base_url}"
                    )
                else:
                    print(
                        f"[crawler] ultra_premium also got Cloudflare "
                        f"for {base_url}"
                    )
            except Exception as e:
                print(
                    f"[crawler] ultra_premium failed for {base_url}: {e}"
                )

    # ── Extract links from whichever HTML we have ─────────────────────────────
    if html and not _is_cloudflare_html(html):
        links = _extract_links(html, parsed_base, base_domain)
        found_urls.update(links)
        print(
            f"[crawler] Found {len(found_urls):,} links "
            f"for {base_url}"
        )

    return list(found_urls)[:limit]


async def get_pages(base_url: str, limit: int = 100) -> dict:
    """
    Get all pages from a site.
    Tries sitemap.xml first, falls back to crawling homepage links.
    """
    pages  = await _try_sitemap(base_url, limit)
    method = "sitemap"

    if len(pages) < 3:
        pages  = await _crawl_homepage_links(base_url, limit)
        method = "crawl"

    return {
        "success": True,
        "pages":   pages,
        "method":  method,
        "count":   len(pages),
    }


def compare_page_lists(
    ple_pages: List[str],
    evona_pages: List[str],
    ple_base: str,
    evona_base: str,
) -> dict:
    """
    Compare page paths between PLE and EVONA.
    Normalizes all URLs to paths so different domains can be compared.
    Filters both [param] and {param} dynamic route patterns from comparison
    so they do not inflate the missing/extra counts.
    """
    ple_paths = set(
        _normalize_path(p) for p in ple_pages
        if not _is_dynamic_route(_normalize_path(p))
    )
    evona_paths = set(
        _normalize_path(p) for p in evona_pages
        if not _is_dynamic_route(_normalize_path(p))
    )

    missing = sorted(ple_paths - evona_paths)
    extra   = sorted(evona_paths - ple_paths)
    matched = sorted(ple_paths & evona_paths)

    coverage = (
        round(len(matched) / len(ple_paths) * 100) if ple_paths else 0
    )

    return {
        "ple_page_count":     len(ple_paths),
        "evona_page_count":   len(evona_paths),
        "matched_count":      len(matched),
        "missing_count":      len(missing),
        "extra_count":        len(extra),
        "coverage_percent":   coverage,
        "missing_from_evona": missing[:50],
        "extra_in_evona":     extra[:20],
        "matched_pages":      matched[:30],
    }
