import asyncio
import httpx

from app.config import settings

SCRAPERAPI_ENDPOINT = "https://api.scraperapi.com/"

CLOUDFLARE_HTML_MARKERS = [
    "just a moment",
    "checking your browser",
    "verify you are human",
    "please wait while your request is being verified",
    "enable javascript and cookies to continue",
    "cf-browser-verification",
    "_cf_chl_opt",
    "challenge-platform",
]

REALISTIC_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;"
        "q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
    ),
    "Accept-Language":           "en-US,en;q=0.9",
    "Accept-Encoding":           "gzip, deflate, br",
    "Cache-Control":             "no-cache",
    "Pragma":                    "no-cache",
    "Sec-Fetch-Dest":            "document",
    "Sec-Fetch-Mode":            "navigate",
    "Sec-Fetch-Site":            "none",
    "Sec-Fetch-User":            "?1",
    "Upgrade-Insecure-Requests": "1",
}

# Minimum HTML size in characters.
MIN_HTML_SIZE = 30000


def _is_cloudflare_html(html: str) -> bool:
    """
    Return True if the HTML is a Cloudflare challenge page.
    Only checks the first 3000 characters for performance.
    """
    if not html:
        return False
    sample = html[:3000].lower()
    for marker in CLOUDFLARE_HTML_MARKERS:
        if marker in sample:
            return True
    return False


def _is_complete_html(html: str) -> bool:
    """
    Return True if the HTML appears to be a full page response.
    Checks both for Cloudflare challenge markers and minimum content size.
    """
    if not html:
        return False
    if _is_cloudflare_html(html):
        return False
    if len(html) < MIN_HTML_SIZE:
        return False
    return True


async def _fetch_direct(url: str, timeout: float = 30.0) -> dict:
    """
    Attempt 1: Plain httpx request with realistic browser headers.
    Free — uses no ScraperAPI credits.
    Returns partial HTML if response is real content but below size threshold.
    """
    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
        headers=REALISTIC_HEADERS,
    ) as client:
        try:
            response = await client.get(url)
            if response.status_code == 200:
                html = response.text
                if _is_complete_html(html):
                    print(
                        f"[scraper] Attempt 1 (direct) succeeded for {url} "
                        f"({len(html):,} chars)"
                    )
                    return {
                        "success":     True,
                        "status_code": response.status_code,
                        "html":        html,
                        "error":       None,
                    }
                elif _is_cloudflare_html(html):
                    print(f"[scraper] Attempt 1 (direct) got Cloudflare for {url}")
                    return {
                        "success":     False,
                        "status_code": response.status_code,
                        "html":        None,
                        "error":       "cloudflare",
                    }
                else:
                    print(
                        f"[scraper] Attempt 1 (direct) returned incomplete HTML "
                        f"({len(html):,} chars < {MIN_HTML_SIZE:,} minimum) "
                        f"for {url}"
                    )
                    # Return partial HTML — captured as last-resort fallback
                    return {
                        "success":     False,
                        "status_code": response.status_code,
                        "html":        html,
                        "error":       "incomplete_html",
                    }
            else:
                print(
                    f"[scraper] Attempt 1 (direct) HTTP "
                    f"{response.status_code} for {url}"
                )
        except Exception as e:
            print(f"[scraper] Attempt 1 (direct) exception for {url}: {e}")

    return {
        "success":     False,
        "status_code": None,
        "html":        None,
        "error":       "direct_failed",
    }


async def _fetch_scraperapi(
    url: str,
    render_js: bool = False,
    premium: bool = False,
    ultra_premium: bool = False,
    timeout: float = 120.0,
) -> dict:
    """
    ScraperAPI fetch with configurable proxy tier.

    Credit costs per request:
      render=false, standard      =  1 credit
      render=false, premium       = 10 credits
      render=false, ultra_premium = 30 credits
      render=true,  ultra_premium = 75 credits

    ultra_premium uses residential proxies that bypass Cloudflare.
    """
    params = {
        "api_key": settings.SCRAPERAPI_KEY,
        "url":     url,
        "render":  "true" if render_js else "false",
    }

    if ultra_premium:
        params["ultra_premium"] = "true"
    elif premium:
        params["premium"] = "true"

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.get(SCRAPERAPI_ENDPOINT, params=params)
            response.raise_for_status()
            return {
                "success":     True,
                "status_code": response.status_code,
                "html":        response.text,
                "error":       None,
            }
        except httpx.TimeoutException:
            return {
                "success":     False,
                "status_code": None,
                "html":        None,
                "error":       "Request timed out after 120 seconds.",
            }
        except httpx.HTTPStatusError as e:
            return {
                "success":     False,
                "status_code": e.response.status_code,
                "html":        None,
                "error":       f"ScraperAPI returned HTTP {e.response.status_code}.",
            }
        except Exception as e:
            return {
                "success":     False,
                "status_code": None,
                "html":        None,
                "error":       str(e),
            }


