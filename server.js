require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');

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
  let { baselineUrl, challengerUrl, maxPages = 20 } = req.body;

  if (!baselineUrl || !challengerUrl) {
    return res.status(400).json({ success: false, error: 'Both URLs are required.' });
  }

  if (!/^https?:\/\//i.test(baselineUrl))   baselineUrl   = 'https://' + baselineUrl;
  if (!/^https?:\/\//i.test(challengerUrl)) challengerUrl = 'https://' + challengerUrl;

  maxPages = Math.min(50, Math.max(5, parseInt(maxPages) || 20));

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

    console.log('\n  [1/5] Discovering pages...');
    const [baselineUrls, challengerUrls] = await Promise.all([
      discoverPages(baselineUrl,   maxPages),
      discoverPages(challengerUrl, maxPages)
    ]);
    console.log('  Baseline: ' + baselineUrls.length + ' | Challenger: ' + challengerUrls.length);

    console.log('\n  [2/5] Crawling baseline pages...');
    const { results: baselinePages, failed: baselineFailed } =
      await crawlPagesBatch(baselineUrls);

    console.log('\n  [3/5] Crawling challenger pages...');
    const { results: challengerPages, failed: challengerFailed } =
      await crawlPagesBatch(challengerUrls);

    console.log('  Crawled: ' + baselinePages.length + ' baseline, ' + challengerPages.length + ' challenger');

    console.log('\n  [4/5] Matching pages...');
    const { matched, missingFromChallenger, newInChallenger } =
      matchPages(baselinePages, challengerPages);
    console.log('  Matched: ' + matched.length + ' | Missing: ' + missingFromChallenger.length + ' | New: ' + newInChallenger.length);

    const pageResults = matched.map(function({ path, baseline, challenger }) {
      const { score, issues } = comparePagePair(baseline, challenger);
      return {
        path,
        baselineUrl:     baseline.url,
        challengerUrl:   challenger.url,
        baselineTitle:   baseline.title   || path,
        challengerTitle: challenger.title || path,
        score,
        issueCount: {
          critical: issues.filter(i => i.severity === 'critical').length,
          warning:  issues.filter(i => i.severity === 'warning').length,
          info:     issues.filter(i => i.severity === 'info').length
        },
        issues,
        stats: {
          baseline: {
            wordCount:       baseline.wordCount,
            headings:        baseline.headings.length,
            images:          baseline.images.length,
            forms:           baseline.forms.length,
            hasSchema:       baseline.hasSchema,
            metaDescription: !!baseline.metaDescription,
            h1:              (baseline.h1 || [])[0] || ''
          },
          challenger: {
            wordCount:       challenger.wordCount,
            headings:        challenger.headings.length,
            images:          challenger.images.length,
            forms:           challenger.forms.length,
            hasSchema:       challenger.hasSchema,
            metaDescription: !!challenger.metaDescription,
            h1:              (challenger.h1 || [])[0] || ''
          }
        }
      };
    });

    const avgPageScore = pageResults.length > 0
      ? Math.round(pageResults.reduce((s, p) => s + p.score, 0) / pageResults.length)
      : 100;

    console.log('\n  [5/5] AI analysis + screenshots...');

    const homepageBaseline   = baselinePages.find(p => getPath(p.url) === '/')   || baselinePages[0];
    const homepageChallenger = challengerPages.find(p => getPath(p.url) === '/') || challengerPages[0];

    if (!homepageBaseline || !homepageChallenger) {
      throw new Error('Could not crawl homepage. Please check the URLs are accessible.');
    }

    const multiPageContext = {
      totalBaseline:         baselinePages.length,
      totalChallenger:       challengerPages.length,
      matched,
      missingFromChallenger,
      newInChallenger,
      avgPageScore
    };

    const [analysis, screenshots] = await Promise.all([
      analyzeWithGemini(homepageBaseline, homepageChallenger, multiPageContext),
      takeScreenshots(baselineUrl, challengerUrl)
    ]);

    const scores = calculateScore(
      homepageBaseline,
      homepageChallenger,
      analysis,
      { pageResults, missingFromChallenger, totalBaseline: baselinePages.length }
    );

    console.log('\n  ✅ Complete — Match Score: ' + scores.overall + '%');
    console.log('  📸 Screenshots: ' + (screenshots.success ? 'captured' : 'unavailable') + '\n');

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
          url:             homepageBaseline.url,
          title:           homepageBaseline.title,
          metaDescription: homepageBaseline.metaDescription,
          wordCount:       homepageBaseline.wordCount,
          headingCount:    homepageBaseline.headings.length,
          imageCount:      homepageBaseline.images.length,
          formCount:       homepageBaseline.forms.length,
          navItemCount:    homepageBaseline.navigation.length,
          hasSchema:       homepageBaseline.hasSchema,
          h1:              homepageBaseline.h1,
          navigation:      homepageBaseline.navigation.map(n => n.text).slice(0, 20),
          ctaButtons:      homepageBaseline.ctaButtons.slice(0, 15),
          footerLinks:     homepageBaseline.footerLinks.slice(0, 15)
        },
        challenger: {
          url:             homepageChallenger.url,
          title:           homepageChallenger.title,
          metaDescription: homepageChallenger.metaDescription,
          wordCount:       homepageChallenger.wordCount,
          headingCount:    homepageChallenger.headings.length,
          imageCount:      homepageChallenger.images.length,
          formCount:       homepageChallenger.forms.length,
          navItemCount:    homepageChallenger.navigation.length,
          hasSchema:       homepageChallenger.hasSchema,
          h1:              homepageChallenger.h1,
          navigation:      homepageChallenger.navigation.map(n => n.text).slice(0, 20),
          ctaButtons:      homepageChallenger.ctaButtons.slice(0, 15),
          footerLinks:     homepageChallenger.footerLinks.slice(0, 15)
        },
        scores,
        analysis,
        screenshots,
        pages: {
          matched:  pageResults.sort((a, b) => a.score - b.score),
          missing:  missingFromChallenger.map(p => ({
                      url:       p.url,
                      path:      getPath(p.url),
                      title:     p.title || getPath(p.url),
                      wordCount: p.wordCount
                    })),
          new:      newInChallenger.map(p => ({
                      url:   p.url,
                      path:  getPath(p.url),
                      title: p.title || getPath(p.url)
                    })),
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