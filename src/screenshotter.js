const axios = require('axios');

const formatBase64 = (str) => {
  if (!str) return null;
  if (str.startsWith('data:image')) return str;
  const parts = str.split(',');
  const prefix = parts.length === 2 ? parts[0] + ',' : 'data:image/jpeg;base64,';
  const data = parts.length === 2 ? parts[1] : parts[0];
  return prefix + data.replace(/_/g, '/').replace(/-/g, '+');
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Primary: Microlink for FULL PAGE screenshots
async function fetchFullPageScreenshot(url) {
  const apiUrl = `https://api.microlink.io?url=${encodeURIComponent(url)}&screenshot=true&meta=false&fullPage=true&embed=screenshot.url`;
  const res = await axios.get(apiUrl, { responseType: 'arraybuffer', timeout: 45000 });
  const base64 = Buffer.from(res.data, 'binary').toString('base64');
  return `data:image/jpeg;base64,${base64}`;
}

// Fallback: Google PageSpeed (Viewport only)
async function fetchGoogleScreenshot(url) {
  const apiBase = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
  const keyParam = process.env.GOOGLE_API_KEY ? `&key=${process.env.GOOGLE_API_KEY}` : '';
  const apiUrl = `${apiBase}?url=${encodeURIComponent(url)}&category=desktop${keyParam}`;
  
  const res = await axios.get(apiUrl, { timeout: 45000 });
  const b64 = res.data?.lighthouseResult?.audits['final-screenshot']?.details?.data;
  if (!b64) throw new Error('No screenshot data in Google response.');
  return formatBase64(b64);
}

async function captureSingleScreenshot(url) {
  try {
    console.log(`    [Screenshot] Fetching FULL PAGE for ${url}...`);
    return await fetchFullPageScreenshot(url);
  } catch (err) {
    console.warn(`    ⚠️ Full page failed for ${url} (${err.message}). Falling back to Google PageSpeed...`);
    return await fetchGoogleScreenshot(url);
  }
}

async function takeScreenshots(baselineUrl, challengerUrl) {
  try {
    console.log('    [Screenshot] Capturing Baseline...');
    const baseline = await captureSingleScreenshot(baselineUrl);
    
    await delay(2000);
    
    console.log('    [Screenshot] Capturing Challenger...');
    const challenger = await captureSingleScreenshot(challengerUrl);

    return { baseline, challenger, success: true };
  } catch (error) {
    return { baseline: null, challenger: null, success: false, error: error.message };
  }
}

module.exports = { takeScreenshots };