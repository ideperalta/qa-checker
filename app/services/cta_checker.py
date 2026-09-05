import asyncio
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup


def _normalize_path(url: str) -> str:
    """Extract normalized path from a full URL."""
    if not url:
        return ""
    try:
        parsed = urlparse(url)
        return parsed.path.rstrip("/").lower() or "/"
    except Exception:
        return ""


def extract_ctas(html: str, base_url: str) -> list:
    """
    Extract all CTAs (anchor links and buttons) from a page's HTML.
    Returns a list of dicts with text, href, full_url, path, and type.
    """
    soup = BeautifulSoup(html, "lxml")
    ctas = []
    parsed_base = urlparse(base_url)
    base_domain = f"{parsed_base.scheme}://{parsed_base.netloc}"

    for a in soup.find_all("a", href=True):
        text = a.get_text(strip=True)
        href = a.get("href", "").strip()

        if not text or len(text) < 2:
            continue
        if not href or href.startswith("#"):
            continue
        if href.startswith("mailto:") or href.startswith("tel:"):
            continue

        full_url = urljoin(base_domain, href)
        path     = _normalize_path(full_url)

        ctas.append({
            "text":     text[:120],
            "href":     href,
            "full_url": full_url,
            "path":     path,
            "type":     "link",
        })

    for btn in soup.find_all("button"):
        text = btn.get_text(strip=True)
        if text and len(text) >= 2:
            ctas.append({
                "text":     text[:120],
                "href":     None,
                "full_url": None,
                "path":     None,
                "type":     "button",
            })

    return ctas


async def check_link_validity(ctas: list, limit: int = 25) -> list:
    """
    HEAD-check the first `limit` link-type CTAs.
    Returns each CTA dict with status_code and valid fields added.
    """
    link_ctas = [
        c for c in ctas
        if c.get("full_url") and c["full_url"].startswith("http")
    ][:limit]

    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:

        async def check(cta: dict) -> dict:
            try:
                r = await client.head(cta["full_url"])
                return {**cta, "status_code": r.status_code, "valid": r.status_code < 400}
            except Exception as exc:
                return {**cta, "status_code": None, "valid": False, "error": str(exc)}

        raw = await asyncio.gather(
            *[check(c) for c in link_ctas],
            return_exceptions=True,
        )

    return [r for r in raw if not isinstance(r, Exception)]


def compare_ctas(ple_ctas: list, evona_ctas: list) -> dict:
    """
    Match each PLE CTA against an EVONA CTA by link text.
    Flags each as: ok, path_mismatch, or missing.
    """
    evona_by_text = {}
    for cta in evona_ctas:
        key = cta["text"].lower().strip()
        if key not in evona_by_text:
            evona_by_text[key] = cta

    results = []
    ok_count = missing_count = mismatch_count = 0
    seen = set()

    for ple_cta in ple_ctas:
        key = ple_cta["text"].lower().strip()

        # Skip duplicate texts and buttons with no path
        if key in seen:
            continue
        if not ple_cta.get("path") or ple_cta.get("type") == "button":
            continue
        seen.add(key)

        ple_path    = ple_cta.get("path", "")
        evona_match = evona_by_text.get(key)

        if evona_match:
            evona_path = evona_match.get("path", "")
            if evona_path == ple_path:
                status = "ok"
                ok_count += 1
            else:
                status = "path_mismatch"
                mismatch_count += 1
        else:
            status      = "missing"
            evona_match = None
            missing_count += 1

        results.append({
            "text":       ple_cta["text"],
            "ple_path":   ple_path,
            "evona_path": evona_match.get("path") if evona_match else None,
            "status":     status,
        })

    total      = len(results)
    match_rate = round(ok_count / total * 100) if total > 0 else 0

    return {
        "total_compared": total,
        "ok_count":       ok_count,
        "missing_count":  missing_count,
        "mismatch_count": mismatch_count,
        "match_rate":     match_rate,
        "results":        results[:50],
    }