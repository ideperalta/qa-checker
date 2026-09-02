require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const { crawlUrl }                                            = require('./src/crawler');
const { analyzeWithGemini }                                   = require('./src/analyzer');
const { calculateScore, comparePagePair }                     = require('./src/scorer');
const { takeScreenshots }                                     = require('./src/screenshotter');
const { discoverPages, crawlPagesBatch, matchPages, getPath } = require('./src/sitecrawler');

const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please wait 15 minutes.' }
});
app.use('/api/', apiLimiter);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    geminiConfigured: !!process.env.GEMINI_API_KEY
  });
});

// ── Timeout wrapper ───────────────────────────────────────────
function withTimeout(promise, ms, label) {
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() {
      reject(new Error(label + ' timed out after ' + (ms / 1000) + 's'));
    }, ms);
    promise.then(
      function(val) { clearTimeout(timer); resolve(val); },
      function(err) { clearTimeout(timer); reject(err); }
    );
  });
}

// ── Try direct crawl then Google cache fallback ───────────────
async function crawlWithFallback(url) {
  // First try direct
  try {
    var result = await withTimeout(crawlUrl(url), 15000, 'Direct crawl');
    console.log('  ✅ Direct crawl succeeded: ' + url);
    return result;
  } catch (directErr) {
    console.warn('  ⚠️  Direct crawl failed: ' + directErr.message);
  }

  // Try Google cache as fallback
  try {
    var cacheUrl = 'https://webcache.googleusercontent.com/search?q=cache:' + encodeURIComponent(url);
    var result2  = await withTimeout(crawlUrl(cacheUrl), 15000, 'Google cache crawl');
    result2.url  = url; // Restore original URL
    console.log('  ✅ Google cache fallback succeeded: ' + url);
    return result2;
  } catch (cacheErr) {
    console.warn('  ⚠️  Google cache failed: ' + cacheErr.message);
  }

  throw new Error(
    'Could not reach ' + url + '. The site may be blocking automated requests. ' +
    'Try a different URL or check the site is publicly accessible.'
  );
}

