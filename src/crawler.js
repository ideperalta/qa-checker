const axios   = require('axios');
const cheerio = require('cheerio');

const TIMEOUT_MS = 20000;

// Rotate user agents to avoid blocks
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
];

function getRandomAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function crawlUrl(url) {
  let lastError = null;

  // Try up to 3 times with different user agents
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      var response = await axios.get(url, {
        headers: {
          'User-Agent':      getRandomAgent(),
          'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection':      'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest':  'document',
          'Sec-Fetch-Mode':  'navigate',
          'Sec-Fetch-Site':  'none',
          'Cache-Control':   'max-age=0'
        },
        timeout: TIMEOUT_MS,
        maxRedirects: 10,
        validateStatus: function(status) {
          return status < 500;
        }
      });

      // Check for bot protection pages
      var rawHtml = response.data;
      if (typeof rawHtml === 'string') {
        if (
          rawHtml.includes('cf-browser-verification') ||
          rawHtml.includes('Enable JavaScript and cookies') ||
          rawHtml.includes('DDoS protection') ||
          rawHtml.includes('Just a moment')
        ) {
          throw new Error(url + ' is protected by Cloudflare bot protection.');
        }
      }

      // Handle non-200 but non-500 responses
      if (response.status === 404) {
        throw new Error(url + ' returned 404 Not Found.');
      }
      if (response.status === 403) {
        throw new Error(url + ' returned 403 Forbidden — the site is blocking crawlers.');
      }

      return parsePage(url, rawHtml);

    } catch (err) {
      lastError = err;
      console.warn('  Attempt ' + (attempt + 1) + ' failed for ' + url + ': ' + err.message);

      // Wait before retry
      if (attempt < 2) {
        await new Promise(function(r) { setTimeout(r, 2000 * (attempt + 1)); });
      }
    }
  }

  // All attempts failed
  if (lastError.code === 'ECONNABORTED') {
    throw new Error(url + ' timed out. The site may be too slow or blocking requests.');
  }
  if (lastError.code === 'ENOTFOUND') {
    throw new Error(url + ' — domain not found. Please check the URL is correct.');
  }
  if (lastError.response && lastError.response.status) {
    throw new Error(url + ' returned HTTP ' + lastError.response.status + '.');
  }
  throw new Error('Could not reach ' + url + ' after 3 attempts: ' + lastError.message);
}

function parsePage(url, html) {
  const $        = cheerio.load(html);
  const baseHost = new URL(url).hostname;

  $('script, style, noscript, iframe').remove();

  const title = $('title').text().trim();
  const metaDescription =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') || '';
  const canonicalUrl = $('link[rel="canonical"]').attr('href') || '';
  const ogTags = {
    title:       $('meta[property="og:title"]').attr('content')       || '',
    description: $('meta[property="og:description"]').attr('content') || '',
    image:       $('meta[property="og:image"]').attr('content')       || ''
  };

  const schemaScripts = $('script[type="application/ld+json"]');
  const hasSchema     = schemaScripts.length > 0;
  const schemaTypes   = [];
  schemaScripts.each(function(_, el) {
    try {
      const s = JSON.parse($(el).html());
      if (s['@type']) schemaTypes.push(s['@type']);
    } catch (e) {}
  });

  const headings = [];
  $('h1,h2,h3,h4,h5,h6').each(function(_, el) {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text) headings.push({ level: parseInt(el.tagName[1]), text });
  });
  const h1 = headings.filter(function(h) { return h.level === 1; }).map(function(h) { return h.text; });
  const h2 = headings.filter(function(h) { return h.level === 2; }).map(function(h) { return h.text; }).slice(0, 15);
  const h3 = headings.filter(function(h) { return h.level === 3; }).map(function(h) { return h.text; }).slice(0, 10);

  const navigation = [];
  const navSeen    = new Set();
  const navContainer = $('nav').length ? $('nav').first() : $('header');
  navContainer.find('a').each(function(_, el) {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const href = $(el).attr('href') || '';
    if (text && text.length < 80 && !navSeen.has(text.toLowerCase())) {
      navSeen.add(text.toLowerCase());
      navigation.push({ text, href });
    }
  });

  const ctaButtons = [];
  const ctaSeen    = new Set();
  const ctaSel = [
    'button',
    '[class*="btn"]',
    '[class*="button"]',
    '[class*="cta"]',
    'a[href*="contact"]',
    'a[href*="demo"]',
    'a[href*="signup"]',
    'a[href*="get-started"]',
    'a[href*="free"]'
  ].join(', ');
  $(ctaSel).each(function(_, el) {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text && text.length > 1 && text.length < 80 && !ctaSeen.has(text.toLowerCase())) {
      ctaSeen.add(text.toLowerCase());
      ctaButtons.push(text);
    }
  });

  const images = [];
  $('img').each(function(_, el) {
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    const alt = $(el).attr('alt') || '';
    if (src) images.push({ src, alt });
  });
  const imagesWithAlt    = images.filter(function(i) { return i.alt.trim(); }).length;
  const imagesWithoutAlt = images.length - imagesWithAlt;

  const forms = [];
  $('form').each(function(_, form) {
    const fields = [];
    $(form).find('input:not([type="hidden"]), textarea, select').each(function(_, field) {
      const type  = $(field).attr('type') || $(field).prop('tagName').toLowerCase() || 'text';
      const id    = $(field).attr('id') || '';
      const label =
        $('label[for="' + id + '"]').text().trim() ||
        $(field).attr('placeholder')               ||
        $(field).attr('aria-label')                ||
        $(field).attr('name')                      ||
        type;
      fields.push({ type, label });
    });
    const submitText =
      $(form).find('[type="submit"], button:not([type="button"])').first().text().trim() || 'Submit';
    if (fields.length > 0) forms.push({ fields, submitText });
  });

  const footerLinks = [];
  $('footer a').each(function(_, el) {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text && text.length < 100) footerLinks.push(text);
  });
  const footerText = $('footer').text().replace(/\s+/g, ' ').trim().substring(0, 800);

  const paragraphs = [];
  $('p').each(function(_, el) {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.length > 40) paragraphs.push(text);
  });

  const bodyText  = $('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

  const internalLinks = new Set();
  $('a[href]').each(function(_, el) {
    const href = $(el).attr('href') || '';
    try {
      const parsed = new URL(href, url);
      if (
        parsed.hostname === baseHost &&
        !href.startsWith('#') &&
        !href.startsWith('mailto:') &&
        !href.startsWith('tel:')
      ) {
        internalLinks.add(parsed.href.split('#')[0]);
      }
    } catch (e) {}
  });

  const fullText = $('body').text();
  const phones   = [...new Set(
    (fullText.match(/\+?[0-9][0-9\s\-(). ]{8,}[0-9]/g) || [])
      .filter(function(p) { return p.replace(/\D/g, '').length >= 9; })
  )].slice(0, 3);
  const emails   = [...new Set(
    fullText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []
  )].slice(0, 5);

  return {
    url, title, metaDescription, canonicalUrl, ogTags,
    hasSchema, schemaTypes,
    headings, h1, h2, h3,
    navigation,
    ctaButtons: ctaButtons.slice(0, 20),
    images, imagesWithAlt, imagesWithoutAlt,
    forms,
    footerLinks, footerText,
    paragraphs: paragraphs.slice(0, 15),
    bodyText: bodyText.substring(0, 3000),
    wordCount,
    internalLinks: [...internalLinks].slice(0, 30),
    phones, emails
  };
}

module.exports = { crawlUrl };