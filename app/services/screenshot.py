import asyncio
import base64

from playwright.async_api import async_playwright
from playwright.async_api import TimeoutError as PlaywrightTimeout
from playwright_stealth import stealth_async


async def take_screenshot(url: str) -> dict:
    """
    Take a full-page screenshot using Playwright with headless Chromium.

    Uses playwright-stealth to bypass Cloudflare and other bot detection
    systems. This makes the browser appear as a real Chrome browser.

    Steps:
      1. Launch Chromium with stealth settings
      2. Apply stealth patches to avoid bot detection
      3. Load the page and wait for network to settle
      4. Scroll through the entire page to trigger lazy loading
      5. Resize viewport to full page height
      6. Take the full-page screenshot
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

            # ── Apply stealth patches ─────────────────────────────────────────
            # This removes all traces of automation from the browser
            await stealth_async(page)

            # ── Load page ─────────────────────────────────────────────────────
            try:
                await page.goto(url, wait_until="networkidle", timeout=40000)
            except PlaywrightTimeout:
                try:
                    await page.goto(url, wait_until="load", timeout=25000)
                except PlaywrightTimeout:
                    await page.goto(url, wait_until="domcontentloaded", timeout=15000)

            # Wait for page to fully render including any challenge pages
            await asyncio.sleep(3)

            # Check if we hit a Cloudflare challenge page
            title = await page.title()
            content = await page.content()
            is_challenge = (
                "just a moment" in title.lower()
                or "cloudflare" in title.lower()
                or "verify you are human" in content.lower()
                or "checking your browser" in content.lower()
            )

            if is_challenge:
                # Wait longer for the challenge to auto-resolve
                print(f"[screenshot] Cloudflare challenge detected for {url} — waiting...")
                await asyncio.sleep(8)
                # Check if it resolved
                title = await page.title()
                is_still_challenge = (
                    "just a moment" in title.lower()
                    or "cloudflare" in title.lower()
                )
                if is_still_challenge:
                    print(f"[screenshot] Challenge did not resolve for {url}")

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
            "error":        "Page load timed out.",
        }
    except Exception as e:
        return {
            "success":      False,
            "image_base64": None,
            "error":        f"Screenshot failed: {str(e)}",
        }
