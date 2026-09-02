const axios=require('axios'),cheerio=require('cheerio'),crawler=require('./crawler');
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT=10000,CONCURRENCY=2;
async function fetchHtml(url){
  try{var r=await axios.get(url,{headers:{'User-Agent':UA},timeout:TIMEOUT,maxRedirects:5});if(r.data&&r.data.length>100)return r.data;}catch(e){}
  if(process.env.SCRAPER_API_KEY){try{var r2=await axios.get('http://api.scraperapi.com/?api_key='+process.env.SCRAPER_API_KEY+'&url='+encodeURIComponent(url)+'&render=false',{timeout:25000});if(r2.data&&r2.data.length>100){console.log('    ✅ ScraperAPI: '+url);return r2.data;}}catch(e){}}
  return null;
}
function extractLinks(html,baseUrl,hostname){
  var $=cheerio.load(html),links=new Set();
  $('a[href]').each(function(_,el){var href=$(el).attr('href')||'';try{var p=new URL(href,baseUrl);if(p.hostname===hostname&&!href.startsWith('#')&&!href.startsWith('mailto:')&&!href.startsWith('tel:')&&!p.pathname.match(/\.(pdf|jpg|jpeg|png|gif|svg|webp|css|js|ico|xml|json|zip|mp4|woff|woff2|ttf)$/i)&&!p.search)links.add(p.origin+p.pathname);}catch(e){}});
  return Array.from(links);
}
async function discoverPages(siteUrl,maxPages){
  maxPages=maxPages||20;
  var base=new URL(normalizeUrl(siteUrl)),found=new Set();
  found.add(base.origin+'/');
  console.log('    Discovering pages on '+base.hostname+'...');
  var robotsSitemap=await getSitemapFromRobots(base.origin);
  var candidates=[robotsSitemap,base.origin+'/sitemap.xml',base.origin+'/sitemap_index.xml',base.origin+'/wp-sitemap.xml',base.origin+'/page-sitemap.xml',base.origin+'/sitemap-pages.xml',base.origin+'/post-sitemap.xml'].filter(Boolean);
  var sitemapFound=false;
  for(var i=0;i<candidates.length;i++){try{var pages=await parseSitemapUrl(candidates[i],base.hostname);if(pages.length>0){pages.forEach(function(p){found.add(p);});sitemapFound=true;console.log('    ✅ Sitemap: '+pages.length+' URLs at '+candidates[i]);break;}}catch(e){}}
  console.log('    Deep link crawling...');
  var toCrawl=[base.origin+'/'],crawled=new Set();
  if(found.size>1)Array.from(found).slice(0,5).forEach(function(u){if(!crawled.has(u))toCrawl.push(u);});
  for(var j=0;j<Math.min(toCrawl.length,8);j++){
    var pageUrl=toCrawl[j];if(crawled.has(pageUrl))continue;crawled.add(pageUrl);
    try{var html=await fetchHtml(pageUrl);if(html){var links=extractLinks(html,pageUrl,base.hostname),newLinks=0;links.forEach(function(l){if(!found.has(normalizeUrl(l))){found.add(normalizeUrl(l));newLinks++;}});if(newLinks>0)console.log('    Found '+newLinks+' new links from '+pageUrl);}}catch(e){}
    if(found.size>=maxPages*2)break;
  }
  if(found.size<5){
    var common=['/about','/about-us','/services','/contact','/contact-us','/blog','/news','/team','/staff','/gallery','/faq','/pricing','/testimonials','/portfolio'];
    for(var k=0;k<common.length;k++){try{var testHtml=await fetchHtml(base.origin+common[k]);if(testHtml&&testHtml.length>500&&!testHtml.includes('404')&&!testHtml.includes('not found')){found.add(base.origin+common[k]);console.log('    Found common path: '+common[k]);}}catch(e){}}
  }
  var result=Array.from(found).map(normalizeUrl).filter(function(u,idx,arr){
    if(arr.indexOf(u)!==idx)return false;
    try{var p=new URL(u);if(p.hostname!==base.hostname)return false;if(p.pathname.match(/\.(pdf|jpg|jpeg|png|gif|svg|webp|css|js|ico|xml|json|zip|mp4|woff|woff2|ttf)$/i))return false;if(p.search)return false;return true;}catch(e){return false;}
  }).slice(0,maxPages);
  console.log('    ✅ Total pages: '+result.length);
  return result;
}
async function getSitemapFromRobots(origin){try{var h=await fetchHtml(origin+'/robots.txt');if(!h)return null;var m=h.match(/^Sitemap:\s*(.+)$/mi);return m?m[1].trim():null;}catch(e){return null;}}
async function parseSitemapUrl(url,hostname){
  if(!url)return[];
  try{
    var html=await fetchHtml(url);if(!html)return[];
    var urls=[],isIdx=html.includes('<sitemapindex');
    if(isIdx){var children=[],re=/<loc>(.*?)<\/loc>/gi,m;while((m=re.exec(html))!==null){if(m[1].trim().toLowerCase().includes('sitemap'))children.push(m[1].trim());}children=children.slice(0,5);for(var i=0;i<children.length;i++){var cp=await parseSitemapUrl(children[i],hostname);urls=urls.concat(cp);if(urls.length>=200)break;}}
    else{var re2=/<loc>(.*?)<\/loc>/gi,m2;while((m2=re2.exec(html))!==null){try{var p=new URL(m2[1].trim());if(p.hostname===hostname||p.hostname.endsWith('.'+hostname))urls.push(m2[1].trim());}catch(e){}}}
    return Array.from(new Set(urls));
  }catch(e){return[];}
}
async function crawlPagesBatch(urls){
  var results=[],failed=[],fn=crawler.crawlUrl;
  for(var i=0;i<urls.length;i+=CONCURRENCY){
    var batch=urls.slice(i,i+CONCURRENCY);
    console.log('    Crawling '+(i+1)+'-'+Math.min(i+CONCURRENCY,urls.length)+' of '+urls.length+'...');
    var settled=await Promise.allSettled(batch.map(function(u){return fn(u);}));
    settled.forEach(function(r,idx){if(r.status==='fulfilled')results.push(r.value);else{console.warn('    Failed: '+batch[idx]+': '+r.reason.message);failed.push({url:batch[idx],error:r.reason.message});}});
    if(i+CONCURRENCY<urls.length)await new Promise(function(r){setTimeout(r,300);});
  }
  return{results,failed};
}
function matchPages(bPages,cPages){
  var matched=[],missing=[],newIn=[];
  var bMap=new Map();bPages.forEach(function(p){bMap.set(getPath(p.url),p);});
  var cMap=new Map();cPages.forEach(function(p){cMap.set(getPath(p.url),p);});
  bMap.forEach(function(bPage,path){var cPage=cMap.get(path)||cMap.get(path==='/'?'':path+'/')||cMap.get(path.replace(/\/$/,''));if(cPage)matched.push({path,baseline:bPage,challenger:cPage});else missing.push(bPage);});
  cMap.forEach(function(cPage,path){var found=bMap.has(path)||bMap.has(path==='/'?'':path+'/')||bMap.has(path.replace(/\/$/,''));if(!found)newIn.push(cPage);});
  return{matched,missingFromChallenger:missing,newInChallenger:newIn};
}
function normalizeUrl(url){try{var p=new URL(url),path=p.pathname;if(path.length>1&&path.endsWith('/'))path=path.slice(0,-1);return p.origin+path;}catch(e){return url;}}
function getPath(url){try{var p=new URL(url),path=p.pathname;if(path.length>1&&path.endsWith('/'))path=path.slice(0,-1);return path||'/';}catch(e){return '/';}}
module.exports={discoverPages,crawlPagesBatch,matchPages,normalizeUrl,getPath};