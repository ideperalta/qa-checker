const { GoogleGenerativeAI } = require('@google/generative-ai');
let genAI = null;

function getClient() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set.');
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

async function analyzeWithGemini(baseline, challenger, multiPageContext) {
  var MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-1.0-pro'];
  for (var i = 0; i < MODELS.length; i++) {
    try {
      var client = getClient();
      var model  = client.getGenerativeModel({ model: MODELS[i], generationConfig: { temperature: 0.2, maxOutputTokens: 4096 } });
      console.log('  Trying Gemini model: ' + MODELS[i]);
      var result = await model.generateContent(buildPrompt(summarize(baseline), summarize(challenger), multiPageContext));
      var text   = result.response.text();
      console.log('  ✅ Gemini worked: ' + MODELS[i]);
      return parseJsonSafely(text);
    } catch (err) {
      console.warn('  Model ' + MODELS[i] + ' failed: ' + err.message);
      if (i === MODELS.length - 1) return algorithmicFallback(baseline, challenger, multiPageContext);
    }
  }
}

function summarize(site) {
  return {
    url:             site.url,
    title:           site.title,
    metaDescription: site.metaDescription ? site.metaDescription.substring(0, 200) : null,
    canonicalUrl:    site.canonicalUrl || null,
    hasSchema:       site.hasSchema,
    schemaTypes:     site.schemaTypes,
    ogTags:          site.ogTags,
    h1:              site.h1,
    h2:              (site.h2 || []).slice(0, 12),
    h3:              (site.h3 || []).slice(0, 8),
    navigation:      site.navigation.map(function(n) { return n.text; }).slice(0, 20),
    ctaButtons:      site.ctaButtons.slice(0, 15),
    forms:           site.forms.map(function(f) {
                       return { fieldCount: f.fields.length, fields: f.fields.map(function(fld) { return fld.label; }).slice(0, 10), submitText: f.submitText };
                     }),
    footerLinks:     site.footerLinks.slice(0, 15),
    imageCount:      site.images.length,
    wordCount:       site.wordCount,
    phones:          site.phones,
    emails:          site.emails,
    sampleContent:   (site.paragraphs || []).slice(0, 5).map(function(p) { return p.substring(0, 160); })
  };
}

function buildPrompt(baseline, challenger, multiPageContext) {
  var mpSummary = '';
  if (multiPageContext) {
    mpSummary = '\n## MULTI-PAGE CONTEXT:\n' +
      '- Baseline pages: '   + (multiPageContext.totalBaseline  || 'N/A') + '\n' +
      '- Challenger pages: ' + (multiPageContext.totalChallenger || 'N/A') + '\n' +
      '- Matched: '          + (multiPageContext.matched || []).length + '\n' +
      '- Missing: '          + (multiPageContext.missingFromChallenger || []).length + '\n' +
      '- Avg score: '        + (multiPageContext.avgPageScore || 'N/A') + '%\n';
  }
  return 'You are a senior website QA analyst comparing a BASELINE against a CHALLENGER website.\n' +
    'FOCUS ON: content completeness, missing elements, navigation gaps, SEO regressions, form changes.\n' +
    'DO NOT focus on visual/pixel differences.\n\n' +
    '## BASELINE:\n' + JSON.stringify(baseline, null, 2) + '\n\n' +
    '## CHALLENGER:\n' + JSON.stringify(challenger, null, 2) + '\n' +
    mpSummary + '\n' +
    'Return ONLY valid JSON — no markdown, no explanation:\n\n' +
    '{\n' +
    '  "overallSummary": "2-3 sentence summary",\n' +
    '  "matchPercentage": <0-100>,\n' +
    '  "categoryScores": { "content":<0-100>, "navigation":<0-100>, "seo":<0-100>, "design":<0-100>, "forms":<0-100> },\n' +
    '  "criticalIssues": [{"title":"","description":"","baseline":"","challenger":"","impact":""}],\n' +
    '  "warnings":       [{"title":"","description":"","baseline":"","challenger":"","impact":""}],\n' +
    '  "informational":  [{"title":"","description":"","baseline":"","challenger":""}],\n' +
    '  "missingElements": [""],\n' +
    '  "addedElements":   [""],\n' +
    '  "contentChanges":  [""],\n' +
    '  "recommendations": [""]\n' +
    '}';
}

function parseJsonSafely(text) {
  var cleaned = text.trim().replace(/^```json\s*/i,'').replace(/\s*```$/,'').replace(/^```\s*/,'').replace(/\s*```$/,'');
  return JSON.parse(cleaned);
}

