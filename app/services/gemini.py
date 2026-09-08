import json
import re
from typing import Optional

import google.generativeai as genai
from bs4 import BeautifulSoup

from app.config import settings

genai.configure(api_key=settings.GOOGLE_AI_API_KEY)

# gemini-2.5-flash is fast, cost-effective and supports JSON mode
MODEL_NAME = "gemini-2.5-flash"


# ── Internal helpers ──────────────────────────────────────────────────────────

def _extract_text_and_meta(html: str) -> tuple:
    """
    Parse raw HTML and return (clean_text, meta_dict).
    Strips scripts, styles, and SVG before extracting text.
    Caps text at 6000 characters to stay within Gemini context limits.
    """
    soup = BeautifulSoup(html, "lxml")

    meta = {
        "title":        soup.title.string.strip() if soup.title and soup.title.string else None,
        "description":  None,
        "h1_tags":      [h.get_text(strip=True) for h in soup.find_all("h1")][:5],
        "h2_tags":      [h.get_text(strip=True) for h in soup.find_all("h2")][:8],
        "image_count":  len(soup.find_all("img")),
        "link_count":   len(soup.find_all("a")),
        "form_count":   len(soup.find_all("form")),
        "button_count": len(soup.find_all("button")),
    }

    for tag in soup.find_all("meta"):
        if tag.get("name", "").lower() == "description":
            meta["description"] = tag.get("content", "")

    for el in soup(["script", "style", "noscript", "svg", "path"]):
        el.decompose()

    text = soup.get_text(separator="\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text[:6000], meta


def _parse_gemini_json(raw: str) -> dict:
    """
    Parse Gemini response as JSON.
    Handles three cases:
      1. Pure JSON (when response_mime_type='application/json')
      2. Markdown fenced JSON (```json ... ```)
      3. Raw text fallback
    """
    text = raw.strip()

    # Case 1: Try direct JSON parse first (response_mime_type mode)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Case 2: Strip markdown fences and try again
    text = re.sub(r"^```(?:json)?\s*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Case 3: Find JSON object within text
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    return {"raw_response": text}


# ── Public functions ──────────────────────────────────────────────────────────

async def analyze_similarity(
    ple_html: str,
    evona_html: str,
    ple_url: str,
    evona_url: str,
    page_coverage: Optional[int] = None,
    cta_match_rate: Optional[int] = None,
) -> dict:
    """
    AI-powered similarity analysis between the PLE (original)
    and EVONA (migrated) versions of a site.

    Uses response_mime_type='application/json' to force Gemini to return
    valid JSON without markdown fences — prevents truncation and type errors.

    Returns a similarity score, a category breakdown, a list of
    issues found, what migrated well, and recommendations.
    """
    try:
        model = genai.GenerativeModel(MODEL_NAME)

        ple_text,   ple_meta   = _extract_text_and_meta(ple_html)
        evona_text, evona_meta = _extract_text_and_meta(evona_html)

        extra_context = ""
        if page_coverage is not None:
            extra_context += (
                f"\nPage Coverage: {page_coverage}% of PLE pages found in EVONA"
            )
        if cta_match_rate is not None:
            extra_context += (
                f"\nCTA Match Rate: {cta_match_rate}% of CTAs matched correctly"
            )

        prompt = f"""You are a senior QA engineer auditing a website migration \
from the PLE platform (original) to the EVONA platform (migrated).
Determine how complete and accurate the migration is by comparing the two homepages.

PLE  (Original) : {ple_url}
EVONA (Migrated): {evona_url}
{extra_context}

PLE HOMEPAGE METADATA:
{json.dumps(ple_meta, indent=2)}

EVONA HOMEPAGE METADATA:
{json.dumps(evona_meta, indent=2)}

PLE HOMEPAGE CONTENT SAMPLE:
{ple_text[:2500]}

EVONA HOMEPAGE CONTENT SAMPLE:
{evona_text[:2500]}

Analyse how complete and accurate the migration is. Consider:
1. Content parity  — same copy, products, services, pricing
2. Structural parity — same sections and page layout
3. Metadata parity — title tags, meta descriptions, headings
4. Feature completeness — forms, CTAs, navigation, media
5. Anything missing or broken in the EVONA version

Return a JSON object with this exact structure:
{{
  "similarity_score": <integer 0-100>,
  "summary": "<2-3 sentence executive summary of the migration quality>",
  "content_match": <integer 0-100>,
  "structure_match": <integer 0-100>,
  "metadata_match": <integer 0-100>,
  "feature_completeness": <integer 0-100>,
  "issues": [
    {{
      "severity": "<critical|warning|info>",
      "category": "<content|structure|seo|cta|media|other>",
      "description": "<specific issue found in the migration>"
    }}
  ],
  "whats_good": ["<thing that migrated correctly>"],
  "recommendations": ["<specific action to improve the migration>"]
}}"""

        # Fixed: use response_mime_type to force valid JSON output
        # and increase max_output_tokens to prevent truncation
        generation_config = genai.GenerationConfig(
            temperature=0.1,
            max_output_tokens=8192,
            response_mime_type="application/json",
        )

        response = await model.generate_content_async(
            prompt,
            generation_config=generation_config,
        )

        parsed = _parse_gemini_json(response.text)

        # Validate required integer fields are actually integers
        for field in [
            "similarity_score", "content_match",
            "structure_match", "metadata_match", "feature_completeness"
        ]:
            val = parsed.get(field)
            if val is not None and not isinstance(val, int):
                try:
                    parsed[field] = int(float(str(val)))
                except (ValueError, TypeError):
                    parsed[field] = None

        return {
            "success":  True,
            "analysis": parsed,
        }

    except Exception as e:
        return {
            "success":  False,
            "error":    str(e),
            "analysis": None,
        }
