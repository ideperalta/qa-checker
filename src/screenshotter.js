const axios = require('axios');

// Converts URL-safe base64 from Google into standard base64 for image rendering
const formatBase64 = (str) => {
  const parts = str.split(',');
  const prefix = parts.length === 2 ? parts[0] + ',' : '';
  const data = parts.length === 2 ? parts[1] : parts[0];
  return prefix + data.replace(/_/g, '/').replace(/-/g, '+');
};

// Helper function to pause execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function takeScreenshots(baselineUrl, challengerUrl) {
  try {
    const apiBase = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
    
    // Fetch Baseline Screenshot
    const bRes = await axios.get(`${apiBase}?url=${encodeURIComponent(baselineUrl)}&category=desktop`, { timeout: 45000 });
    
    // Wait 3 seconds to prevent 429 Too Many Requests from Google
    await delay(3000);
    
    // Fetch Challenger Screenshot
    const cRes = await axios.get(`${apiBase}?url=${encodeURIComponent(challengerUrl)}&category=desktop`, { timeout: 45000 });

    const bData = bRes.data?.lighthouseResult?.audits['final-screenshot']?.details?.data;
    const cData = cRes.data?.lighthouseResult?.audits['final-screenshot']?.details?.data;

    if (!bData || !cData) {
      throw new Error('Screenshot data missing from API response.');
    }

    return {
      baseline: formatBase64(bData),
      challenger: formatBase64(cData),
      success: true
    };
  } catch (error) {
    let errorMessage = error.message;
    
    // Provide a clearer error if it still hits a rate limit
    if (error.response && error.response.status === 429) {
      errorMessage = 'Rate limited by Google PageSpeed API (429). Please wait a moment and try again.';
    }

    return { 
      baseline: null, 
      challenger: null, 
      success: false, 
      error: errorMessage 
    };
  }
}

module.exports = { takeScreenshots };