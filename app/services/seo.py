import json
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup


def extract_seo(html: str, base_url: str) -> dict:
    """
    Extract all SEO-relevant elements from a page.
    Returns a structured dict of every measurable SEO signal.
    """
    soup = BeautifulSoup(html, "lxml")
    parsed_base = urlparse(base_url)

    # ── Title ─────────────────────────────────────────────────────────────────
    title = soup.title.string.strip() if soup.title and soup.title.string else None

    # ── Meta tags ─────────────────────────────────────────────────────────────
    description         = None
    robots              = None
    og_title            = None
    og_description      = None
    og_image            = None
    og_url              = None
    twitter_card        = None
    twitter_title       = None
    twitter_description = None

    for tag in soup.find_all("meta"):
        name    = tag.get("name",     "").lower()
        prop    = tag.get("property", "").lower()
        content = tag.get("content",  "")

        if   name == "description":         description         = content
        elif name == "robots":              robots              = content
        elif name == "twitter:card":        twitter_card        = content
        elif name == "twitter:title":       twitter_title       = content
        elif name == "twitter:description": twitter_description = content
        elif prop == "og:title":            og_title            = content
        elif prop == "og:description":      og_description      = content
        elif prop == "og:image":            og_image            = content
        elif prop == "og:url":              og_url              = content

    # ── Canonical ─────────────────────────────────────────────────────────────
    canonical     = None
    canonical_tag = soup.find("link", {"rel": "canonical"})
    if canonical_tag:
        canonical = canonical_tag.get("href")

    # ── Headings ──────────────────────────────────────────────────────────────
    h1_tags = [h.get_text(strip=True) for h in soup.find_all("h1")]
    h2_tags = [h.get_text(strip=True) for h in soup.find_all("h2")]
    h3_tags = [h.get_text(strip=True) for h in soup.find_all("h3")]

    # ── Images ────────────────────────────────────────────────────────────────
    all_images         = soup.find_all("img")
    image_count        = len(all_images)
    images_missing_alt = sum(1 for img in all_images if not img.get("alt"))

    # ── Links ─────────────────────────────────────────────────────────────────
    internal_links = set()
    external_links = set()

    for a in soup.find_all("a", href=True):
        href = a.get("href", "").strip()
        if not href or href.startswith("#"):
            continue
        if href.startswith("mailto:") or href.startswith("tel:"):
            continue
        full_url    = urljoin(base_url, href)
        parsed_href = urlparse(full_url)
        if parsed_href.netloc == parsed_base.netloc:
            internal_links.add(full_url)
        else:
            external_links.add(full_url)

    # ── Schema markup ─────────────────────────────────────────────────────────
    schema_types = []
    for script in soup.find_all("script", {"type": "application/ld+json"}):
        try:
            data = json.loads(script.string or "")
            if isinstance(data, dict):
                t = data.get("@type")
                if t:
                    schema_types.append(
                        t if isinstance(t, str) else ", ".join(t)
                    )
            elif isinstance(data, list):
                for item in data:
                    if isinstance(item, dict):
                        t = item.get("@type")
                        if t:
                            schema_types.append(
                                t if isinstance(t, str) else ", ".join(t)
                            )
        except Exception:
            pass

    # ── Word count ────────────────────────────────────────────────────────────
    for el in soup(["script", "style", "noscript"]):
        el.decompose()
    word_count = len(soup.get_text(separator=" ", strip=True).split())

    return {
        "title":                title,
        "title_length":         len(title) if title else 0,
        "description":          description,
        "description_length":   len(description) if description else 0,
        "robots":               robots,
        "canonical":            canonical,
        "h1_tags":              h1_tags,
        "h1_count":             len(h1_tags),
        "h2_tags":              h2_tags[:8],
        "h2_count":             len(h2_tags),
        "h3_count":             len(h3_tags),
        "og_title":             og_title,
        "og_description":       og_description,
        "og_image":             og_image,
        "og_url":               og_url,
        "twitter_card":         twitter_card,
        "twitter_title":        twitter_title,
        "twitter_description":  twitter_description,
        "image_count":          image_count,
        "images_missing_alt":   images_missing_alt,
        "internal_link_count":  len(internal_links),
        "external_link_count":  len(external_links),
        "schema_types":         schema_types,
        "word_count":           word_count,
    }


