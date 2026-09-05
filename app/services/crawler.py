import xml.etree.ElementTree as ET
from typing import List, Optional
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from app.config import settings

SCRAPERAPI_ENDPOINT = "https://api.scraperapi.com/"


def _normalize_path(url: str) -> str:
    """Extract and normalize the path from a URL for cross-domain comparison."""
    try:
        parsed = urlparse(url)
        path = parsed.path.rstrip("/") or "/"
        return path.lower()
    except Exception:
        return "/"


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


async def _crawl_homepage_links(base_url: str, limit: int) -> List[str]:
    """
    Fallback: extract all internal links from the homepage
    when no sitemap is available.
    """
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
            soup        = BeautifulSoup(response.text, "lxml")
            parsed_base = urlparse(base_url)
            base_domain = f"{parsed_base.scheme}://{parsed_base.netloc}"

            urls = set()
            urls.add(base_url.rstrip("/"))

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

                if len(urls) >= limit:
                    break

            return list(urls)

        except Exception:
            return [base_url]


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
    Example: https://ple.com/rings/ and https://brand.evona.app/rings/
    both normalize to /rings/ and are counted as a match.
    """
    ple_paths   = set(_normalize_path(p) for p in ple_pages)
    evona_paths = set(_normalize_path(p) for p in evona_pages)

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