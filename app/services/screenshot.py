import asyncio
import base64
from typing import Optional

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


async def take_screenshot(
    url: str,
    pre_fetched_html: Optional[str] = None,
) -> dict:
    """
    Take a full-page screenshot using Playwright with headless Chromium.

    If pre_fetched_html is provided:
      1. Inject <base href="url"> so CSS/images/JS resolve correctly
      2. Serve the HTML via page.set_content() — no URL visit needed
      3. Cloudflare never sees the request → screenshot works ✅

    If pre_fetched_html is NOT provided:
      1. Navigate to URL normally
      2. Check for Cloudflare → fallback to ScraperAPI if blocked
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

                # Fixed: inject base tag BEFORE serving so all relative
                # CSS, images, and JS paths resolve to the original domain
                html_with_base = _inject_base_tag(pre_fetched_html, url)

                print(
                    f"[screenshot] Injected <base href> — "
                    f"serving via set_content for {url}"
                )

                # Use set_content to render HTML directly
                # wait_until="networkidle" waits for CSS/images to load
                try:
                    await page.set_content(
                        html_with_base,
                        wait_until="networkidle",
                        timeout=30000,
                    )
                except PlaywrightTimeout:
                    # Some resources may timeout — still take screenshot
                    print(
                        f"[screenshot] set_content networkidle timeout "
                        f"for {url} — proceeding with screenshot"
                    )
                    await page.set_content(
                        html_with_base,
                        wait_until="domcontentloaded",
                        timeout=15000,
                    )

                print(f"[screenshot] Pre-fetched HTML rendered for {url}")

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
