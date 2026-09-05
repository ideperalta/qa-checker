import asyncio
import base64

from playwright.async_api import async_playwright
from playwright.async_api import TimeoutError as PlaywrightTimeout


async def take_screenshot(url: str) -> dict:
    """
    Take a full-page screenshot using Playwright with headless Chromium.

    Approach:
      1. Load the page and wait for network to settle
      2. Scroll through the entire page to trigger lazy-loaded content
      3. Read the full scroll height of the page
      4. Resize the viewport to match the full scroll height
      5. Take a screenshot capturing the entire page
    """
    try:
        async with async_playwright() as p:

            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
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
            )

            page = await context.new_page()

            # ── Load page ─────────────────────────────────────────────────────
            try:
                await page.goto(url, wait_until="networkidle", timeout=30000)
            except PlaywrightTimeout:
                try:
                    await page.goto(url, wait_until="load", timeout=20000)
                except PlaywrightTimeout:
                    await page.goto(url, wait_until="domcontentloaded", timeout=15000)

            await asyncio.sleep(2)

            # ── Scroll through page to trigger lazy loading ───────────────────
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
            }

    except PlaywrightTimeout:
        return {
            "success":      False,
            "image_base64": None,
            "error": "Page load timed out.",
        }
    except Exception as e:
        return {
            "success":      False,
            "image_base64": None,
            "error":        f"Screenshot failed: {str(e)}",
        }