function algorithmicFallback(baseline, challenger, multiPageContext) {
  var criticalIssues = [], warnings = [], informational = [], missingElements = [];
  var bNav = baseline.navigation.map(function(n) { return n.text.toLowerCase(); });
  var cNav = challenger.navigation.map(function(n) { return n.text.toLowerCase(); });
  bNav.forEach(function(item) {
    if (!cNav.some(function(c) { return c.includes(item) || item.includes(c); })) {
      criticalIssues.push({ title: 'Missing nav: "' + item + '"', description: '"' + item + '" in baseline but not challenger.', baseline: item, challenger: 'Not found', impact: 'Users cannot find this section.' });
      missingElements.push('Navigation: "' + item + '"');
    }
  });
  if (baseline.h1.length > 0 && challenger.h1.length === 0) {
    criticalIssues.push({ title: 'Missing H1', description: 'Challenger has no H1.', baseline: baseline.h1[0], challenger: 'None', impact: 'SEO impact.' });
  }
  if (baseline.forms.length > challenger.forms.length) {
    criticalIssues.push({ title: 'Missing Forms', description: 'Baseline: ' + baseline.forms.length + ', Challenger: ' + challenger.forms.length + '.', baseline: baseline.forms.length + ' forms', challenger: challenger.forms.length + ' forms', impact: 'Conversion actions unavailable.' });
  }
  if (baseline.metaDescription && !challenger.metaDescription) {
    warnings.push({ title: 'Missing Meta Description', description: 'Baseline has meta desc; challenger does not.', baseline: baseline.metaDescription, challenger: 'None', impact: 'Lower CTR from search.' });
  }
  if (baseline.hasSchema && !challenger.hasSchema) {
    warnings.push({ title: 'Missing Schema', description: 'Schema in baseline, absent in challenger.', baseline: 'Present', challenger: 'None', impact: 'Loss of rich results.' });
  }
  if (multiPageContext && multiPageContext.missingFromChallenger && multiPageContext.missingFromChallenger.length > 0) {
    var mp = multiPageContext.missingFromChallenger;
    criticalIssues.push({ title: mp.length + ' Page(s) Missing', description: 'Missing: ' + mp.slice(0,5).map(function(p) { try { return new URL(p.url).pathname; } catch(e) { return p.url; } }).join(', ') + (mp.length > 5 ? ' +' + (mp.length-5) + ' more' : '') + '.', baseline: mp.length + ' pages', challenger: 'Not found', impact: 'Pages unreachable by users and search engines.' });
    mp.forEach(function(p) { try { missingElements.push('Page: ' + new URL(p.url).pathname); } catch(e) {} });
  }
  var navScore     = bNav.length > 0 ? Math.round(((bNav.length - criticalIssues.filter(function(i) { return i.title.startsWith('Missing nav'); }).length) / bNav.length) * 100) : 100;
  var seoScore     = Math.max(0, 100 - (baseline.metaDescription && !challenger.metaDescription ? 25 : 0) - (baseline.hasSchema && !challenger.hasSchema ? 20 : 0) - (baseline.h1.length > 0 && challenger.h1.length === 0 ? 20 : 0));
  var formScore    = baseline.forms.length > 0 ? Math.round((challenger.forms.length / baseline.forms.length) * 100) : 100;
  var contentScore = baseline.wordCount > 0 ? Math.min(100, Math.round((challenger.wordCount / baseline.wordCount) * 100)) : 100;
  var overall      = Math.min(100, Math.max(0, Math.round(contentScore*0.30 + navScore*0.25 + seoScore*0.20 + formScore*0.15 + 75*0.10) - criticalIssues.length * 3));
  if (multiPageContext && multiPageContext.missingFromChallenger && multiPageContext.totalBaseline) {
    overall = Math.max(0, Math.round(overall * (1 - (multiPageContext.missingFromChallenger.length / multiPageContext.totalBaseline) * 0.5)));
  }
  return {
    overallSummary:  'Algorithmic analysis: ' + criticalIssues.length + ' critical, ' + warnings.length + ' warnings.',
    matchPercentage: overall,
    categoryScores:  { content: contentScore, navigation: navScore, seo: seoScore, design: 75, forms: formScore },
    criticalIssues: criticalIssues, warnings: warnings, informational: informational, missingElements: missingElements,
    addedElements: [], contentChanges: [],
    recommendations: ['Verify all pages exist in challenger.', 'Check all navigation items.', 'Restore missing forms and meta descriptions.', 'Review word counts for removed content.']
  };
}

module.exports = { analyzeWithGemini };