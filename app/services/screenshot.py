import asyncio
import base64
from typing import Optional
from urllib.parse import urlparse

import httpx
from playwright.async_api import async_playwright
from playwright.async_api import TimeoutError as PlaywrightTimeout
from playwright_stealth import stealth_async

from app.config import settings

SCRAPERAPI_MAIN_URL = "https://api.scraperapi.com/"

# Cloudflare detection markers
# NOTE: "performing security verification" was intentionally removed —
# it falsely matched real content on the PLE site causing false positives.
CLOUDFLARE_MARKERS = [
    "just a moment",
    "checking your browser",
    "verify you are human",
    "please wait while your request is being verified",
    "enable javascript and cookies to continue",
    "cf-browser-verification",
    "attention required! | cloudflare",
]


def _is_cloudflare_page(title: str, html: str) -> bool:
    """
    Return True if the page is a Cloudflare challenge or bot-check page.
    Checks both the page title and a sample of the page body.
    """
    title_lower = title.lower()
    html_lower  = html[:5000].lower()
    for marker in CLOUDFLARE_MARKERS:
        if marker in title_lower or marker in html_lower:
            return True
    return False


def _inject_base_tag(html: str, url: str) -> str:
    """
    Inject a <base href="url"> tag into the HTML <head>.
    This ensures all relative CSS, image, and JS paths resolve
    correctly when the HTML is served locally by Playwright.
    """
    base_tag = f'<base href="{url}">'
    if "<head>" in html:
        return html.replace("<head>", f"<head>{base_tag}", 1)
    elif "<HEAD>" in html:
        return html.replace("<HEAD>", f"<HEAD>{base_tag}", 1)
    else:
        return base_tag + html


async def _scraperapi_screenshot(url: str) -> Optional[str]:
    """
    Take a screenshot via ScraperAPI using ultra_premium=true.
    Returns a valid base64-encoded PNG string on success, or None.
    All errors are caught — this function never raises.
    """
    params = {
        "api_key":       settings.SCRAPERAPI_KEY,
        "url":           url,
        "screenshot":    "true",
        "render":        "true",
        "ultra_premium": "true",
        "full_page":     "true",
        "wait":          "5000",
    }

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(120.0, connect=20.0),
        follow_redirects=True,
    ) as client:
        try:
            response = await client.get(SCRAPERAPI_MAIN_URL, params=params)

            print(
                f"[screenshot] ScraperAPI fallback: "
                f"HTTP {response.status_code}, "
                f"content-type={response.headers.get('content-type','?')}, "
                f"size={len(response.content):,} bytes"
            )

            if response.status_code != 200 or not response.content:
                return None

            if len(response.content) < 5000:
                print(
                    f"[screenshot] ScraperAPI response too small "
                    f"({len(response.content)} bytes) — probably an error message"
                )
                return None

            content_type = response.headers.get("content-type", "").lower()

            # Check 1: PNG magic bytes [0x89, P, N, G]
            if response.content[:4] == bytes([0x89, 0x50, 0x4E, 0x47]):
                print("[screenshot] ScraperAPI: raw PNG confirmed")
                return base64.b64encode(response.content).decode("utf-8")

            # Check 2: image/* content-type
            if "image/" in content_type:
                print(f"[screenshot] ScraperAPI: image content-type {content_type}")
                return base64.b64encode(response.content).decode("utf-8")

            # Check 3: JSON envelope containing a base64 screenshot field
            if "json" in content_type:
                try:
                    data = response.json()
                    raw  = (
                        data.get("screenshot")
                        or data.get("image")
                        or data.get("data")
                    )
                    if raw and isinstance(raw, str) and len(raw) > 1000:
                        decoded = base64.b64decode(raw + "==")
                        if decoded[:4] == bytes([0x89, 0x50, 0x4E, 0x47]):
                            print("[screenshot] ScraperAPI: JSON base64 PNG confirmed")
                            return raw
                        print("[screenshot] ScraperAPI: JSON base64 is not PNG")
                except Exception as json_err:
                    print(f"[screenshot] ScraperAPI JSON parse error: {json_err}")

            print(
                f"[screenshot] ScraperAPI: response not recognised as image "
                f"content-type={content_type}"
            )
            return None

        except Exception as exc:
            print(f"[screenshot] ScraperAPI fallback exception: {exc}")
            return None


