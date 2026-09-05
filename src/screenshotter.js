const axios = require('axios');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchScraperApiScreenshot(url) {
  if (!process.env.SCRAPER_API_KEY) throw new Error('No SCRAPER_API_KEY set.');
  
  const apiUrl = `http://api.scraperapi.com/?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&render=true&screenshot=true&premium=true&keep_headers=true`;
  
  const res = await axios.get(apiUrl, { 
    responseType: 'arraybuffer', 
    timeout: 90000,
    headers: {
      'X-QA-Bypass': '8f7d9a2b-4c6e-4b1a-9f3d-8c7b6a5d4e3f'
    }
  });
  
  const contentType = res.headers['content-type'];
  if (!contentType || !contentType.includes('image')) {
    throw new Error(`ScraperAPI blocked by firewall. Returned non-image content: ${contentType}`);
  }

  const base64 = Buffer.from(res.data, 'binary').toString('base64');
  const mime = contentType.split(';')[0] || 'image/png';
  return `data:${mime};base64,${base64}`;
}

async function fetchFullPageScreenshot(url) {
  const apiUrl = `https://api.microlink.io?url=${encodeURIComponent(url)}&screenshot=true&meta=false&fullPage=true&embed=screenshot.url&headers.x-qa-bypass=8f7d9a2b-4c6e-4b1a-9f3d-8c7b6a5d4e3f`;
  
  const res = await axios.get(apiUrl, { responseType: 'arraybuffer', timeout: 60000 });
  
  const contentType = res.headers['content-type'];
  if (!contentType || !contentType.includes('image')) {
    throw new Error(`Microlink returned non-image content: ${contentType}`);
  }

  const base64 = Buffer.from(res.data, 'binary').toString('base64');
  const mime = contentType.split(';')[0] || 'image/png';
  return `data:${mime};base64,${base64}`;
}

async function captureSingleScreenshot(url, retries = 1) {
  let lastError;
  
  if (process.env.SCRAPER_API_KEY) {
    for (let i = 0; i <= retries; i++) {
      try {
        console.log(`    [Screenshot] ScraperAPI Premium for ${url} (Attempt ${i + 1})...`);
        return await fetchScraperApiScreenshot(url);
      } catch (err) {
        console.warn(`    ⚠️ ScraperAPI failed for ${url}: ${err.message}`);
        lastError = err;
        if (i < retries) {
            console.log(`    🔄 Retrying ${url} in 3 seconds...`);
            await delay(3000);
        }
      }
    }
  }

  try {
     console.log(`    [Screenshot] Falling back to standard Microlink capture for ${url}...`);
     return await fetchFullPageScreenshot(url);
  } catch (err) {
     console.error(`    ❌ Standard fallback failed for ${url}: ${err.message}`);
     throw new Error(lastError ? lastError.message : err.message);
  }
}

async function takeScreenshots(baselineUrl, challengerUrl) {
  try {
    console.log('    [Screenshot] Capturing Baseline and Challenger concurrently...');
    
    const [baseline, challenger] = await Promise.all([
      captureSingleScreenshot(baselineUrl),
      captureSingleScreenshot(challengerUrl)
    ]);

    return { baseline, challenger, success: true };
  } catch (error) {
    return { baseline: null, challenger: null, success: false, error: error.message };
  }
}

module.exports = { takeScreenshots };