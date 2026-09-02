const axios    = require('axios');
const cheerio  = require('cheerio');
const crawler  = require('./crawler');

const USER_AGENT  = 'Mozilla/5.0 (compatible; QAChecker/1.0)';
const TIMEOUT     = 12000;
const CONCURRENCY = 4;

async function discoverPages(siteUrl, maxPages) {
  maxPages = maxPages || 20;
  var base = new URL(normalizeUrl(siteUrl));
  var found = new Set();
  found.add(base.origin + '/');
  console.log('    Discovering pages on ' + base.hostname + '...');
  var robotsSitemap = await getSitemapFromRobots(base.origin);
  var sitemapCandidates = [
    robotsSitemap,
    base.origin + '/sitemap.xml',
    base.origin + '/sitemap_index.xml',
    base.origin + '/wp-sitemap.xml',
    base.origin + '/page-sitemap.xml'
  ].filter(Boolean);
  var sitemapFound = false;
  for (var i = 0; i < sitemapCandidates.length; i++) {
    var pages = await parseSitemapUrl(sitemapCandidates[i], base.hostname);
    if (pages.length > 0) {
      pages.forEach(function(p) { found.add(p); });
      sitemapFound = true;
      console.log('    Sitemap found at ' + sitemapCandidates[i] + ' — ' + pages.length + ' URLs');
      break;
    }
  }
  if (!sitemapFound || found.size < 5) {
    console.log('    No sitemap found — crawling links from homepage...');
    var linked = await extractLinksFromPage(base.origin + '/', base.hostname);
    linked.forEach(function(p) { found.add(p); });
    console.log('    Link crawl found ' + linked.length + ' pages');
  }
  var result = Array.from(found)
    .map(normalizeUrl)
    .filter(function(u, idx, arr) {
      if (arr.indexOf(u) !== idx) return false;
      try {
        var p = new URL(u);
        if (p.hostname !== base.hostname) return false;
        if (p.pathname.match(/\.(pdf|jpg|jpeg|png|gif|svg|webp|css|js|ico|xml|json|zip|mp4|mov|woff|woff2|ttf)$/i)) return false;
        if (p.search) return false;
        return true;
      } catch(e) { return false; }
    })
    .slice(0, maxPages);
  console.log('    Total pages to crawl: ' + result.length);
  return result;
}

async function getSitemapFromRobots(origin) {
  try {
    var res = await axios.get(origin + '/robots.txt', {
      timeout: 6000,
      headers: { 'User-Agent': USER_AGENT }
    });
    var match = res.data.match(/^Sitemap:\s*(.+)$/mi);
    return match ? match[1].trim() : null;
  } catch(e) { return null; }
}

async function parseSitemapUrl(url, hostname) {
  if (!url) return [];
  try {
    var res = await axios.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': USER_AGENT }
    });
    var xml   = res.data;
    var urls  = [];
    var isIdx = xml.includes('<sitemapindex');
    if (isIdx) {
      var children = [];
      var re = /<loc>(.*?)<\/loc>/gi;
      var m;
      while ((m = re.exec(xml)) !== null) {
        if (m[1].trim().includes('sitemap')) children.push(m[1].trim());
      }
      children = children.slice(0, 4);
      for (var i = 0; i < children.length; i++) {
        var childPages = await parseSitemapUrl(children[i], hostname);
        urls = urls.concat(childPages);
        if (urls.length >= 200) break;
      }
    } else {
      var re2 = /<loc>(.*?)<\/loc>/gi;
      var m2;
      while ((m2 = re2.exec(xml)) !== null) {
        var pageUrl = m2[1].trim();
        try {
          var p = new URL(pageUrl);
          if (p.hostname === hostname || p.hostname.endsWith('.' + hostname)) {
            urls.push(pageUrl);
          }
        } catch(e) {}
      }
    }
    return Array.from(new Set(urls));
  } catch(e) { return []; }
}

async function extractLinksFromPage(url, hostname) {
  try {
    var res = await axios.get(url, {
      timeout: TIMEOUT,
      headers: { 'User-Agent': USER_AGENT },
      maxRedirects: 5
    });
    var $     = cheerio.load(res.data);
    var links = new Set();
    $('a[href]').each(function(_, el) {
      var href = $(el).attr('href') || '';
      try {
        var p = new URL(href, url);
        if (
          p.hostname === hostname &&
          !href.startsWith('#') &&
          !href.startsWith('mailto:') &&
          !href.startsWith('tel:') &&
          !p.pathname.match(/\.(pdf|jpg|jpeg|png|gif|svg|css|js|ico|xml|zip)$/i)
        ) {
          links.add(p.origin + p.pathname);
        }
      } catch(e) {}
    });
    return Array.from(links);
  } catch(err) {
    console.warn('    Link extraction failed for ' + url + ': ' + err.message);
    return [];
  }
}

async function crawlPagesBatch(urls) {
  var results = [];
  var failed  = [];
  var crawlFn = crawler.crawlUrl;

  console.log('    crawlFn type: ' + typeof crawlFn);

  for (var i = 0; i < urls.length; i += CONCURRENCY) {
    var batch = urls.slice(i, i + CONCURRENCY);
    console.log(
      '    Crawling pages ' + (i + 1) + '-' +
      Math.min(i + CONCURRENCY, urls.length) + ' of ' + urls.length + '...'
    );
    var settled = await Promise.allSettled(
      batch.map(function(u) { return crawlFn(u); })
    );
    settled.forEach(function(result, idx) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        console.warn('    Failed: ' + batch[idx] + ': ' + result.reason.message);
        failed.push({ url: batch[idx], error: result.reason.message });
      }
    });
    if (i + CONCURRENCY < urls.length) {
      await new Promise(function(r) { setTimeout(r, 500); });
    }
  }
  return { results: results, failed: failed };
}

function matchPages(baselinePages, challengerPages) {
  var matched               = [];
  var missingFromChallenger = [];
  var newInChallenger       = [];
  var bMap = new Map();
  baselinePages.forEach(function(p) { bMap.set(getPath(p.url), p); });
  var cMap = new Map();
  challengerPages.forEach(function(p) { cMap.set(getPath(p.url), p); });
  bMap.forEach(function(bPage, path) {
    var cPage =
      cMap.get(path) ||
      cMap.get(path === '/' ? '' : path + '/') ||
      cMap.get(path.replace(/\/$/, ''));
    if (cPage) {
      matched.push({ path: path, baseline: bPage, challenger: cPage });
    } else {
      missingFromChallenger.push(bPage);
    }
  });
  cMap.forEach(function(cPage, path) {
    var found =
      bMap.has(path) ||
      bMap.has(path === '/' ? '' : path + '/') ||
      bMap.has(path.replace(/\/$/, ''));
    if (!found) newInChallenger.push(cPage);
  });
  return {
    matched:               matched,
    missingFromChallenger: missingFromChallenger,
    newInChallenger:       newInChallenger
  };
}

function normalizeUrl(url) {
  try {
    var p    = new URL(url);
    var path = p.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return p.origin + path;
  } catch(e) { return url; }
}

function getPath(url) {
  try {
    var p    = new URL(url);
    var path = p.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return path || '/';
  } catch(e) { return '/'; }
}

module.exports = {
  discoverPages:   discoverPages,
  crawlPagesBatch: crawlPagesBatch,
  matchPages:      matchPages,
  normalizeUrl:    normalizeUrl,
  getPath:         getPath
};
