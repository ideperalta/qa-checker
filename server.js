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
  max: 10,
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

app.post('/api/analyze', async (req, res) => {
  let { baselineUrl, challengerUrl, maxPages = 10 } = req.body;

  if (!baselineUrl || !challengerUrl) {
    return res.status(400).json({ success: false, error: 'Both URLs are required.' });
  }

  if (!/^https?:\/\//i.test(baselineUrl))   baselineUrl   = 'https://' + baselineUrl;
  if (!/^https?:\/\//i.test(challengerUrl)) challengerUrl = 'https://' + challengerUrl;

  maxPages = Math.min(20, Math.max(3, parseInt(maxPages) || 10));

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

    // ── Step 1: Always crawl homepage first as safety net ────
    console.log('\n  [0/5] Crawling homepages directly...');
    let homepageBaseline   = null;
    let homepageChallenger = null;

    try {
      homepageBaseline = await crawlUrl(baselineUrl);
      console.log('  ✅ Baseline homepage crawled');
    } catch (e) {
      console.warn('  ⚠️  Baseline homepage failed: ' + e.message);
    }

    try {
      homepageChallenger = await crawlUrl(challengerUrl);
      console.log('  ✅ Challenger homepage crawled');
    } catch (e) {
      console.warn('  ⚠️  Challenger homepage failed: ' + e.message);
    }

    if (!homepageBaseline && !homepageChallenger) {
      throw new Error(
        'Could not reach either website. Please check both URLs are publicly accessible and try again.'
      );
    }

    if (!homepageBaseline) {
      throw new Error(
        'Could not reach the baseline URL: ' + baselineUrl +
        '. Please check it is publicly accessible.'
      );
    }

    if (!homepageChallenger) {
      throw new Error(
        'Could not reach the challenger URL: ' + challengerUrl +
        '. Please check it is publicly accessible.'
      );
    }

    // ── Step 2: Discover pages ────────────────────────────
    console.log('\n  [1/5] Discovering pages...');
    let baselineUrls    = [baselineUrl];
    let challengerUrls  = [challengerUrl];

    try {
      const discovered = await Promise.all([
        discoverPages(baselineUrl,   maxPages),
        discoverPages(challengerUrl, maxPages)
      ]);
      baselineUrls   = discovered[0].length > 0 ? discovered[0] : [baselineUrl];
      challengerUrls = discovered[1].length > 0 ? discovered[1] : [challengerUrl];
    } catch (e) {
      console.warn('  ⚠️  Page discovery failed — using homepages only: ' + e.message);
    }

    console.log('  Baseline: ' + baselineUrls.length + ' | Challenger: ' + challengerUrls.length);

    // ── Step 3: Crawl all pages ────────────────────────────
    console.log('\n  [2/5] Crawling baseline pages...');
    let baselinePages  = [homepageBaseline];
    let baselineFailed = [];

    try {
      const bResult = await crawlPagesBatch(baselineUrls);
      if (bResult.results.length > 0) baselinePages = bResult.results;
      baselineFailed = bResult.failed;
    } catch (e) {
      console.warn('  ⚠️  Baseline batch crawl failed — using homepage only');
    }

    console.log('\n  [3/5] Crawling challenger pages...');
    let challengerPages  = [homepageChallenger];
    let challengerFailed = [];

    try {
      const cResult = await crawlPagesBatch(challengerUrls);
      if (cResult.results.length > 0) challengerPages = cResult.results;
      challengerFailed = cResult.failed;
    } catch (e) {
      console.warn('  ⚠️  Challenger batch crawl failed — using homepage only');
    }

    console.log('  Crawled: ' + baselinePages.length + ' baseline, ' + challengerPages.length + ' challenger');

    // ── Step 4: Match pages ───────────────────────────────
    console.log('\n  [4/5] Matching pages...');
    const { matched, missingFromChallenger, newInChallenger } =
      matchPages(baselinePages, challengerPages);
    console.log('  Matched: ' + matched.length + ' | Missing: ' + missingFromChallenger.length + ' | New: ' + newInChallenger.length);

    // ── Step 5: Per-page scoring ──────────────────────────
    const pageResults = matched.map(function(item) {
      var pg         = item;
      var bPage      = pg.baseline;
      var cPage      = pg.challenger;
      var pgPath     = pg.path;
      const { score, issues } = comparePagePair(bPage, cPage);
      return {
        path:           pgPath,
        baselineUrl:    bPage.url,
        challengerUrl:  cPage.url,
        baselineTitle:  bPage.title  || pgPath,
        challengerTitle:cPage.title  || pgPath,
        score,
        issueCount: {
          critical: issues.filter(function(i) { return i.severity === 'critical'; }).length,
          warning:  issues.filter(function(i) { return i.severity === 'warning';  }).length,
          info:     issues.filter(function(i) { return i.severity === 'info';     }).length
        },
        issues,
        stats: {
          baseline: {
            wordCount:       bPage.wordCount,
            headings:        bPage.headings.length,
            images:          bPage.images.length,
            forms:           bPage.forms.length,
            hasSchema:       bPage.hasSchema,
            metaDescription: !!bPage.metaDescription,
            h1:              (bPage.h1 || [])[0] || ''
          },
          challenger: {
            wordCount:       cPage.wordCount,
            headings:        cPage.headings.length,
            images:          cPage.images.length,
            forms:           cPage.forms.length,
            hasSchema:       cPage.hasSchema,
            metaDescription: !!cPage.metaDescription,
            h1:              (cPage.h1 || [])[0] || ''
          }
        }
      };
    });

    const avgPageScore = pageResults.length > 0
      ? Math.round(pageResults.reduce(function(s, p) { return s + p.score; }, 0) / pageResults.length)
      : 100;

    // ── Step 6: AI analysis + screenshots ─────────────────
    console.log('\n  [5/5] AI analysis + screenshots...');

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

    const [analysis, screenshots] = await Promise.all([
      analyzeWithGemini(finalBaseline, finalChallenger, multiPageContext),
      takeScreenshots(baselineUrl, challengerUrl)
    ]);

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