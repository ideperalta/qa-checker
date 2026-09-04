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

// Bypass Cloudflare with ScraperAPI Premium Residential Proxies
async function fetchScraperApiScreenshot(url) {
  if (!process.env.SCRAPER_API_KEY) throw new Error('No SCRAPER_API_KEY set.');
  
  // Added &premium=true to completely avoid Cloudflare's JS verification screen
  const apiUrl = `http://api.scraperapi.com/?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&render=true&screenshot=true&premium=true`;
  
  const res = await axios.get(apiUrl, { responseType: 'arraybuffer', timeout: 60000 });
  const base64 = Buffer.from(res.data, 'binary').toString('base64');
  return `data:image/jpeg;base64,${base64}`;
}

// Standard Full-Page Screenshot
async function fetchFullPageScreenshot(url) {
  const apiUrl = `https://api.microlink.io?url=${encodeURIComponent(url)}&screenshot=true&meta=false&fullPage=true&embed=screenshot.url`;
  const res = await axios.get(apiUrl, { responseType: 'arraybuffer', timeout: 45000 });
  const base64 = Buffer.from(res.data, 'binary').toString('base64');
  return `data:image/jpeg;base64,${base64}`;
}

async function captureSingleScreenshot(url) {
  if (process.env.SCRAPER_API_KEY) {
    try {
      console.log(`    [Screenshot] Bypassing Cloudflare with Premium proxy for ${url}...`);
      return await fetchScraperApiScreenshot(url);
    } catch (err) {
      console.warn(`    ⚠️ ScraperAPI failed for ${url}. Trying standard capture...`);
    }
  }

  console.log(`    [Screenshot] Fetching FULL PAGE for ${url}...`);
  return await fetchFullPageScreenshot(url);
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