async def _fetch_resource_via_scraperapi(url: str) -> Optional[tuple]:
    """
    Fetch a single resource (CSS, font, image) through ScraperAPI
    to bypass Cloudflare protection on the target domain.
    Returns (content_type, body_bytes) or None on failure.
    Costs 1 ScraperAPI credit per call.
    """
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                SCRAPERAPI_MAIN_URL,
                params={
                    "api_key": settings.SCRAPERAPI_KEY,
                    "url":     url,
                    "render":  "false",
                },
            )
            if resp.status_code == 200 and resp.content:
                content_type = resp.headers.get(
                    "content-type", "application/octet-stream"
                )
                return content_type, resp.content
    except Exception as e:
        print(f"[screenshot] Resource proxy error for {url[:80]}: {e}")
    return None


async def take_screenshot(
    url: str,
    pre_fetched_html: Optional[str] = None,
) -> dict:
    """
    Take a full-page screenshot using Playwright with headless Chromium.

    If pre_fetched_html is provided:
      1. Inject <base href="url"> so CSS/images/JS resolve to real domain
      2. Set up route interceptor — all requests to the target domain
         are proxied through ScraperAPI (bypasses Cloudflare for assets)
      3. Serve HTML via set_content() — no URL visit = no Cloudflare check
      4. All CSS, fonts, images load correctly → clean full-page screenshot

    If pre_fetched_html is NOT provided:
      1. Navigate to URL normally via Playwright
      2. Check for Cloudflare → fallback to ScraperAPI screenshot if blocked
      3. Take screenshot
    """
    try:
        async with async_playwright() as p:

            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-blink-features=AutomationControlled",
                    "--disable-features=IsolateOrigins,site-per-process",
                    "--window-size=1280,900",
                ],
            )

            context = await browser.new_context(
                viewport={"width": 1280, "height": 900},
                device_scale_factor=1,
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                ignore_https_errors=True,
                java_script_enabled=True,
                locale="en-US",
                timezone_id="America/New_York",
                extra_http_headers={
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept": (
                        "text/html,application/xhtml+xml,"
                        "application/xml;q=0.9,image/avif,"
                        "image/webp,image/apng,*/*;q=0.8"
                    ),
                },
            )

            page = await context.new_page()
            await stealth_async(page)

            # ── Pre-fetched HTML flow — bypasses Cloudflare ───────────────────
            if pre_fetched_html:
                print(
                    f"[screenshot] Using pre-fetched HTML for {url} "
                    f"({len(pre_fetched_html):,} chars) — bypassing Cloudflare"
                )

                # Inject <base href> so relative paths resolve to real domain
                html_with_base = _inject_base_tag(pre_fetched_html, url)

                # Get target domain so we only proxy requests to that domain
                target_netloc = urlparse(url).netloc

                # Cache for proxied resources — avoids duplicate API calls
                resource_cache: dict = {}

                async def _proxy_target_resources(route, request):
                    """
                    Intercept requests to the target (Cloudflare-protected)
                    domain and proxy them through ScraperAPI so CSS, fonts,
                    and images all load correctly in the screenshot.
                    All other requests (CDN, external) are passed through.
                    """
                    req_url     = request.url
                    req_netloc  = urlparse(req_url).netloc

                    # Only intercept requests to the target domain
                    if req_netloc == target_netloc:

                        # Serve from cache if already fetched
                        if req_url in resource_cache:
                            cached = resource_cache[req_url]
                            await route.fulfill(
                                status=200,
                                content_type=cached[0],
                                body=cached[1],
                            )
                            return

                        # Fetch through ScraperAPI (1 credit)
                        result = await _fetch_resource_via_scraperapi(req_url)
                        if result:
                            resource_cache[req_url] = result
                            print(
                                f"[screenshot] Proxied via ScraperAPI: "
                                f"{req_url[-60:]} ({len(result[1]):,} bytes)"
                            )
                            await route.fulfill(
                                status=200,
                                content_type=result[0],
                                body=result[1],
                            )
                            return

                    # Not a target domain request — pass through normally
                    try:
                        await route.continue_()
                    except Exception:
                        await route.abort()

                # Register route interceptor before set_content
                await page.route("**/*", _proxy_target_resources)

                # Serve pre-fetched HTML with base tag injected
                try:
                    await page.set_content(
                        html_with_base,
                        wait_until="networkidle",
                        timeout=30000,
                    )
                except PlaywrightTimeout:
                    print(
                        f"[screenshot] set_content networkidle timeout "
                        f"for {url} — proceeding with screenshot"
                    )
                    try:
                        await page.set_content(
                            html_with_base,
                            wait_until="domcontentloaded",
                            timeout=15000,
                        )
                    except Exception:
                        pass

                print(
                    f"[screenshot] Pre-fetched HTML rendered for {url} "
                    f"({len(resource_cache)} resources proxied)"
                )

            # ── Normal flow — navigate to URL directly ────────────────────────
            else:
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

                # ── Cloudflare check ──────────────────────────────────────────
                page_title = await page.title()
                page_html  = await page.content()

                if _is_cloudflare_page(page_title, page_html):
                    print(
                        f"[screenshot] Cloudflare detected for {url} "
                        f"(title: {page_title!r}) — closing Playwright, "
                        f"falling back to ScraperAPI ultra_premium"
                    )
                    await browser.close()

                    b64 = await _scraperapi_screenshot(url)
                    if b64:
                        return {
                            "success":      True,
                            "image_base64": b64,
                            "error":        None,
                            "method":       "scraperapi_ultra_premium",
                        }
                    return {
                        "success":      False,
                        "image_base64": None,
                        "error": (
                            "This site uses Cloudflare bot protection. "
                            "Playwright was blocked and the ScraperAPI "
                            "residential-proxy fallback did not return a "
                            "valid image. All other QA checks are unaffected."
                        ),
                    }

            # ── Scroll to trigger lazy-loaded content ─────────────────────────
            await asyncio.sleep(2)

            await page.evaluate("""
                async () => {
                    await new Promise((resolve) => {
                        let scrolled = 0;
                        const step   = 300;
                        const timer  = setInterval(() => {
                            const height = document.documentElement.scrollHeight;
                            if (scrolled < height) {
                                window.scrollBy(0, step);
                                scrolled += step;
                            } else {
                                clearInterval(timer);
                                window.scrollTo(0, 0);
                                setTimeout(resolve, 1000);
                            }
                        }, 100);
                    });
                }
            """)

            await asyncio.sleep(1)

            # ── Expand viewport to full page height ───────────────────────────
            full_height = await page.evaluate("""
                () => Math.max(
                    document.documentElement.scrollHeight,
                    document.body.scrollHeight,
                    document.documentElement.offsetHeight,
                    document.body.offsetHeight
                )
            """)

            print(f"[screenshot] {url} -> full_height={full_height}px")

            await page.set_viewport_size({"width": 1280, "height": full_height})
            await asyncio.sleep(1)

            screenshot_bytes = await page.screenshot(
                full_page=True,
                type="png",
                animations="disabled",
            )

            print(
                f"[screenshot] {url} -> "
                f"captured {len(screenshot_bytes):,} bytes via Playwright"
            )

            await browser.close()

            method = (
                "playwright_prefetched_html"
                if pre_fetched_html
                else "playwright"
            )

            return {
                "success":      True,
                "image_base64": base64.b64encode(screenshot_bytes).decode("utf-8"),
                "error":        None,
                "method":       method,
            }

    except PlaywrightTimeout:
        return {
            "success":      False,
            "image_base64": None,
            "error":        "Page load timed out. The site may be slow or unavailable.",
        }
    except Exception as exc:
        return {
            "success":      False,
            "image_base64": None,
            "error":        f"Screenshot failed: {str(exc)}",
        }
