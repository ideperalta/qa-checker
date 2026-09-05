import json
import re
from typing import Optional

import google.generativeai as genai
from bs4 import BeautifulSoup

from app.config import settings

genai.configure(api_key=settings.GOOGLE_AI_API_KEY)

MODEL_NAME = "gemini-1.5-pro-latest"


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
    Strip markdown code fences from a Gemini response and parse JSON.
    Falls back to returning the raw text if JSON parsing fails.
    """
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text).strip()

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

Return ONLY a valid JSON object with no markdown fences and no extra text outside the JSON:
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

        generation_config = genai.GenerationConfig(
            temperature=0.1,
            max_output_tokens=4096,
        )

        response = await model.generate_content_async(
            prompt,
            generation_config=generation_config,
        )

        return {
            "success":  True,
            "analysis": _parse_gemini_json(response.text),
        }

    except Exception as e:
        return {
            "success":  False,
            "error":    str(e),
            "analysis": None,
        }