async def _fetch_playwright(url: str) -> dict:
    """
    Attempt 6: Playwright with stealth patches.
    Works reliably on residential IPs. May be blocked by Cloudflare on Render.
    Kept as final fallback.
    """
    try:
        from playwright.async_api import async_playwright
        from playwright.async_api import TimeoutError as PlaywrightTimeout
        from playwright_stealth import stealth_async

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-blink-features=AutomationControlled",
                ],
            )
            context = await browser.new_context(
                viewport={"width": 1280, "height": 900},
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                ignore_https_errors=True,
                locale="en-US",
                timezone_id="America/New_York",
                extra_http_headers={
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept": (
                        "text/html,application/xhtml+xml,"
                        "application/xml;q=0.9,*/*;q=0.8"
                    ),
                },
            )
            page = await context.new_page()
            await stealth_async(page)

            try:
                await page.goto(url, wait_until="networkidle", timeout=40000)
            except PlaywrightTimeout:
                try:
                    await page.goto(url, wait_until="load", timeout=25000)
                except PlaywrightTimeout:
                    await page.goto(
                        url, wait_until="domcontentloaded", timeout=15000
                    )

            await asyncio.sleep(3)
            html = await page.content()
            await browser.close()

            if _is_cloudflare_html(html):
                print(
                    f"[scraper] Attempt 6 (Playwright) blocked by "
                    f"Cloudflare for {url}"
                )
                return {
                    "success":     False,
                    "status_code": None,
                    "html":        None,
                    "error": (
                        "Cloudflare blocked all fetch attempts for this URL. "
                        "Screenshots and Page Coverage are unaffected."
                    ),
                }

            print(
                f"[scraper] Attempt 6 (Playwright) succeeded for {url} "
                f"({len(html):,} chars)"
            )
            return {
                "success":     True,
                "status_code": 200,
                "html":        html,
                "error":       None,
            }

    except Exception as e:
        print(f"[scraper] Attempt 6 (Playwright) exception for {url}: {e}")
        return {
            "success":     False,
            "status_code": None,
            "html":        None,
            "error":       f"Playwright fallback failed: {str(e)}",
        }


