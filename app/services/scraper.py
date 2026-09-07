import asyncio
import httpx

from app.config import settings

SCRAPERAPI_ENDPOINT = "https://api.scraperapi.com/"

# Cloudflare challenge markers found in blocked HTML responses
CLOUDFLARE_HTML_MARKERS = [
    "just a moment",
    "checking your browser",
    "verify you are human",
    "performing security verification",
    "please wait while your request is being verified",
    "enable javascript and cookies to continue",
    "cf-browser-verification",
    "_cf_chl_opt",
    "challenge-platform",
]


def _is_cloudflare_html(html: str) -> bool:
    """
    Return True if the scraped HTML is a Cloudflare challenge page.
    Only checks the first 3000 characters to keep it fast.
    """
    if not html:
        return False
    sample = html[:3000].lower()
    for marker in CLOUDFLARE_HTML_MARKERS:
        if marker in sample:
            return True
    return False


async def _fetch_scraperapi(
    url: str,
    render_js: bool = True,
    ultra_premium: bool = False,
    timeout: float = 120.0,
) -> dict:
    """
    Single ScraperAPI fetch attempt.
    When ultra_premium=True routes through residential proxies.
    """
    params = {
        "api_key": settings.SCRAPERAPI_KEY,
        "url":     url,
        "render":  "true" if render_js else "false",
    }
    if ultra_premium:
        params["ultra_premium"] = "true"

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
    Fetch page HTML using Playwright with stealth patches.
    Used as a final fallback when ScraperAPI cannot bypass Cloudflare.
    Playwright runs a real browser that passes Cloudflare bot detection.
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
                    await page.goto(url, wait_until="domcontentloaded", timeout=15000)

            # Allow JavaScript to finish executing
            await asyncio.sleep(3)

            html = await page.content()
            await browser.close()

            # Check if Playwright also got a Cloudflare page
            if _is_cloudflare_html(html):
                print(f"[scraper] Playwright also blocked by Cloudflare for {url}")
                return {
                    "success":     False,
                    "status_code": None,
                    "html":        None,
                    "error": (
                        "Cloudflare blocked all three fetch attempts "
                        "(ScraperAPI standard, ScraperAPI ultra_premium, Playwright). "
                        "Screenshots may still work."
                    ),
                }

            print(
                f"[scraper] Playwright fallback succeeded for {url} "
                f"({len(html):,} chars)"
            )
            return {
                "success":     True,
                "status_code": 200,
                "html":        html,
                "error":       None,
            }

    except Exception as e:
        print(f"[scraper] Playwright fallback exception for {url}: {e}")
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
    Fetch a page HTML with automatic Cloudflare bypass.

    Attempt 1: ScraperAPI standard request
               Fast and cheap — works for most sites

    Attempt 2: ScraperAPI ultra_premium
               Residential proxies — bypasses most Cloudflare rules
               Only used if Attempt 1 returns Cloudflare HTML

    Attempt 3: Playwright with stealth patches
               Real browser — bypasses Cloudflare bot detection
               Only used if Attempt 2 also returns Cloudflare HTML

    Returns {success, status_code, html, error}
    """
    # ── Attempt 1: ScraperAPI standard ───────────────────────────────────────
    result = await _fetch_scraperapi(
        url, render_js=render_js, ultra_premium=False, timeout=timeout
    )

    if not result["success"]:
        # ScraperAPI itself failed (network error, API error)
        # Try Playwright as fallback
        print(f"[scraper] ScraperAPI standard failed for {url} — trying Playwright")
        return await _fetch_playwright(url)

    if not _is_cloudflare_html(result["html"]):
        # Standard request returned real HTML
        return result

    print(
        f"[scraper] Cloudflare detected (standard) for {url} — "
        f"retrying with ultra_premium=true"
    )

    # ── Attempt 2: ScraperAPI ultra_premium ───────────────────────────────────
    result2 = await _fetch_scraperapi(
        url, render_js=render_js, ultra_premium=True, timeout=timeout
    )

    if result2["success"] and not _is_cloudflare_html(result2["html"]):
        print(f"[scraper] ultra_premium succeeded for {url}")
        return result2

    print(
        f"[scraper] Cloudflare detected (ultra_premium) for {url} — "
        f"falling back to Playwright"
    )

    # ── Attempt 3: Playwright with stealth ────────────────────────────────────
    return await _fetch_playwright(url)
