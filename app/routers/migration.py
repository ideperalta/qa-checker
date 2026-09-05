import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app.models.schemas import MigrationCheckRequest
from app.services import cta_checker as cta_svc
from app.services import crawler as crawler_svc
from app.services import gemini as ai_svc
from app.services import scraper as scraper_svc
from app.services import screenshot as screenshot_svc

router = APIRouter()


@router.post("/migration-check")
async def run_migration_check(req: MigrationCheckRequest):
    """
    Main migration QA endpoint.

    Execution order:
      1. Scrape both homepages concurrently
      2. Take full-page screenshots concurrently
      3. Crawl page inventories from both sites concurrently
      4. Compare page lists (paths normalized across domains)
      5. Extract and compare CTAs from both homepages
      6. Run Gemini AI similarity analysis
      7. Compute overall weighted similarity score
      8. Return all results in a single structured response
    """
    ple_url   = req.ple_url.strip()
    evona_url = req.evona_url.strip()

    for label, url in [("PLE URL", ple_url), ("EVONA URL", evona_url)]:
        if not url.startswith("http://") and not url.startswith("https://"):
            raise HTTPException(
                status_code=400,
                detail=f"{label} must begin with http:// or https://",
            )

    # ── Step 1: Scrape both homepages concurrently ────────────────────────────
    ple_scrape_raw, evona_scrape_raw = await asyncio.gather(
        scraper_svc.fetch_page(ple_url),
        scraper_svc.fetch_page(evona_url),
        return_exceptions=True,
    )

    ple_scrape = (
        ple_scrape_raw
        if not isinstance(ple_scrape_raw, Exception)
        else {"success": False, "html": None, "error": str(ple_scrape_raw)}
    )
    evona_scrape = (
        evona_scrape_raw
        if not isinstance(evona_scrape_raw, Exception)
        else {"success": False, "html": None, "error": str(evona_scrape_raw)}
    )

    # ── Steps 2 & 3: Screenshots + page crawling concurrently ─────────────────
    concurrent_tasks  = []
    task_labels       = []

    if req.include_screenshots:
        concurrent_tasks.append(screenshot_svc.take_screenshot(ple_url))
        task_labels.append("ple_screenshot")
        concurrent_tasks.append(screenshot_svc.take_screenshot(evona_url))
        task_labels.append("evona_screenshot")

    if req.include_page_scan:
        concurrent_tasks.append(crawler_svc.get_pages(ple_url))
        task_labels.append("ple_pages")
        concurrent_tasks.append(crawler_svc.get_pages(evona_url))
        task_labels.append("evona_pages")

    side_results = {}
    if concurrent_tasks:
        concurrent_raw = await asyncio.gather(
            *concurrent_tasks, return_exceptions=True
        )
        for label, result in zip(task_labels, concurrent_raw):
            side_results[label] = (
                result
                if not isinstance(result, Exception)
                else {"success": False, "error": str(result)}
            )

    # ── Step 4: Page coverage comparison ──────────────────────────────────────
    page_scan     = None
    page_coverage = None

    if (
        req.include_page_scan
        and "ple_pages" in side_results
        and "evona_pages" in side_results
    ):
        ple_p   = side_results["ple_pages"]
        evona_p = side_results["evona_pages"]

        if ple_p.get("success") and evona_p.get("success"):
            page_scan = crawler_svc.compare_page_lists(
                ple_p["pages"],
                evona_p["pages"],
                ple_url,
                evona_url,
            )
            page_scan["ple_method"]   = ple_p.get("method")
            page_scan["evona_method"] = evona_p.get("method")
            page_coverage             = page_scan["coverage_percent"]

    # ── Step 5: CTA check ─────────────────────────────────────────────────────
    cta_result     = None
    cta_match_rate = None

    if (
        req.include_cta_check
        and ple_scrape.get("success")
        and evona_scrape.get("success")
    ):
        ple_ctas   = cta_svc.extract_ctas(ple_scrape["html"],   ple_url)
        evona_ctas = cta_svc.extract_ctas(evona_scrape["html"], evona_url)

        evona_checked = await cta_svc.check_link_validity(evona_ctas)
        evona_broken  = [c for c in evona_checked if not c.get("valid")]

        comparison     = cta_svc.compare_ctas(ple_ctas, evona_ctas)
        cta_match_rate = comparison["match_rate"]

        cta_result = {
            "ple_cta_count":      len(ple_ctas),
            "evona_cta_count":    len(evona_ctas),
            "evona_broken":       evona_broken,
            "evona_broken_count": len(evona_broken),
            "comparison":         comparison,
        }

    # ── Step 6: AI similarity analysis ────────────────────────────────────────
    ai_result = None

    if (
        req.include_ai_analysis
        and ple_scrape.get("success")
        and evona_scrape.get("success")
    ):
        ai_result = await ai_svc.analyze_similarity(
            ple_html       = ple_scrape["html"],
            evona_html     = evona_scrape["html"],
            ple_url        = ple_url,
            evona_url      = evona_url,
            page_coverage  = page_coverage,
            cta_match_rate = cta_match_rate,
        )

    # ── Step 7: Weighted overall similarity score ─────────────────────────────
    # Weights: AI content analysis 40%, page coverage 30%, CTA match 30%
    # Normalises correctly when not all signals are available.
    numerator   = 0.0
    denominator = 0.0

    if ai_result and ai_result.get("success") and ai_result.get("analysis"):
        ai_score = ai_result["analysis"].get("similarity_score")
        if ai_score is not None:
            numerator   += float(ai_score) * 0.4
            denominator += 0.4

    if page_coverage is not None:
        numerator   += float(page_coverage) * 0.3
        denominator += 0.3

    if cta_match_rate is not None:
        numerator   += float(cta_match_rate) * 0.3
        denominator += 0.3

    overall_similarity = (
        round(numerator / denominator) if denominator > 0 else None
    )

    # ── Build and return response ─────────────────────────────────────────────
    return {
        "ple_url":            ple_url,
        "evona_url":          evona_url,
        "timestamp":          datetime.now(timezone.utc).isoformat(),
        "overall_similarity": overall_similarity,
        "screenshots": {
            "ple":   side_results.get("ple_screenshot"),
            "evona": side_results.get("evona_screenshot"),
        } if req.include_screenshots else None,
        "page_scan":   page_scan,
        "cta_check":   cta_result,
        "ai_analysis": ai_result,
        "scrape_status": {
            "ple":   {"success": ple_scrape.get("success"),   "error": ple_scrape.get("error")},
            "evona": {"success": evona_scrape.get("success"), "error": evona_scrape.get("error")},
        },
    }


@router.get("/status")
async def service_status():
    return {
        "status": "ok",
        "services": {
            "scraper":     "ScraperAPI",
            "screenshots": "ScraperAPI Screenshots",
            "ai":          "Google Gemini 1.5 Pro",
            "crawler":     "Internal sitemap/link crawler",
            "cta_checker": "Internal CTA validator",
        },
    }