const axios   = require('axios');
const cheerio = require('cheerio');

const TIMEOUT_MS = 15000;
const USER_AGENT = 'Mozilla/5.0 (compatible; QAChecker/1.0)';

async function crawlUrl(url) {
  let response;
  try {
    response = await axios.get(url, {
      headers: {
        'User-Agent':      USER_AGENT,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection':      'keep-alive'
      },
      timeout: TIMEOUT_MS,
      maxRedirects: 5
    });
  } catch (err) {
    if (err.response) {
      throw new Error(
        url + ' returned HTTP ' + err.response.status +
        '. Make sure the URL is publicly accessible.'
      );
    }
    if (err.code === 'ECONNABORTED') {
      throw new Error(url + ' timed out after ' + (TIMEOUT_MS / 1000) + 's.');
    }
    throw new Error('Could not reach ' + url + ': ' + err.message);
  }

  const rawHtml = response.data;

  if (
    typeof rawHtml === 'string' &&
    (rawHtml.includes('cf-browser-verification') ||
     rawHtml.includes('Enable JavaScript and cookies') ||
     rawHtml.includes('DDoS protection'))
  ) {
    throw new Error(url + ' is protected by Cloudflare and cannot be crawled.');
  }

  return parsePage(url, rawHtml);
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