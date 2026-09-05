import httpx
from app.config import settings

PAGESPEED_API_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"


async def get_pagespeed(url: str, strategy: str = "mobile") -> dict:
    """
    Fetch PageSpeed Insights scores and Core Web Vitals for a URL.

    Uses a list of tuples for params so the category key is repeated
    correctly — required by the PageSpeed Insights API.

    NOTE: Always reflects the production version of the page.
    The challenger server cannot be tested via PageSpeed Insights.
    """
    params = [
        ("url", url),
        ("key", settings.PAGESPEED_API_KEY),
        ("strategy", strategy),
        ("category", "performance"),
        ("category", "accessibility"),
        ("category", "best-practices"),
        ("category", "seo"),
    ]

    async with httpx.AsyncClient(timeout=90.0) as client:
        try:
            response = await client.get(PAGESPEED_API_URL, params=params)
            response.raise_for_status()
            data = response.json()

            lh     = data.get("lighthouseResult", {})
            cats   = lh.get("categories", {})
            audits = lh.get("audits", {})

            def score(key: str):
                s = cats.get(key, {}).get("score")
                return round(s * 100) if s is not None else None

            return {
                "success": True,
                "strategy": strategy,
                "scores": {
                    "performance":    score("performance"),
                    "accessibility":  score("accessibility"),
                    "best_practices": score("best-practices"),
                    "seo":            score("seo"),
                },
                "metrics": {
                    "first_contentful_paint":   audits.get("first-contentful-paint", {}).get("displayValue"),
                    "largest_contentful_paint": audits.get("largest-contentful-paint", {}).get("displayValue"),
                    "total_blocking_time":      audits.get("total-blocking-time", {}).get("displayValue"),
                    "cumulative_layout_shift":  audits.get("cumulative-layout-shift", {}).get("displayValue"),
                    "speed_index":              audits.get("speed-index", {}).get("displayValue"),
                    "time_to_interactive":      audits.get("interactive", {}).get("displayValue"),
                },
            }

        except httpx.HTTPStatusError as e:
            return {
                "success": False,
                "error": f"PageSpeed API returned HTTP {e.response.status_code}.",
                "scores": None,
                "metrics": None,
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "scores": None,
                "metrics": None,
            }