app.post('/api/analyze', async (req, res) => {
  let { baselineUrl, challengerUrl, maxPages = 5 } = req.body;

  if (!baselineUrl || !challengerUrl) {
    return res.status(400).json({ success: false, error: 'Both URLs are required.' });
  }

  if (!/^https?:\/\//i.test(baselineUrl))   baselineUrl   = 'https://' + baselineUrl;
  if (!/^https?:\/\//i.test(challengerUrl)) challengerUrl = 'https://' + challengerUrl;

  maxPages = Math.min(10, Math.max(1, parseInt(maxPages) || 5));

  try {
    new URL(baselineUrl);
    new URL(challengerUrl);
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid URL format.' });
  }

  try {
    console.log('\n── Multi-Page Analysis ─────────────────────────');
    console.log('  Baseline:   ' + baselineUrl);
    console.log('  Challenger: ' + challengerUrl);
    console.log('  Max pages:  ' + maxPages);

    // ── Step 0: Crawl homepages ───────────────────────────
    console.log('\n  [0] Crawling homepages...');
    let homepageBaseline   = null;
    let homepageChallenger = null;

    try {
      homepageBaseline = await crawlWithFallback(baselineUrl);
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: e.message
      });
    }

    try {
      homepageChallenger = await crawlWithFallback(challengerUrl);
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: e.message
      });
    }

    // ── Step 1: Discover pages ────────────────────────────
    console.log('\n  [1] Discovering pages...');
    let baselineUrls   = [baselineUrl];
    let challengerUrls = [challengerUrl];

    try {
      const [bUrls, cUrls] = await withTimeout(
        Promise.all([
          discoverPages(baselineUrl,   maxPages),
          discoverPages(challengerUrl, maxPages)
        ]),
        20000,
        'Page discovery'
      );
      if (bUrls && bUrls.length > 0) baselineUrls   = bUrls;
      if (cUrls && cUrls.length > 0) challengerUrls = cUrls;
    } catch (e) {
      console.warn('  ⚠️  Discovery failed — using homepages only: ' + e.message);
    }

    console.log('  Baseline: ' + baselineUrls.length + ' | Challenger: ' + challengerUrls.length);

    // ── Step 2: Crawl pages ───────────────────────────────
    console.log('\n  [2] Crawling baseline pages...');
    let baselinePages  = [homepageBaseline];
    let baselineFailed = [];

    try {
      const bResult = await withTimeout(
        crawlPagesBatch(baselineUrls),
        30000,
        'Baseline batch crawl'
      );
      if (bResult.results && bResult.results.length > 0) baselinePages = bResult.results;
      baselineFailed = bResult.failed || [];
    } catch (e) {
      console.warn('  ⚠️  Baseline batch failed — using homepage: ' + e.message);
    }

    console.log('\n  [3] Crawling challenger pages...');
    let challengerPages  = [homepageChallenger];
    let challengerFailed = [];

    try {
      const cResult = await withTimeout(
        crawlPagesBatch(challengerUrls),
        30000,
        'Challenger batch crawl'
      );
      if (cResult.results && cResult.results.length > 0) challengerPages = cResult.results;
      challengerFailed = cResult.failed || [];
    } catch (e) {
      console.warn('  ⚠️  Challenger batch failed — using homepage: ' + e.message);
    }

    console.log('  Crawled: ' + baselinePages.length + ' baseline, ' + challengerPages.length + ' challenger');

    // ── Step 3: Match pages ───────────────────────────────
    console.log('\n  [4] Matching pages...');
    const { matched, missingFromChallenger, newInChallenger } =
      matchPages(baselinePages, challengerPages);
    console.log('  Matched: ' + matched.length + ' | Missing: ' + missingFromChallenger.length + ' | New: ' + newInChallenger.length);

    // ── Step 4: Per-page scoring ──────────────────────────
    const pageResults = matched.map(function(item) {
      const { score, issues } = comparePagePair(item.baseline, item.challenger);
      return {
        path:            item.path,
        baselineUrl:     item.baseline.url,
        challengerUrl:   item.challenger.url,
        baselineTitle:   item.baseline.title  || item.path,
        challengerTitle: item.challenger.title || item.path,
        score,
        issueCount: {
          critical: issues.filter(function(i) { return i.severity === 'critical'; }).length,
          warning:  issues.filter(function(i) { return i.severity === 'warning';  }).length,
          info:     issues.filter(function(i) { return i.severity === 'info';     }).length
        },
        issues,
        stats: {
          baseline: {
            wordCount:       item.baseline.wordCount,
            headings:        item.baseline.headings.length,
            images:          item.baseline.images.length,
            forms:           item.baseline.forms.length,
            hasSchema:       item.baseline.hasSchema,
            metaDescription: !!item.baseline.metaDescription,
            h1:              (item.baseline.h1 || [])[0] || ''
          },
          challenger: {
            wordCount:       item.challenger.wordCount,
            headings:        item.challenger.headings.length,
            images:          item.challenger.images.length,
            forms:           item.challenger.forms.length,
            hasSchema:       item.challenger.hasSchema,
            metaDescription: !!item.challenger.metaDescription,
            h1:              (item.challenger.h1 || [])[0] || ''
          }
        }
      };
    });

    const avgPageScore = pageResults.length > 0
      ? Math.round(pageResults.reduce(function(s, p) { return s + p.score; }, 0) / pageResults.length)
      : 100;

    // ── Step 5: AI analysis ───────────────────────────────
    console.log('\n  [5] AI analysis...');

    const finalBaseline   = baselinePages.find(function(p) { return getPath(p.url) === '/'; }) || baselinePages[0];
    const finalChallenger = challengerPages.find(function(p) { return getPath(p.url) === '/'; }) || challengerPages[0];

    const multiPageContext = {
      totalBaseline:         baselinePages.length,
      totalChallenger:       challengerPages.length,
      matched,
      missingFromChallenger,
      newInChallenger,
      avgPageScore
    };

    let analysis;
    try {
      analysis = await withTimeout(
        analyzeWithGemini(finalBaseline, finalChallenger, multiPageContext),
        25000,
        'Gemini AI'
      );
    } catch (e) {
      console.warn('  ⚠️  AI failed — using fallback: ' + e.message);
      analysis = {
        overallSummary:  'Analysis complete. ' + matched.length + ' pages matched, ' + missingFromChallenger.length + ' missing.',
        matchPercentage: avgPageScore,
        categoryScores:  { content: 75, navigation: 75, seo: 75, design: 75, forms: 75 },
        criticalIssues:  [],
        warnings:        [],
        informational:   [],
        missingElements: missingFromChallenger.map(function(p) { return getPath(p.url); }),
        addedElements:   newInChallenger.map(function(p) { return getPath(p.url); }),
        contentChanges:  [],
        recommendations: ['Review missing pages and content differences manually.']
      };
    }

    const screenshots = { baseline: null, challenger: null, success: false };

    const scores = calculateScore(
      finalBaseline,
      finalChallenger,
      analysis,
      { pageResults, missingFromChallenger, totalBaseline: baselinePages.length }
    );

    console.log('\n  ✅ Complete — Match Score: ' + scores.overall + '%\n');

    res.json({
      success: true,
      report: {
        timestamp: new Date().toISOString(),
        siteStats: {
          baselinePagesFound:    baselinePages.length,
          challengerPagesFound:  challengerPages.length,
          pagesMatched:          matched.length,
          pagesMissing:          missingFromChallenger.length,
          pagesNew:              newInChallenger.length,
          avgPageScore,
          baselinePagesFailed:   baselineFailed.length,
          challengerPagesFailed: challengerFailed.length
        },
        baseline: {
          url:             finalBaseline.url,
          title:           finalBaseline.title,
          metaDescription: finalBaseline.metaDescription,
          wordCount:       finalBaseline.wordCount,
          headingCount:    finalBaseline.headings.length,
          imageCount:      finalBaseline.images.length,
          formCount:       finalBaseline.forms.length,
          navItemCount:    finalBaseline.navigation.length,
          hasSchema:       finalBaseline.hasSchema,
          h1:              finalBaseline.h1,
          navigation:      finalBaseline.navigation.map(function(n) { return n.text; }).slice(0, 20),
          ctaButtons:      finalBaseline.ctaButtons.slice(0, 15),
          footerLinks:     finalBaseline.footerLinks.slice(0, 15)
        },
        challenger: {
          url:             finalChallenger.url,
          title:           finalChallenger.title,
          metaDescription: finalChallenger.metaDescription,
          wordCount:       finalChallenger.wordCount,
          headingCount:    finalChallenger.headings.length,
          imageCount:      finalChallenger.images.length,
          formCount:       finalChallenger.forms.length,
          navItemCount:    finalChallenger.navigation.length,
          hasSchema:       finalChallenger.hasSchema,
          h1:              finalChallenger.h1,
          navigation:      finalChallenger.navigation.map(function(n) { return n.text; }).slice(0, 20),
          ctaButtons:      finalChallenger.ctaButtons.slice(0, 15),
          footerLinks:     finalChallenger.footerLinks.slice(0, 15)
        },
        scores,
        analysis,
        screenshots,
        pages: {
          matched:  pageResults.sort(function(a, b) { return a.score - b.score; }),
          missing:  missingFromChallenger.map(function(p) {
                      return {
                        url:       p.url,
                        path:      getPath(p.url),
                        title:     p.title || getPath(p.url),
                        wordCount: p.wordCount
                      };
                    }),
          new:      newInChallenger.map(function(p) {
                      return {
                        url:   p.url,
                        path:  getPath(p.url),
                        title: p.title || getPath(p.url)
                      };
                    }),
          failed: {
            baseline:   baselineFailed,
            challenger: challengerFailed
          }
        }
      }
    });

  } catch (error) {
    console.error('Analysis error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Analysis failed: ' + error.message
    });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n🚀  QA Checker running on http://localhost:' + PORT);
  console.log('    Gemini: ' + (process.env.GEMINI_API_KEY ? '✅ Configured' : '❌ Missing') + '\n');
});