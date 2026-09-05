import httpx
from app.config import settings

SCRAPERAPI_ENDPOINT = "https://api.scraperapi.com/"


async def fetch_page(
    url: str,
    render_js: bool = True,
    timeout: float = 120.0,
) -> dict:
    """
    Fetch a page through ScraperAPI.
    No bypass header needed — each URL is a separate domain.
    """
    params = {
        "api_key": settings.SCRAPERAPI_KEY,
        "url": url,
        "render": "true" if render_js else "false",
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.get(SCRAPERAPI_ENDPOINT, params=params)
            response.raise_for_status()
            return {
                "success": True,
                "status_code": response.status_code,
                "html": response.text,
                "error": None,
            }
        except httpx.TimeoutException:
            return {
                "success": False,
                "status_code": None,
                "html": None,
                "error": "Request timed out after 120 seconds.",
            }
        except httpx.HTTPStatusError as e:
            return {
                "success": False,
                "status_code": e.response.status_code,
                "html": None,
                "error": f"HTTP {e.response.status_code}",
            }
        except Exception as e:
            return {
                "success": False,
                "status_code": None,
                "html": None,
                "error": str(e),
            }