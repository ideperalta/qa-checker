const axios=require('axios'),cheerio=require('cheerio');
const TIMEOUT_MS=20000;
const UAS=['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36','Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'];
function rndAgent(){return UAS[Math.floor(Math.random()*UAS.length)];}
async function crawlUrl(url){
  var lastError=null;
  for(var attempt=0;attempt<2;attempt++){
    try{
      var res=await axios.get(url,{headers:{'User-Agent':rndAgent(),'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9','Accept-Encoding':'gzip, deflate, br','Connection':'keep-alive','Upgrade-Insecure-Requests':'1','Sec-Fetch-Dest':'document','Sec-Fetch-Mode':'navigate','Sec-Fetch-Site':'none','Cache-Control':'max-age=0','DNT':'1'},timeout:TIMEOUT_MS,maxRedirects:10,validateStatus:function(s){return s<500;}});
      var raw=res.data;
      if(typeof raw==='string'){
        if(raw.includes('cf-browser-verification')||raw.includes('Just a moment')||raw.includes('DDoS protection'))throw new Error('BLOCKED:Cloudflare detected.');
        if(raw.length<200)throw new Error('EMPTY:Page returned almost no content.');
      }
      if(res.status===404)throw new Error('404:'+url+' not found.');
      if(res.status===403)throw new Error('BLOCKED:'+url+' returned 403.');
      return parsePage(url,raw);
    }catch(err){
      lastError=err;
      if(err.message&&err.message.startsWith('BLOCKED:'))throw new Error(err.message.replace('BLOCKED:',''));
      if(err.message&&err.message.startsWith('404:'))throw new Error(err.message.replace('404:',''));
      if(attempt<1)await new Promise(function(r){setTimeout(r,1500);});
    }
  }
  if(process.env.SCRAPER_API_KEY){
    try{
      console.log('    Trying ScraperAPI: '+url);
      var sRes=await axios.get('http://api.scraperapi.com/?api_key='+process.env.SCRAPER_API_KEY+'&url='+encodeURIComponent(url)+'&render=false&country_code=us',{timeout:30000});
      if(sRes.data&&sRes.data.length>200){console.log('    ✅ ScraperAPI OK: '+url);return parsePage(url,sRes.data);}
    }catch(e){console.warn('    ⚠️ ScraperAPI failed: '+e.message);}
  }
  if(lastError&&lastError.code==='ENOTFOUND')throw new Error(url+' — domain not found.');
  throw new Error('Could not reach '+url+': '+(lastError?lastError.message:'Unknown error'));
}
function extractDesign($,html){
  var d={colors:[],fonts:[],googleFonts:[],hasHero:false,hasStickyNav:false,hasSlider:false,hasVideo:false,hasChatWidget:false,hasAnimation:false,layoutType:'unknown',buttonStyles:[],cssFramework:'unknown',themeColor:'',favicon:''};
  d.themeColor=$('meta[name="theme-color"]').attr('content')||'';
  d.favicon=$('link[rel="icon"],link[rel="shortcut icon"]').first().attr('href')||'';
  $('link[href*="fonts.googleapis.com"]').each(function(_,el){var href=$(el).attr('href')||'';var m=href.match(/family=([^&:]+)/);if(m)d.googleFonts.push(decodeURIComponent(m[1]).replace(/\+/g,' '));});
  var hs=html.toLowerCase();
  if(hs.includes('bootstrap'))d.cssFramework='Bootstrap';
  else if(hs.includes('tailwind'))d.cssFramework='Tailwind';
  else if(hs.includes('foundation'))d.cssFramework='Foundation';
  else if(hs.includes('bulma'))d.cssFramework='Bulma';
  var cssVars=html.match(/--[a-zA-Z0-9-]*color[^:]*:\s*([^;]+)/gi)||[];
  cssVars.slice(0,10).forEach(function(m){var v=m.split(':').pop().trim();if(v&&!d.colors.includes(v))d.colors.push(v);});
  var hex=[...new Set(html.match(/#[0-9a-fA-F]{3,6}(?=[^a-fA-F0-9])/g)||[])].slice(0,8);
  hex.forEach(function(c){if(!d.colors.includes(c))d.colors.push(c);});
  d.colors=d.colors.slice(0,10);
  var fonts=html.match(/font-family\s*:\s*([^;}"']+)/gi)||[];
  fonts.forEach(function(m){var v=m.split(':').pop().trim().replace(/['"]/g,'').split(',')[0].trim();if(v&&v.length<50&&!d.fonts.includes(v))d.fonts.push(v);});
  d.fonts=d.fonts.slice(0,5);
  if($('[class*="container"],[class*="wrapper"],[class*="layout"]').length>0)d.layoutType='contained';
  if($('[class*="full-width"],[class*="fullwidth"]').length>0)d.layoutType='full-width';
  if($('[class*="sidebar"]').length>0)d.layoutType='sidebar';
  d.hasHero=$('[class*="hero"],[class*="banner"],[class*="jumbotron"],[class*="masthead"]').length>0;
  d.hasStickyNav=$('[class*="sticky"],[class*="fixed-top"],[class*="navbar-fixed"]').length>0;
  d.hasSlider=$('[class*="slider"],[class*="carousel"],[class*="swiper"],[class*="slick"]').length>0;
  d.hasVideo=$('video,iframe[src*="youtube"],iframe[src*="vimeo"]').length>0;
  d.hasChatWidget=$('[class*="chat"],[class*="intercom"],[class*="drift"],[id*="chat"]').length>0;
  d.hasAnimation=$('[class*="animate"],[class*="wow"],[class*="aos"],[data-aos]').length>0;
  var btnCls=new Set();
  $('a[class*="btn"],button[class],a[class*="button"]').each(function(_,el){var cls=$(el).attr('class')||'';cls.split(' ').filter(function(c){return c.match(/btn|button|cta/i);}).slice(0,3).forEach(function(c){btnCls.add(c);});});
  d.buttonStyles=Array.from(btnCls).slice(0,5);
  return d;
}
function parsePage(url,html){
  const $=cheerio.load(html),baseHost=new URL(url).hostname;
  $('script,style,noscript,iframe').remove();
  const title=$('title').text().trim();
  const metaDescription=$('meta[name="description"]').attr('content')||$('meta[property="og:description"]').attr('content')||'';
  const canonicalUrl=$('link[rel="canonical"]').attr('href')||'';
  const ogTags={title:$('meta[property="og:title"]').attr('content')||'',description:$('meta[property="og:description"]').attr('content')||'',image:$('meta[property="og:image"]').attr('content')||''};
  const ss=$('script[type="application/ld+json"]'),hasSchema=ss.length>0,schemaTypes=[];
  ss.each(function(_,el){try{const s=JSON.parse($(el).html());if(s['@type'])schemaTypes.push(s['@type']);}catch(e){}});
  const headings=[];
  $('h1,h2,h3,h4,h5,h6').each(function(_,el){const t=$(el).text().replace(/\s+/g,' ').trim();if(t)headings.push({level:parseInt(el.tagName[1]),text:t});});
  const h1=headings.filter(function(h){return h.level===1;}).map(function(h){return h.text;});
  const h2=headings.filter(function(h){return h.level===2;}).map(function(h){return h.text;}).slice(0,15);
  const h3=headings.filter(function(h){return h.level===3;}).map(function(h){return h.text;}).slice(0,10);
  const navigation=[],navSeen=new Set(),navContainer=$('nav').length?$('nav').first():$('header');
  navContainer.find('a').each(function(_,el){const t=$(el).text().replace(/\s+/g,' ').trim(),href=$(el).attr('href')||'';if(t&&t.length<80&&!navSeen.has(t.toLowerCase())){navSeen.add(t.toLowerCase());navigation.push({text:t,href});}});
  const ctaButtons=[],ctaSeen=new Set();
  $(['button','[class*="btn"]','[class*="button"]','[class*="cta"]','a[href*="contact"]','a[href*="demo"]','a[href*="signup"]'].join(',')).each(function(_,el){const t=$(el).text().replace(/\s+/g,' ').trim();if(t&&t.length>1&&t.length<80&&!ctaSeen.has(t.toLowerCase())){ctaSeen.add(t.toLowerCase());ctaButtons.push(t);}});
  const images=[];
  $('img').each(function(_,el){const src=$(el).attr('src')||$(el).attr('data-src')||'',alt=$(el).attr('alt')||'';if(src)images.push({src,alt});});
  const imagesWithAlt=images.filter(function(i){return i.alt.trim();}).length,imagesWithoutAlt=images.length-imagesWithAlt;
  const forms=[];
  $('form').each(function(_,form){const fields=[];$(form).find('input:not([type="hidden"]),textarea,select').each(function(_,field){const type=$(field).attr('type')||$(field).prop('tagName').toLowerCase()||'text',id=$(field).attr('id')||'',label=$('label[for="'+id+'"]').text().trim()||$(field).attr('placeholder')||$(field).attr('aria-label')||$(field).attr('name')||type;fields.push({type,label});});const submitText=$(form).find('[type="submit"],button:not([type="button"])').first().text().trim()||'Submit';if(fields.length>0)forms.push({fields,submitText});});
  const footerLinks=[];
  $('footer a').each(function(_,el){const t=$(el).text().replace(/\s+/g,' ').trim();if(t&&t.length<100)footerLinks.push(t);});
  const footerText=$('footer').text().replace(/\s+/g,' ').trim().substring(0,800);
  const paragraphs=[];
  $('p').each(function(_,el){const t=$(el).text().replace(/\s+/g,' ').trim();if(t.length>40)paragraphs.push(t);});
  const bodyText=$('body').text().replace(/\s+/g,' ').trim(),wordCount=bodyText.split(/\s+/).filter(Boolean).length;
  const internalLinks=new Set();
  $('a[href]').each(function(_,el){const href=$(el).attr('href')||'';try{const p=new URL(href,url);if(p.hostname===baseHost&&!href.startsWith('#')&&!href.startsWith('mailto:')&&!href.startsWith('tel:'))internalLinks.add(p.href.split('#')[0]);}catch(e){}});
  const ft=$('body').text();
  const phones=[...new Set((ft.match(/\+?[0-9][0-9\s\-(). ]{8,}[0-9]/g)||[]).filter(function(p){return p.replace(/\D/g,'').length>=9;}))].slice(0,3);
  const emails=[...new Set(ft.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g)||[])].slice(0,5);
  const $d=cheerio.load(html),design=extractDesign($d,html);
  return {url,title,metaDescription,canonicalUrl,ogTags,hasSchema,schemaTypes,headings,h1,h2,h3,navigation,ctaButtons:ctaButtons.slice(0,20),images,imagesWithAlt,imagesWithoutAlt,forms,footerLinks,footerText,paragraphs:paragraphs.slice(0,15),bodyText:bodyText.substring(0,3000),wordCount,internalLinks:[...internalLinks].slice(0,30),phones,emails,design};
}
module.exports={crawlUrl};