// ── Site-wide score ───────────────────────────────────────────
function calculateScore(baseline, challenger, analysis, multiPage) {
  const ai   = analysis.categoryScores || {};
  const algo = {
    content:    scoreContent(baseline, challenger),
    navigation: scoreNavigation(baseline, challenger),
    seo:        scoreSeo(baseline, challenger),
    forms:      scoreForms(baseline, challenger),
    design:     75
  };

  const categories = {
    content:    clamp(ai.content    ?? algo.content),
    navigation: clamp(ai.navigation ?? algo.navigation),
    seo:        clamp(ai.seo        ?? algo.seo),
    forms:      clamp(ai.forms      ?? algo.forms),
    design:     clamp(ai.design     ?? algo.design)
  };

  let overall = clamp(analysis.matchPercentage ?? Math.round(
    categories.content    * 0.30 +
    categories.navigation * 0.25 +
    categories.seo        * 0.20 +
    categories.forms      * 0.15 +
    categories.design     * 0.10
  ));

  // Penalise for missing pages
  if (multiPage && multiPage.missingFromChallenger) {
    const total   = (multiPage.pageResults || []).length + multiPage.missingFromChallenger.length;
    const missing = multiPage.missingFromChallenger.length;
    if (total > 0) {
      const missingPenalty = Math.round((missing / total) * 30);
      overall = clamp(overall - missingPenalty);
    }
  }

  // Average across page results if available
  if (multiPage && multiPage.pageResults && multiPage.pageResults.length > 0) {
    const avgPageScore = Math.round(
      multiPage.pageResults.reduce((sum, p) => sum + p.score, 0) / multiPage.pageResults.length
    );
    overall = clamp(Math.round(overall * 0.5 + avgPageScore * 0.5));
  }

  return {
    overall,
    categories,
    issueCount: {
      critical:      (analysis.criticalIssues  || []).length,
      warnings:      (analysis.warnings        || []).length,
      informational: (analysis.informational   || []).length
    },
    stats: {
      baseline: {
        wordCount: baseline.wordCount,
        headings:  baseline.headings.length,
        images:    baseline.images.length,
        navItems:  baseline.navigation.length,
        forms:     baseline.forms.length
      },
      challenger: {
        wordCount: challenger.wordCount,
        headings:  challenger.headings.length,
        images:    challenger.images.length,
        navItems:  challenger.navigation.length,
        forms:     challenger.forms.length
      }
    }
  };
}

// ── Per-page comparison ───────────────────────────────────────
function comparePagePair(baseline, challenger) {
  const issues = [];
  let score    = 100;

  // H1 missing
  if (baseline.h1.length > 0 && challenger.h1.length === 0) {
    issues.push({ severity: 'critical', msg: 'H1 heading is missing' });
    score -= 20;
  }

  // H1 changed
  if (
    baseline.h1.length > 0 && challenger.h1.length > 0 &&
    baseline.h1[0].toLowerCase() !== challenger.h1[0].toLowerCase()
  ) {
    issues.push({ severity: 'warning', msg: `H1 changed: "${baseline.h1[0]}" → "${challenger.h1[0]}"` });
  }

  // Word count
  if (baseline.wordCount > 50) {
    const ratio = challenger.wordCount / baseline.wordCount;
    if (ratio < 0.5) {
      issues.push({ severity: 'critical', msg: `Word count dropped ${Math.round((1 - ratio) * 100)}% (${baseline.wordCount} → ${challenger.wordCount})` });
      score -= 25;
    } else if (ratio < 0.8) {
      issues.push({ severity: 'warning', msg: `Word count reduced ${Math.round((1 - ratio) * 100)}% (${baseline.wordCount} → ${challenger.wordCount})` });
      score -= 10;
    }
  }

  // Headings
  if (baseline.headings.length > 2 && challenger.headings.length < baseline.headings.length * 0.5) {
    issues.push({ severity: 'warning', msg: `Headings dropped from ${baseline.headings.length} to ${challenger.headings.length}` });
    score -= 10;
  }

  // Images
  if (baseline.images.length > 2 && challenger.images.length < baseline.images.length * 0.5) {
    issues.push({ severity: 'warning', msg: `Images reduced from ${baseline.images.length} to ${challenger.images.length}` });
    score -= 5;
  }

  // Meta description
  if (baseline.metaDescription && !challenger.metaDescription) {
    issues.push({ severity: 'warning', msg: 'Meta description missing' });
    score -= 10;
  }

  // Schema
  if (baseline.hasSchema && !challenger.hasSchema) {
    issues.push({ severity: 'warning', msg: 'Schema markup missing' });
    score -= 10;
  }

  // Forms
  if (baseline.forms.length > 0 && challenger.forms.length < baseline.forms.length) {
    issues.push({ severity: 'critical', msg: `Forms reduced from ${baseline.forms.length} to ${challenger.forms.length}` });
    score -= 20;
  }

  // Title
  if (baseline.title && challenger.title && baseline.title !== challenger.title) {
    issues.push({ severity: 'info', msg: `Title changed: "${baseline.title}" → "${challenger.title}"` });
  }

  return { score: clamp(score), issues };
}

