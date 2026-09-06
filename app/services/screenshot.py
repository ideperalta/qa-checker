import asyncio
import base64
from typing import Optional

import httpx
from playwright.async_api import async_playwright
from playwright.async_api import TimeoutError as PlaywrightTimeout
from playwright_stealth import stealth_async

from app.config import settings

SCRAPERAPI_MAIN_URL = "https://api.scraperapi.com/"


def _is_cloudflare_page(title: str, content: str) -> bool:
    """
    Detect if the current page is a Cloudflare challenge or verification page.
    Checks both the page title and body content for known Cloudflare markers.
    """
    title_lower   = title.lower()
    content_lower = content.lower()

    cloudflare_markers = [
        "just a moment",
        "checking your browser",
        "verify you are human",
        "please wait",
        "enable javascript and cookies",
        "cf-browser-verification",
        "cloudflare",
        "attention required",
    ]

    for marker in cloudflare_markers:
        if marker in title_lower or marker in content_lower:
            return True
    return False


async def _scraperapi_screenshot(url: str) -> Optional[str]:
    """
    Fallback screenshot via ScraperAPI with ultra_premium=true.
    Used when Playwright detects a Cloudflare challenge page.
    ScraperAPI uses residential proxies that bypass Cloudflare protection.
    Returns base64 string on success, None on failure.
    """
    params = {
        "api_key":       settings.SCRAPERAPI_KEY,
        "url":           url,
        "screenshot":    "true",
        "render":        "true",
        "ultra_premium": "true",
        "wait":          "5000",
    }

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(120.0, connect=20.0),
        follow_redirects=True,
    ) as client:
        try:
            response = await client.get(SCRAPERAPI_MAIN_URL, params=params)

            if response.status_code != 200:
                print(f"[screenshot] ScraperAPI fallback HTTP {response.status_code} for {url}")
                return None

            if not response.content or len(response.content) < 1000:
                return None

            content_type = response.headers.get("content-type", "")

            # Raw PNG bytes
            is_png = len(response.content) > 4 and response.content[:4] == b"\x89PNG"
            if is_png or "image" in content_type:
                return base64.b64encode(response.content).decode("utf-8")

            # JSON wrapper with base64 field
            if "json" in content_type:
                try:
                    data = response.json()
                    raw  = (
                        data.get("screenshot")
                        or data.get("image")
                        or data.get("data")
                    )
                    if raw and len(raw) > 100:
                        return raw
                except Exception:
                    pass

            # Large enough to be an image despite wrong content-type
            if len(response.content) > 10000:
                return base64.b64encode(response.content).decode("utf-8")

            return None

        except Exception as e:
            print(f"[screenshot] ScraperAPI fallback error for {url}: {e}")
            return None


async def take_screenshot(url: str) -> dict:
    """
    Take a full-page screenshot using Playwright with headless Chromium.

    Flow:
      1. Launch Chromium with stealth patches to avoid bot detection
      2. Load the page and wait for network to settle
      3. Check if Cloudflare has blocked the page
      4a. If Cloudflare detected -> fall back to ScraperAPI ultra_premium
      4b. If no Cloudflare -> scroll to trigger lazy loading, then capture
      5. Return base64 encoded PNG
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

            # Apply stealth patches
            await stealth_async(page)

            # ── Load page ─────────────────────────────────────────────────────
            try:
                await page.goto(url, wait_until="networkidle", timeout=40000)
            except PlaywrightTimeout:
                try:
                    await page.goto(url, wait_until="load", timeout=25000)
                except PlaywrightTimeout:
                    await page.goto(url, wait_until="domcontentloaded", timeout=15000)

            await asyncio.sleep(3)

            # ── Check for Cloudflare challenge ────────────────────────────────
            page_title   = await page.title()
            page_content = await page.content()

            if _is_cloudflare_page(page_title, page_content):
                print(f"[screenshot] Cloudflare detected for {url} — using ScraperAPI fallback")
                await browser.close()

                result = await _scraperapi_screenshot(url)
                if result:
                    return {
                        "success":      True,
                        "image_base64": result,
                        "error":        None,
                        "method":       "scraperapi_ultra_premium",
                    }
                return {
                    "success":      False,
                    "image_base64": None,
                    "error": (
                        "This site uses Cloudflare protection. "
                        "ScraperAPI fallback also failed. "
                        "All other QA checks are unaffected."
                    ),
                }

            # ── No Cloudflare — scroll to trigger lazy loading ────────────────
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

            # ── Get full page height ──────────────────────────────────────────
            full_height = await page.evaluate("""
                () => Math.max(
                    document.documentElement.scrollHeight,
                    document.body.scrollHeight,
                    document.documentElement.offsetHeight,
                    document.body.offsetHeight
                )
            """)

            print(f"[screenshot] {url} -> full_height={full_height}px")

            # ── Resize viewport to full page height ───────────────────────────
            await page.set_viewport_size({"width": 1280, "height": full_height})
            await asyncio.sleep(1)

            # ── Take screenshot ───────────────────────────────────────────────
            screenshot_bytes = await page.screenshot(
                full_page=True,
                type="png",
                animations="disabled",
            )

            print(f"[screenshot] {url} -> captured {len(screenshot_bytes):,} bytes")

            await browser.close()

            return {
                "success":      True,
                "image_base64": base64.b64encode(screenshot_bytes).decode("utf-8"),
                "error":        None,
                "method":       "playwright",
            }

    except PlaywrightTimeout:
        return {
            "success":      False,
            "image_base64": None,
            "error":        "Page load timed out.",
        }
    except Exception as e:
        return {
            "success":      False,
            "image_base64": None,
            "error":        f"Screenshot failed: {str(e)}",
        }
