const axios   = require('axios');
const cheerio = require('cheerio');
const crawler = require('./crawler');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT = 10000;
const CONCURRENCY = 2;

async function fetchWithFallback(url) {
  // Try direct first
  try {
    var res = await axios.get(url, { headers:{'User-Agent':USER_AGENT}, timeout:TIMEOUT, maxRedirects:5 });
    if (res.data && res.data.length > 200) return res.data;
  } catch(e) { console.warn('    Direct failed for '+url+': '+e.message); }
  // Try ScraperAPI
  if (process.env.SCRAPER_API_KEY) {
    try {
      var scraperUrl = 'http://api.scraperapi.com/?api_key='+process.env.SCRAPER_API_KEY+'&url='+encodeURIComponent(url)+'&render=false&country_code=us';
      var res2 = await axios.get(scraperUrl, { timeout:30000 });
      if (res2.data && res2.data.length > 200) { console.log('    ✅ ScraperAPI fetched: '+url); return res2.data; }
    } catch(e) { console.warn('    ScraperAPI failed for '+url+': '+e.message); }
  }
  return null;
}

async function discoverPages(siteUrl, maxPages) {
  maxPages = maxPages || 10;
  var base  = new URL(normalizeUrl(siteUrl));
  var found = new Set();
  found.add(base.origin + '/');
  console.log('    Discovering pages on ' + base.hostname + '...');

  var robotsSitemap = await getSitemapFromRobots(base.origin);
  var candidates = [robotsSitemap, base.origin+'/sitemap.xml', base.origin+'/sitemap_index.xml', base.origin+'/wp-sitemap.xml', base.origin+'/page-sitemap.xml', base.origin+'/sitemap-pages.xml'].filter(Boolean);

  var sitemapFound = false;
  for (var i = 0; i < candidates.length; i++) {
    try {
      var pages = await parseSitemapUrl(candidates[i], base.hostname);
      if (pages.length > 0) {
        pages.forEach(function(p){found.add(p);});
        sitemapFound = true;
        console.log('    ✅ Sitemap: '+pages.length+' URLs at '+candidates[i]);
        break;
      }
    } catch(e) {}
  }

  if (!sitemapFound || found.size < 3) {
    console.log('    No sitemap — crawling links from homepage...');
    try {
      var html = await fetchWithFallback(base.origin + '/');
      if (html) {
        var links = extractLinks(html, base.origin + '/', base.hostname);
        links.forEach(function(p){found.add(p);});
        console.log('    Found '+links.length+' links from homepage');
      }
    } catch(e) { console.warn('    Link crawl failed: '+e.message); }
  }

  var result = Array.from(found).map(normalizeUrl).filter(function(u,idx,arr){
    if(arr.indexOf(u)!==idx) return false;
    try {
      var p=new URL(u);
      if(p.hostname!==base.hostname) return false;
      if(p.pathname.match(/\.(pdf|jpg|jpeg|png|gif|svg|webp|css|js|ico|xml|json|zip|mp4|woff|woff2|ttf)$/i)) return false;
      if(p.search) return false;
      return true;
    } catch(e){return false;}
  }).slice(0,maxPages);

  console.log('    Total pages to crawl: '+result.length);
  return result;
}

function extractLinks(html, url, hostname) {
  var $ = cheerio.load(html);
  var links = new Set();
  $('a[href]').each(function(_,el){
    var href=$(el).attr('href')||'';
    try {
      var p=new URL(href,url);
      if(p.hostname===hostname&&!href.startsWith('#')&&!href.startsWith('mailto:')&&!href.startsWith('tel:')&&!p.pathname.match(/\.(pdf|jpg|jpeg|png|gif|svg|css|js|ico|xml|zip)$/i))
        links.add(p.origin+p.pathname);
    } catch(e){}
  });
  return Array.from(links);
}

async function getSitemapFromRobots(origin) {
  try {
    var html = await fetchWithFallback(origin+'/robots.txt');
    if (!html) return null;
    var match = html.match(/^Sitemap:\s*(.+)$/mi);
    return match ? match[1].trim() : null;
  } catch(e) { return null; }
}

async function parseSitemapUrl(url, hostname) {
  if (!url) return [];
  try {
    var html = await fetchWithFallback(url);
    if (!html) return [];
    var urls=[], isIdx=html.includes('<sitemapindex');
    if (isIdx) {
      var children=[];
      var re=/<loc>(.*?)<\/loc>/gi, m;
      while((m=re.exec(html))!==null){if(m[1].trim().toLowerCase().includes('sitemap'))children.push(m[1].trim());}
      children=children.slice(0,5);
      for(var i=0;i<children.length;i++){var cp=await parseSitemapUrl(children[i],hostname);urls=urls.concat(cp);if(urls.length>=200)break;}
    } else {
      var re2=/<loc>(.*?)<\/loc>/gi, m2;
      while((m2=re2.exec(html))!==null){try{var p=new URL(m2[1].trim());if(p.hostname===hostname||p.hostname.endsWith('.'+hostname))urls.push(m2[1].trim());}catch(e){}}
    }
    return Array.from(new Set(urls));
  } catch(e){return [];}
}

async function crawlPagesBatch(urls) {
  var results=[], failed=[];
  var crawlFn = crawler.crawlUrl;
  for (var i=0; i<urls.length; i+=CONCURRENCY) {
    var batch=urls.slice(i,i+CONCURRENCY);
    console.log('    Crawling pages '+(i+1)+'-'+Math.min(i+CONCURRENCY,urls.length)+' of '+urls.length+'...');
    var settled=await Promise.allSettled(batch.map(function(u){return crawlFn(u);}));
    settled.forEach(function(result,idx){
      if(result.status==='fulfilled') results.push(result.value);
      else { console.warn('    Failed: '+batch[idx]+': '+result.reason.message); failed.push({url:batch[idx],error:result.reason.message}); }
    });
    if(i+CONCURRENCY<urls.length) await new Promise(function(r){setTimeout(r,300);});
  }
  return {results:results, failed:failed};
}

function matchPages(baselinePages, challengerPages) {
  var matched=[], missingFromChallenger=[], newInChallenger=[];
  var bMap=new Map(); baselinePages.forEach(function(p){bMap.set(getPath(p.url),p);});
  var cMap=new Map(); challengerPages.forEach(function(p){cMap.set(getPath(p.url),p);});
  bMap.forEach(function(bPage,path){
    var cPage=cMap.get(path)||cMap.get(path==='/'?'':path+'/')||cMap.get(path.replace(/\/$/,''));
    if(cPage) matched.push({path:path,baseline:bPage,challenger:cPage});
    else missingFromChallenger.push(bPage);
  });
  cMap.forEach(function(cPage,path){
    var found=bMap.has(path)||bMap.has(path==='/'?'':path+'/')||bMap.has(path.replace(/\/$/,''));
    if(!found) newInChallenger.push(cPage);
  });
  return {matched:matched, missingFromChallenger:missingFromChallenger, newInChallenger:newInChallenger};
}

function normalizeUrl(url) {
  try { var p=new URL(url); var path=p.pathname; if(path.length>1&&path.endsWith('/'))path=path.slice(0,-1); return p.origin+path; } catch(e){return url;}
}
function getPath(url) {
  try { var p=new URL(url); var path=p.pathname; if(path.length>1&&path.endsWith('/'))path=path.slice(0,-1); return path||'/'; } catch(e){return '/';}
}

module.exports = {discoverPages, crawlPagesBatch, matchPages, normalizeUrl, getPath};