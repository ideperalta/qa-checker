const axios = require('axios');

async function fetchSitemapPaths(baseUrl) {
  try {
    const cleanBase = baseUrl.replace(/\/$/, '');
    const sitemapUrl = `${cleanBase}/sitemap.xml`;
    
    // Included X-QA-Bypass header so Cloudflare allows the sitemap request
    const response = await axios.get(sitemapUrl, { 
      timeout: 15000,
      headers: {
        'X-QA-Bypass': '8f7d9a2b-4c6e-4b1a-9f3d-8c7b6a5d4e3f',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) QA-Checker/1.0'
      }
    });
    
    const matches = [...response.data.matchAll(/<loc>(.*?)<\/loc>/g)];
    const urls = matches.map(match => match[1]);
    
    const paths = urls.map(url => {
      try {
        return new URL(url).pathname;
      } catch {
        return url;
      }
    });
    
    return [...new Set(paths)];
  } catch (error) {
    console.warn(`[Sitemap] Could not fetch/parse sitemap for ${baseUrl}: ${error.message}`);
    return null; 
  }
}

async function compareSites(baselineUrl, challengerUrl) {
  console.log('    [Sitemap] Comparing page structures...');
  
  const [baselinePaths, challengerPaths] = await Promise.all([
    fetchSitemapPaths(baselineUrl),
    fetchSitemapPaths(challengerUrl)
  ]);

  if (!baselinePaths || !challengerPaths) {
    return { 
      error: 'Could not fetch sitemaps for one or both domains. Ensure sitemap.xml exists and is publicly accessible.',
      baselineTotal: 0,
      challengerTotal: 0,
      missingPages: []
    };
  }

  const missingPages = baselinePaths.filter(path => !challengerPaths.includes(path));

  return {
    error: null,
    baselineTotal: baselinePaths.length,
    challengerTotal: challengerPaths.length,
    missingPages: missingPages
  };
}

module.exports = { compareSites };