def _row(field: str, ple_val, evona_val) -> dict:
    """
    Compare one SEO field and return a result row with a status.

    Status values:
      match        — both have the same value
      mismatch     — both have a value but they differ
      missing      — PLE has it, EVONA does not
      extra        — EVONA has it, PLE does not
      both_missing — neither site has this field
    """
    p = str(ple_val).strip().lower()   if ple_val   is not None else None
    e = str(evona_val).strip().lower() if evona_val is not None else None

    if   p is None and e is None:     status = "both_missing"
    elif p is None and e is not None: status = "extra"
    elif p is not None and e is None: status = "missing"
    elif p == e:                      status = "match"
    else:                             status = "mismatch"

    return {
        "field":       field,
        "ple_value":   str(ple_val)   if ple_val   is not None else None,
        "evona_value": str(evona_val) if evona_val is not None else None,
        "status":      status,
    }


def compare_seo(ple: dict, evona: dict) -> dict:
    """
    Compare SEO data from PLE and EVONA side by side.
    Returns a score, summary counts, and a row-by-row comparison table.
    Fixed: removed duplicate OG Title and Schema Markup rows.
    """
    rows = [
        # Core meta
        _row("Title Tag",
             ple.get("title"),
             evona.get("title")),
        _row("Title Length (chars)",
             ple.get("title_length"),
             evona.get("title_length")),
        _row("Meta Description",
             ple.get("description"),
             evona.get("description")),
        _row("Meta Desc Length",
             ple.get("description_length"),
             evona.get("description_length")),
        _row("Canonical URL",
             ple.get("canonical"),
             evona.get("canonical")),
        _row("Meta Robots",
             ple.get("robots"),
             evona.get("robots")),
        # Headings
        _row("H1 Count",
             ple.get("h1_count"),
             evona.get("h1_count")),
        _row("H1 Text (first)",
             ple.get("h1_tags",  [""])[0] if ple.get("h1_tags")   else None,
             evona.get("h1_tags",[""])[0] if evona.get("h1_tags") else None),
        _row("H2 Count",
             ple.get("h2_count"),
             evona.get("h2_count")),
        _row("H3 Count",
             ple.get("h3_count"),
             evona.get("h3_count")),
        # Open Graph — Fixed: removed duplicate OG Title row
        _row("OG Title",
             ple.get("og_title"),
             evona.get("og_title")),
        _row("OG Description",
             ple.get("og_description"),
             evona.get("og_description")),
        _row("OG Image",
             ple.get("og_image"),
             evona.get("og_image")),
        _row("OG URL",
             ple.get("og_url"),
             evona.get("og_url")),
        # Twitter
        _row("Twitter Card",
             ple.get("twitter_card"),
             evona.get("twitter_card")),
        _row("Twitter Title",
             ple.get("twitter_title"),
             evona.get("twitter_title")),
        _row("Twitter Description",
             ple.get("twitter_description"),
             evona.get("twitter_description")),
        # Content signals
        _row("Word Count",
             ple.get("word_count"),
             evona.get("word_count")),
        _row("Image Count",
             ple.get("image_count"),
             evona.get("image_count")),
        _row("Images Missing Alt",
             ple.get("images_missing_alt"),
             evona.get("images_missing_alt")),
        _row("Internal Links",
             ple.get("internal_link_count"),
             evona.get("internal_link_count")),
        _row("External Links",
             ple.get("external_link_count"),
             evona.get("external_link_count")),
        # Schema — Fixed: removed duplicate Schema Markup row
        _row("Schema Markup",
             ", ".join(ple.get("schema_types",  [])) or None,
             ", ".join(evona.get("schema_types",[])) or None),
    ]

    match_count    = sum(1 for r in rows if r["status"] == "match")
    mismatch_count = sum(1 for r in rows if r["status"] == "mismatch")
    missing_count  = sum(1 for r in rows if r["status"] == "missing")
    extra_count    = sum(1 for r in rows if r["status"] == "extra")
    both_missing   = sum(1 for r in rows if r["status"] == "both_missing")
    comparable     = len(rows) - both_missing
    seo_score      = round(match_count / comparable * 100) if comparable > 0 else 0

    return {
        "seo_score":      seo_score,
        "match_count":    match_count,
        "mismatch_count": mismatch_count,
        "missing_count":  missing_count,
        "extra_count":    extra_count,
        "total_fields":   len(rows),
        "rows":           rows,
    }