// ── Individual scorers ────────────────────────────────────────
function scoreContent(b, c) {
  if (b.wordCount === 0) return 100;
  const wordRatio = Math.min(c.wordCount    / b.wordCount,    1.3);
  const headRatio = b.headings.length > 0
    ? Math.min(c.headings.length / b.headings.length, 1.3) : 1;
  const paraRatio = b.paragraphs && b.paragraphs.length > 0
    ? Math.min(c.paragraphs.length / b.paragraphs.length, 1.3) : 1;
  const wordScore = wordRatio >= 0.8 ? 100 : (wordRatio / 0.8) * 100;
  const headScore = headRatio >= 0.7 ? 100 : (headRatio / 0.7) * 100;
  const paraScore = paraRatio >= 0.7 ? 100 : (paraRatio / 0.7) * 100;
  return clamp(Math.round(wordScore * 0.45 + headScore * 0.30 + paraScore * 0.25));
}

function scoreNavigation(b, c) {
  if (b.navigation.length === 0) return 100;
  const bItems = b.navigation.map(n => n.text.toLowerCase().trim());
  const cItems = c.navigation.map(n => n.text.toLowerCase().trim());
  let matched = 0;
  bItems.forEach(item => {
    if (cItems.some(ci => ci === item || ci.includes(item) || item.includes(ci))) matched++;
  });
  return clamp(Math.round((matched / bItems.length) * 100));
}

function scoreSeo(b, c) {
  let score = 100;
  if (b.title           && !c.title)           score -= 20;
  if (b.metaDescription && !c.metaDescription) score -= 20;
  if (b.canonicalUrl    && !c.canonicalUrl)    score -= 10;
  if (b.hasSchema       && !c.hasSchema)       score -= 15;
  if (b.h1.length > 0   && c.h1.length === 0) score -= 15;
  const bOg = Object.values(b.ogTags || {}).filter(Boolean).length;
  const cOg = Object.values(c.ogTags || {}).filter(Boolean).length;
  if (bOg > 0 && cOg < bOg) score -= Math.round(((bOg - cOg) / bOg) * 10);
  return clamp(score);
}

function scoreForms(b, c) {
  if (b.forms.length === 0) return 100;
  if (c.forms.length === 0) return 0;
  const countScore = Math.min(c.forms.length / b.forms.length, 1) * 70;
  let   fieldScore = 30;
  b.forms.forEach((bf, i) => {
    const cf = c.forms[i];
    if (!cf) { fieldScore -= 15; return; }
    if (bf.fields.length > 0 && cf.fields.length < bf.fields.length) {
      fieldScore -= Math.round(((bf.fields.length - cf.fields.length) / bf.fields.length) * 10);
    }
  });
  return clamp(Math.round(countScore + Math.max(0, fieldScore)));
}

function clamp(n) {
  return Math.min(100, Math.max(0, Math.round(n || 0)));
}

module.exports = { calculateScore, comparePagePair };