async def fetch_page(
    url: str,
    render_js: bool = True,
    timeout: float = 120.0,
) -> dict:
    """
    Fetch page HTML with automatic Cloudflare bypass.

    Attempt 1: Direct httpx (free)
    Attempt 2: ScraperAPI standard — 1 credit
    Attempt 3: ScraperAPI premium — 10 credits
    Attempt 4: ScraperAPI ultra_premium render=false — 30 credits
    Attempt 5: ScraperAPI ultra_premium render=true  — 75 credits
    Attempt 6: Playwright with stealth

    Last resort: If all attempts fail but any real (non-Cloudflare) HTML
    was captured, return the best partial HTML so that SEO, CTA, and AI
    analysis can still run with whatever content is available.
    """
    # Track the largest non-Cloudflare HTML captured across all attempts
    best_partial_html = None

    def _update_best_partial(html):
        nonlocal best_partial_html
        if html and not _is_cloudflare_html(html):
            if best_partial_html is None or len(html) > len(best_partial_html):
                best_partial_html = html

    # ── Attempt 1: Direct HTTP ────────────────────────────────────────────────
    result = await _fetch_direct(url, timeout=30.0)
    if result["success"]:
        return result
    _update_best_partial(result.get("html"))

    print(
        f"[scraper] Attempt 1 failed for {url} — "
        f"trying ScraperAPI standard (1 credit)"
    )

    # ── Attempt 2: ScraperAPI standard (1 credit) ─────────────────────────────
    result2 = await _fetch_scraperapi(
        url, render_js=False, premium=False, ultra_premium=False, timeout=timeout,
    )
    if result2["success"] and _is_complete_html(result2["html"]):
        print(
            f"[scraper] Attempt 2 (ScraperAPI standard) succeeded for {url} "
            f"({len(result2['html']):,} chars)"
        )
        return result2
    _update_best_partial(result2.get("html"))

    print(
        f"[scraper] Attempt 2 failed for {url} — "
        f"trying ScraperAPI premium (10 credits)"
    )

    # ── Attempt 3: ScraperAPI premium (10 credits) ────────────────────────────
    result3 = await _fetch_scraperapi(
        url, render_js=False, premium=True, ultra_premium=False, timeout=timeout,
    )
    if result3["success"] and _is_complete_html(result3["html"]):
        print(
            f"[scraper] Attempt 3 (ScraperAPI premium) succeeded for {url} "
            f"({len(result3['html']):,} chars)"
        )
        return result3
    _update_best_partial(result3.get("html"))

    print(
        f"[scraper] Attempt 3 failed for {url} — "
        f"trying ScraperAPI ultra_premium render=false (30 credits)"
    )

    # ── Attempt 4: ScraperAPI ultra_premium render=false (30 credits) ─────────
    result4 = await _fetch_scraperapi(
        url, render_js=False, premium=False, ultra_premium=True, timeout=timeout,
    )
    if result4["success"] and _is_complete_html(result4["html"]):
        print(
            f"[scraper] Attempt 4 (ultra_premium render=false) succeeded "
            f"for {url} ({len(result4['html']):,} chars)"
        )
        return result4
    _update_best_partial(result4.get("html"))

    print(
        f"[scraper] Attempt 4 failed for {url} — "
        f"trying ScraperAPI ultra_premium render=true (75 credits)"
    )

    # ── Attempt 5: ScraperAPI ultra_premium render=true (75 credits) ──────────
    result5 = await _fetch_scraperapi(
        url, render_js=True, premium=False, ultra_premium=True, timeout=timeout,
    )
    if result5["success"] and _is_complete_html(result5["html"]):
        print(
            f"[scraper] Attempt 5 (ultra_premium render=true) succeeded "
            f"for {url} ({len(result5['html']):,} chars)"
        )
        return result5
    _update_best_partial(result5.get("html"))

    print(
        f"[scraper] Attempt 5 failed for {url} — "
        f"falling back to Playwright"
    )

    # ── Attempt 6: Playwright with stealth ────────────────────────────────────
    result6 = await _fetch_playwright(url)
    if result6["success"]:
        return result6
    _update_best_partial(result6.get("html"))

    # ── Last resort: return best partial HTML so SEO/CTA/AI can still run ─────
    if best_partial_html:
        print(
            f"[scraper] All attempts failed for {url} — "
            f"using best partial HTML ({len(best_partial_html):,} chars) "
            f"so SEO/CTA/AI analysis can still run"
        )
        return {
            "success":     True,
            "status_code": 200,
            "html":        best_partial_html,
            "error":       "partial_content_only",
            "partial":     True,
        }

    return result6


async def fetch_page_rendered(url: str, timeout: float = 120.0) -> dict:
    """
    Fetch page HTML with JavaScript rendering for SEO meta tag extraction.

    Tries in order:
      1. ScraperAPI ultra_premium render=true  (75 credits) — bypasses
         Cloudflare AND executes JavaScript so meta tags are captured.
      2. ScraperAPI premium render=true        (10 credits) — fallback.
      3. ScraperAPI standard render=true       ( 1 credit)  — last resort.
    """
    # Attempt 1: ultra_premium + render_js (bypasses Cloudflare + runs JS)
    print(
        f"[seo] Re-fetching {url} with ultra_premium+render_js=True "
        f"(75 credits) for meta tag extraction"
    )
    result = await _fetch_scraperapi(
        url, render_js=True, ultra_premium=True, timeout=timeout
    )
    if result.get("success") and result.get("html"):
        seo_check = result["html"][:3000].lower()
        if "<title" in seo_check or "meta name" in seo_check or "og:title" in seo_check:
            print(f"[seo] ultra_premium render succeeded for {url}")
            return result
        print(f"[seo] ultra_premium render returned HTML but meta tags still missing for {url}")

    # Attempt 2: premium + render_js
    print(
        f"[seo] Falling back to premium+render_js=True "
        f"(10 credits) for {url}"
    )
    result2 = await _fetch_scraperapi(
        url, render_js=True, premium=True, timeout=timeout
    )
    if result2.get("success") and result2.get("html"):
        print(f"[seo] premium render succeeded for {url}")
        return result2

    # Attempt 3: standard + render_js
    print(
        f"[seo] Falling back to standard+render_js=True "
        f"(1 credit) for {url}"
    )
    return await _fetch_scraperapi(url, render_js=True, timeout=timeout)

    