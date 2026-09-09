async def get_rendered_html(url: str, pre_fetched_html: str) -> dict:
    """
    Render pre-fetched HTML via Playwright set_content() and return the
    fully rendered page HTML with JavaScript executed.
    Uses the same base tag injection + route interception as take_screenshot()
    so JS-injected meta tags, titles, and OG tags are captured correctly.
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
                java_script_enabled=True,
                locale="en-US",
                timezone_id="America/New_York",
            )

            page = await context.new_page()
            await stealth_async(page)

            # Inject <base href> so relative paths resolve to real domain
            html_with_base = _inject_base_tag(pre_fetched_html, url)
            target_netloc  = urlparse(url).netloc
            resource_cache: dict = {}

            async def _proxy_resources(route, request):
                req_url    = request.url
                req_netloc = urlparse(req_url).netloc
                if req_netloc == target_netloc:
                    if req_url in resource_cache:
                        cached = resource_cache[req_url]
                        await route.fulfill(
                            status=200,
                            content_type=cached[0],
                            body=cached[1],
                        )
                        return
                    result = await _fetch_resource_via_scraperapi(req_url)
                    if result:
                        resource_cache[req_url] = result
                        await route.fulfill(
                            status=200,
                            content_type=result[0],
                            body=result[1],
                        )
                        return
                try:
                    await route.continue_()
                except Exception:
                    await route.abort()

            await page.route("**/*", _proxy_resources)

            # Render HTML via set_content — no URL visit = no Cloudflare check
            try:
                await page.set_content(
                    html_with_base,
                    wait_until="networkidle",
                    timeout=30000,
                )
            except PlaywrightTimeout:
                try:
                    await page.set_content(
                        html_with_base,
                        wait_until="domcontentloaded",
                        timeout=15000,
                    )
                except Exception:
                    pass

            # Wait for JS frameworks to finish injecting meta tags
            await asyncio.sleep(5)

            html = await page.content()
            await browser.close()

            print(
                f"[seo] Playwright rendered HTML captured for {url} "
                f"({len(html):,} chars, {len(resource_cache)} resources proxied)"
            )

            return {
                "success": True,
                "html":    html,
                "error":   None,
            }

    except Exception as exc:
        print(f"[seo] Playwright render failed for {url}: {exc}")
        return {
            "success": False,
            "html":    None,
            "error":   str(exc),
        }