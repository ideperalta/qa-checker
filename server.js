require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { takeScreenshots } = require('./src/screenshotter');
const { analyzeVisualDifference } = require('./src/analyzer');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/analyze', async (req, res) => {
  let { baselineUrl, challengerUrl } = req.body;
  if (!baselineUrl || !challengerUrl) return res.status(400).json({ success: false, error: 'Both URLs are required.' });
  
  if (!/^https?:\/\//i.test(baselineUrl)) baselineUrl = 'https://' + baselineUrl;
  if (!/^https?:\/\//i.test(challengerUrl)) challengerUrl = 'https://' + challengerUrl;

  try {
    new URL(baselineUrl);
    new URL(challengerUrl);
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid URL format.' });
  }

  try {
    console.log(`\n── Visual QA: ${baselineUrl} vs ${challengerUrl}`);
    
    console.log('[1] Fetching screenshots via API...');
    const shots = await takeScreenshots(baselineUrl, challengerUrl);
    if (!shots.success || !shots.baseline || !shots.challenger) {
      return res.status(500).json({ success: false, error: 'Failed to capture screenshots. ' + (shots.error || '') });
    }
    console.log('  ✅ Screenshots captured.');

    console.log('[2] Running Gemini Vision analysis...');
    const analysis = await analyzeVisualDifference(shots.baseline, shots.challenger);
    console.log('  ✅ AI Analysis complete.');

    res.json({
      success: true,
      report: {
        baselineUrl,
        challengerUrl,
        baselineScreenshot: shots.baseline,
        challengerScreenshot: shots.challenger,
        analysis
      }
    });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ success: false, error: 'Analysis failed: ' + error.message });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Visual QA Checker on http://localhost:${PORT}`);
  console.log(`   Gemini AI: ${process.env.GEMINI_API_KEY ? '✅ Configured' : '❌ Missing'}\n`);
});