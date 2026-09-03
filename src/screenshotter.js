const puppeteer = require('puppeteer');
async function takeScreenshots(baselineUrl, challengerUrl) {
  var bShot = await captureOne(baselineUrl,   'baseline');
  var cShot = await captureOne(challengerUrl, 'challenger');
  return { baseline: bShot, challenger: cShot, success: !!(bShot || cShot) };
}
async function captureOne(url, label) {
  var browser = null, page = null;
  try {
    console.log('  📸 Launching browser for ' + label + '...');
    browser = await puppeteer.launch({
      executablePath: '/Users/ian/.cache/puppeteer/chrome/mac_arm-152.0.7977.54/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    page = await browser.newPage();
    await page.setViewport({ width:1280, height:800, deviceScaleFactor:1 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9'});
    await page.setRequestInterception(true);
    page.on('request', function(req) { var t=req.resourceType(); if(t==='font'||t==='media')req.abort(); else req.continue(); });
    console.log('  📸 Navigating to ' + url + '...');
    await page.goto(url, { waitUntil:'domcontentloaded', timeout:30000 });
    await new Promise(function(r){setTimeout(r,3000);});
    await page.evaluate(function(){['[class*="cookie"]','[id*="cookie"]','[class*="popup"]','[class*="modal"]','[class*="banner"]','[id*="gdpr"]','[class*="consent"]'].forEach(function(s){document.querySelectorAll(s).forEach(function(e){e.style.display='none';});});}).catch(function(){});
    console.log('  📸 Capturing screenshot of ' + label + '...');
    var shot = await page.screenshot({ type:'jpeg', quality:80, clip:{x:0,y:0,width:1280,height:800} });
    console.log('  📸 ' + label + ' screenshot captured ✅');
    return 'data:image/jpeg;base64,' + shot.toString('base64');
  } catch(err) {
    console.warn('  ⚠️ Screenshot failed for ' + label + ' (' + url + '): ' + err.message);
    return null;
  } finally {
    if(page)try{await page.close();}catch(e){}
    if(browser)try{await browser.close();await new Promise(function(r){setTimeout(r,1000);});}catch(e){}
  }
}
module.exports = { takeScreenshots };