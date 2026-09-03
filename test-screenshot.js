const puppeteer = require('puppeteer');
const fs = require('fs');

async function runTest() {
  var browser = null;
  console.log('🚀 Starting screenshot test...');
  try {
    browser = await puppeteer.launch({
      executablePath: '/Users/ian/.cache/puppeteer/chrome/mac_arm-152.0.7977.54/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      headless: 'new',
      args: ['--no-sandbox']
    });
    const page = await browser.newPage();
    console.log('  Navigating to https://example.com...');
    await page.goto('https://example.com', { waitUntil: 'networkidle2' });
    console.log('  Taking screenshot...');
    const screenshot = await page.screenshot({ path: 'test.jpg', type: 'jpeg', quality: 90 });
    console.log('✅ Screenshot saved as test.jpg');
  } catch(e) {
    console.error('❌ Screenshot test failed:', e.message);
  } finally {
    if (browser) await browser.close();
  }
}
runTest();