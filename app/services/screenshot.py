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
    Detect if the current page is a Cloudflare challenge page.
    """
    title_lower   = title.lower()
    content_lower = content.lower()

    markers = [
        "just a moment",
        "checking your browser",
        "verify you are human",
        "please wait",
        "enable javascript and cookies",
        "cf-browser-verification",
        "attention required",
    ]

    for marker in markers:
        if marker in title_lower or marker in content_lower:
            return True
    return False


async def _scraperapi_screenshot(url: str) -> Optional[str]:
    """
    Fallback screenshot via ScraperAPI with ultra_premium=true.
    Uses residential proxies to bypass Cloudflare.
    Always returns a valid base64 PNG string or None.
    """
    params = {
        "api_key":       settings.SCRAPERAPI_KEY,
        "url":           url,
        "screenshot":    "true",
        "render":        "true",
        "ultra_premium": "true",
        "wait":          "5000",
        "full_page":     "true",
    }

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(120.0, connect=20.0),
        follow_redirects=True,
    ) as client:
        try:
            response = await client.get(SCRAPERAPI_MAIN_URL, params=params)

            if response.status_code != 200:
                print(
                    f"[screenshot] ScraperAPI fallback HTTP "
                    f"{response.status_code} for {url}"
                )
                return None

            if not response.content or len(response.content) < 1000:
                print(f"[screenshot] ScraperAPI fallback: empty response for {url}")
                return None

            content_type = response.headers.get("content-type", "").lower()

            # Raw PNG bytes — most reliable check first
            is_png = response.content[:4] == b"\x89PNG"
            if is_png:
                print(
                    f"[screenshot] ScraperAPI fallback: raw PNG "
                    f"{len(response.content):,} bytes for {url}"
                )
                return base64.b64encode(response.content).decode("utf-8")

            # image/* content type
            if "image" in content_type:
                print(
                    f"[screenshot] ScraperAPI fallback: image content-type "
                    f"{len(response.content):,} bytes for {url}"
                )
                return base64.b64encode(response.content).decode("utf-8")

            # JSON wrapper containing a base64 string
            if "json" in content_type:
                try:
                    data = response.json()
                    raw  = (
                        data.get("screenshot")
                        or data.get("image")
                        or data.get("data")
                    )
                    if raw and isinstance(raw, str) and len(raw) > 100:
                        # Validate it is already base64
                        base64.b64decode(raw + "==")
                        print(
                            f"[screenshot] ScraperAPI fallback: JSON base64 "
                            f"{len(raw)} chars for {url}"
                        )
                        return raw
                except Exception as json_err:
                    print(f"[screenshot] ScraperAPI JSON parse error: {json_err}")

            # Large binary response — encode it regardless of content-type
            if len(response.content) > 10000:
                print(
                    f"[screenshot] ScraperAPI fallback: large binary "
                    f"{len(response.content):,} bytes for {url}"
                )
                return base64.b64encode(response.content).decode("utf-8")

            print(
                f"[screenshot] ScraperAPI fallback: unrecognised response "
                f"content-type={content_type} size={len(response.content)} for {url}"
            )
            return None

        except Exception as e:
            print(f"[screenshot] ScraperAPI fallback exception for {url}: {e}")
            return None


async def take_screenshot(url: str) -> dict:
    """
    Take a full-page screenshot using Playwright with headless Chromium.

    Flow:
      1. Launch Chromium with stealth patches
      2. Load the page
      3. If Cloudflare is detected -> fall back to ScraperAPI ultra_premium
      4. Otherwise -> scroll to trigger lazy loading, resize viewport,
         take full-page screenshot
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

            # ── Load page ─────────────────────────────────────────────────────
            try:
                await page.goto(url, wait_until="networkidle", timeout=40000)
            except PlaywrightTimeout:
                try:
                    await page.goto(url, wait_until="load", timeout=25000)
                except PlaywrightTimeout:
                    await page.goto(url, wait_until="domcontentloaded", timeout=15000)

            await asyncio.sleep(3)

            # ── Check for Cloudflare ──────────────────────────────────────────
            page_title   = await page.title()
            page_content = await page.content()

            if _is_cloudflare_page(page_title, page_content):
                print(
                    f"[screenshot] Cloudflare detected for {url} "
                    f"(title: {page_title!r}) — using ScraperAPI fallback"
                )
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
                        "This site uses Cloudflare protection that blocks "
                        "automated browsers. The ScraperAPI fallback also "
                        "failed. All other QA checks are unaffected."
                    ),
                }

            # ── Scroll to trigger lazy loading ────────────────────────────────
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

            # ── Resize viewport ───────────────────────────────────────────────
            await page.set_viewport_size({"width": 1280, "height": full_height})
            await asyncio.sleep(1)

            # ── Take screenshot ───────────────────────────────────────────────
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
