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

async function fetchGoogleScreenshot(url) {
  const apiBase = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
  const keyParam = process.env.GOOGLE_API_KEY ? `&key=${process.env.GOOGLE_API_KEY}` : '';
  const apiUrl = `${apiBase}?url=${encodeURIComponent(url)}&category=desktop${keyParam}`;
  
  const res = await axios.get(apiUrl, { timeout: 45000 });
  const b64 = res.data?.lighthouseResult?.audits['final-screenshot']?.details?.data;
  if (!b64) throw new Error('No screenshot data in Google response.');
  return formatBase64(b64);
}

async function fetchMicrolinkScreenshot(url) {
  const apiUrl = `https://api.microlink.io?url=${encodeURIComponent(url)}&screenshot=true&embed=screenshot.url`;
  const res = await axios.get(apiUrl, { responseType: 'arraybuffer', timeout: 30000 });
  const base64 = Buffer.from(res.data, 'binary').toString('base64');
  return `data:image/png;base64,${base64}`;
}

async function captureSingleScreenshot(url) {
  try {
    console.log(`    [Screenshot] Fetching Google PageSpeed for ${url}...`);
    return await fetchGoogleScreenshot(url);
  } catch (err) {
    console.warn(`    ⚠️ Google PageSpeed failed for ${url} (${err.message}). Trying Microlink fallback...`);
  }

  try {
    console.log(`    [Screenshot] Fetching Microlink fallback for ${url}...`);
    return await fetchMicrolinkScreenshot(url);
  } catch (err) {
    console.error(`    ❌ Microlink fallback failed for ${url}: ${err.message}`);
    throw new Error(`Failed to capture screenshot for ${url}: ${err.message}`);
  }
}

async function takeScreenshots(baselineUrl, challengerUrl) {
  try {
    console.log('    [Screenshot] Capturing Baseline...');
    const baseline = await captureSingleScreenshot(baselineUrl);
    
    await delay(2000);
    
    console.log('    [Screenshot] Capturing Challenger...');
    const challenger = await captureSingleScreenshot(challengerUrl);

    return {
      baseline,
      challenger,
      success: true
    };
  } catch (error) {
    return { 
      baseline: null, 
      challenger: null, 
      success: false, 
      error: error.message 
    };
  }
}

module.exports = { takeScreenshots };