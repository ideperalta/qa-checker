const puppeteer = require('puppeteer');

async function takeScreenshots(baselineUrl, challengerUrl) {
  var baselineShot   = await captureOne(baselineUrl,   'baseline');
  var challengerShot = await captureOne(challengerUrl, 'challenger');

  return {
    baseline:   baselineShot,
    challenger: challengerShot,
    success:    !!(baselineShot || challengerShot)
  };
}

async function captureOne(url, label) {
  var browser = null;
  var page    = null;

  try {
    console.log('  📸 Launching browser for ' + label + '...');

    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ]
    });

    page = await browser.newPage();

    // Wide viewport — height will expand to full page automatically
    await page.setViewport({
      width:             1280,
      height:            900,
      deviceScaleFactor: 1
    });

    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36'
    );

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });

    // Block fonts and media to speed up loading
    await page.setRequestInterception(true);
    page.on('request', function(req) {
      var type = req.resourceType();
      if (type === 'font' || type === 'media') {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log('  📸 Navigating to ' + url + '...');

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout:   45000
    });

    // Wait for lazy-loaded content and animations to finish
    await new Promise(function(r) { setTimeout(r, 3000); });

    // Scroll to bottom to trigger lazy loading then back to top
    await page.evaluate(function() {
      return new Promise(function(resolve) {
        var totalHeight  = 0;
        var distance     = 300;
        var scrollDelay  = 50;
        var timer = setInterval(function() {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
        }, scrollDelay);
      });
    }).catch(function() {});

    // Wait after scroll
    await new Promise(function(r) { setTimeout(r, 1500); });

    // Hide cookie banners, popups, sticky headers, chat widgets
    await page.evaluate(function() {
      var selectors = [
        '[class*="cookie"]',
        '[class*="Cookie"]',
        '[id*="cookie"]',
        '[class*="popup"]',
        '[class*="modal"]',
        '[class*="overlay"]',
        '[class*="banner"]',
        '[id*="gdpr"]',
        '[class*="consent"]',
        '[class*="chat"]',
        '[class*="Chat"]',
        '[id*="chat"]',
        '[class*="intercom"]',
        '[class*="drift"]',
        '[class*="hubspot"]',
        '[class*="sticky"]',
        '.sticky',
        '.fixed-top',
        '[style*="position: fixed"]',
        '[style*="position:fixed"]'
      ];
      selectors.forEach(function(sel) {
        try {
          document.querySelectorAll(sel).forEach(function(el) {
            var style = window.getComputedStyle(el);
            // Only hide fixed/sticky elements and cookie banners
            if (
              style.position === 'fixed' ||
              style.position === 'sticky' ||
              sel.includes('cookie') ||
              sel.includes('Cookie') ||
              sel.includes('gdpr') ||
              sel.includes('consent') ||
              sel.includes('popup') ||
              sel.includes('modal') ||
              sel.includes('chat') ||
              sel.includes('intercom') ||
              sel.includes('drift') ||
              sel.includes('hubspot')
            ) {
              el.style.display = 'none';
            }
          });
        } catch(e) {}
      });

      // Remove fixed positioning from sticky navbars so they
      // don't repeat across the full-page screenshot
      document.querySelectorAll('header, nav, [class*="header"], [class*="navbar"]').forEach(function(el) {
        var style = window.getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'sticky') {
          el.style.position = 'relative';
        }
      });
    }).catch(function() {});

    console.log('  📸 Capturing full-page screenshot of ' + label + '...');

    // ── KEY CHANGE: fullPage: true captures the entire page ──
    var screenshot = await page.screenshot({
      type:     'jpeg',
      quality:  80,
      fullPage: true
    });

    var sizeKb = Math.round(screenshot.length / 1024);
    console.log('  📸 ' + label + ' screenshot captured ✅ (' + sizeKb + 'kb)');
    return 'data:image/jpeg;base64,' + screenshot.toString('base64');

  } catch (err) {
    console.warn('  ⚠️  Screenshot failed for ' + label + ' (' + url + '): ' + err.message);
    return null;

  } finally {
    if (page) {
      try { await page.close(); } catch(e) {}
    }
    if (browser) {
      try { await browser.close(); } catch(e) {}
      await new Promise(function(r) { setTimeout(r, 1000); });
    }
  }
}

module.exports = { takeScreenshots };