require('dotenv').config();
const express=require('express'),cors=require('cors'),helmet=require('helmet'),rateLimit=require('express-rate-limit'),path=require('path');
const{crawlUrl,checkCTALinks}=require('./src/crawler');
const{analyzeWithGemini}=require('./src/analyzer');
const{calculateScore,comparePagePair}=require('./src/scorer');
const{takeScreenshots}=require('./src/screenshotter');
const{discoverPages,crawlPagesBatch,matchPages,getPath}=require('./src/sitecrawler');
const app=express();
app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:false,crossOriginEmbedderPolicy:false}));
app.use(cors({origin:'*',methods:['GET','POST','OPTIONS']}));
app.use(express.json({limit:'10mb'}));
app.use(express.static(path.join(__dirname,'public')));
const apiLimiter=rateLimit({windowMs:15*60*1000,max:20,standardHeaders:true,legacyHeaders:false,message:{success:false,error:'Too many requests.'}});
app.use('/api/',apiLimiter);
app.get('/api/health',(req,res)=>res.json({status:'ok',timestamp:new Date().toISOString(),geminiConfigured:!!process.env.GEMINI_API_KEY}));
function withTimeout(promise,ms,label){return new Promise(function(resolve,reject){var t=setTimeout(function(){reject(new Error(label+' timed out after '+(ms/1000)+'s'));},ms);promise.then(function(v){clearTimeout(t);resolve(v);},function(e){clearTimeout(t);reject(e);});});}
async function crawlWithFallback(url){
  try{var r=await withTimeout(crawlUrl(url),15000,'Direct');console.log('  ✅ Direct OK: '+url);return r;}catch(e){console.warn('  ⚠️ Direct failed: '+e.message);}
  if(process.env.SCRAPER_API_KEY){
    try{var cUrl='https://webcache.googleusercontent.com/search?q=cache:'+encodeURIComponent(url);var c=await withTimeout(crawlUrl(cUrl),12000,'Cache');c.url=url;console.log('  ✅ Cache OK: '+url);return c;}catch(e){console.warn('  ⚠️ Cache failed: '+e.message);}
  }
  throw new Error('Could not reach '+url+'. The site may be blocking automated requests.');
}
app.post('/api/analyze',async(req,res)=>{
  let{baselineUrl,challengerUrl,maxPages=10}=req.body;
  if(!baselineUrl||!challengerUrl)return res.status(400).json({success:false,error:'Both URLs required.'});
  if(!/^https?:\/\//i.test(baselineUrl))baselineUrl='https://'+baselineUrl;
  if(!/^https?:\/\//i.test(challengerUrl))challengerUrl='https://'+challengerUrl;
  maxPages=Math.min(20,Math.max(1,parseInt(maxPages)||10));
  try{new URL(baselineUrl);new URL(challengerUrl);}catch{return res.status(400).json({success:false,error:'Invalid URL.'});}
  try{
    console.log('\n── Analysis: '+baselineUrl+' vs '+challengerUrl+' (max '+maxPages+')');
    console.log('[0] Crawling homepages...');
    let homepageBaseline,homepageChallenger;
    try{homepageBaseline=await crawlWithFallback(baselineUrl);}catch(e){return res.status(500).json({success:false,error:'Baseline failed: '+e.message});}
    try{homepageChallenger=await crawlWithFallback(challengerUrl);}catch(e){return res.status(500).json({success:false,error:'Challenger failed: '+e.message});}
    console.log('  ✅ Both homepages OK');

    // Check CTA links
    console.log('[1] Checking CTA links...');
    let baselineCTAs=[],challengerCTAs=[];
    try{baselineCTAs=await checkCTALinks(homepageBaseline.ctaLinks||[],baselineUrl);console.log('  ✅ Baseline CTAs: '+baselineCTAs.length);}catch(e){console.warn('  ⚠️ CTA check failed: '+e.message);}
    try{challengerCTAs=await checkCTALinks(homepageChallenger.ctaLinks||[],challengerUrl);console.log('  ✅ Challenger CTAs: '+challengerCTAs.length);}catch(e){console.warn('  ⚠️ CTA check failed: '+e.message);}

    console.log('[2] Discovering pages...');
    let baselineUrls=[baselineUrl],challengerUrls=[challengerUrl];
    try{
      const[bUrls,cUrls]=await withTimeout(Promise.all([discoverPages(baselineUrl,maxPages),discoverPages(challengerUrl,maxPages)]),25000,'Discovery');
      if(bUrls&&bUrls.length>0)baselineUrls=bUrls;if(cUrls&&cUrls.length>0)challengerUrls=cUrls;
      console.log('  ✅ Baseline: '+baselineUrls.length+' | Challenger: '+challengerUrls.length);
    }catch(e){console.warn('  ⚠️ Discovery failed: '+e.message);}

    console.log('[3] Crawling baseline...');
    let baselinePages=[homepageBaseline],baselineFailed=[];
    try{const r=await withTimeout(crawlPagesBatch(baselineUrls),60000,'Baseline');if(r.results&&r.results.length>0)baselinePages=r.results;baselineFailed=r.failed||[];console.log('  ✅ '+baselinePages.length+' pages | '+baselineFailed.length+' failed');}catch(e){console.warn('  ⚠️ Baseline batch failed: '+e.message);}

    console.log('[4] Crawling challenger...');
    let challengerPages=[homepageChallenger],challengerFailed=[];
    try{const r=await withTimeout(crawlPagesBatch(challengerUrls),60000,'Challenger');if(r.results&&r.results.length>0)challengerPages=r.results;challengerFailed=r.failed||[];console.log('  ✅ '+challengerPages.length+' pages | '+challengerFailed.length+' failed');}catch(e){console.warn('  ⚠️ Challenger batch failed: '+e.message);}

    console.log('[5] Matching pages...');
    const{matched,missingFromChallenger,newInChallenger}=matchPages(baselinePages,challengerPages);
    console.log('  ✅ Matched: '+matched.length+' | Missing: '+missingFromChallenger.length+' | New: '+newInChallenger.length);

    const pageResults=matched.map(function(item){
      const{score,issues}=comparePagePair(item.baseline,item.challenger);
      return{path:item.path,baselineUrl:item.baseline.url,challengerUrl:item.challenger.url,baselineTitle:item.baseline.title||item.path,challengerTitle:item.challenger.title||item.path,score,issueCount:{critical:issues.filter(function(i){return i.severity==='critical';}).length,warning:issues.filter(function(i){return i.severity==='warning';}).length,info:issues.filter(function(i){return i.severity==='info';}).length},issues,stats:{baseline:{wordCount:item.baseline.wordCount,headings:item.baseline.headings.length,images:item.baseline.images.length,forms:item.baseline.forms.length,hasSchema:item.baseline.hasSchema,metaDescription:!!item.baseline.metaDescription,h1:(item.baseline.h1||[])[0]||''},challenger:{wordCount:item.challenger.wordCount,headings:item.challenger.headings.length,images:item.challenger.images.length,forms:item.challenger.forms.length,hasSchema:item.challenger.hasSchema,metaDescription:!!item.challenger.metaDescription,h1:(item.challenger.h1||[])[0]||''}}};
    });
    const avgPageScore=pageResults.length>0?Math.round(pageResults.reduce(function(s,p){return s+p.score;},0)/pageResults.length):100;

    console.log('[6] AI + screenshots...');
    const finalBaseline=baselinePages.find(function(p){return getPath(p.url)==='/';}) ||baselinePages[0];
    const finalChallenger=challengerPages.find(function(p){return getPath(p.url)==='/';}) ||challengerPages[0];
    const ctx={totalBaseline:baselinePages.length,totalChallenger:challengerPages.length,matched,missingFromChallenger,newInChallenger,avgPageScore};
    let analysis;
    try{analysis=await withTimeout(analyzeWithGemini(finalBaseline,finalChallenger,ctx),25000,'Gemini');console.log('  ✅ AI complete');}
    catch(e){console.warn('  ⚠️ AI failed: '+e.message);analysis={overallSummary:matched.length+' pages matched, '+missingFromChallenger.length+' missing.',matchPercentage:avgPageScore,categoryScores:{content:75,navigation:75,seo:75,design:75,forms:75},designComparison:{overallLookFeelScore:75,lookFeelSummary:''},criticalIssues:[],warnings:[],informational:[],missingElements:missingFromChallenger.map(function(p){return getPath(p.url);}),addedElements:newInChallenger.map(function(p){return getPath(p.url);}),contentChanges:[],recommendations:['Review missing pages manually.']};}
    const screenshots={baseline:null,challenger:null,success:false};
    const scores=calculateScore(finalBaseline,finalChallenger,analysis,{pageResults,missingFromChallenger,totalBaseline:baselinePages.length});
    console.log('✅ Complete — Score: '+scores.overall+'%');
    res.json({success:true,report:{
      timestamp:new Date().toISOString(),
      siteStats:{baselinePagesFound:baselinePages.length,challengerPagesFound:challengerPages.length,pagesMatched:matched.length,pagesMissing:missingFromChallenger.length,pagesNew:newInChallenger.length,avgPageScore,baselinePagesFailed:baselineFailed.length,challengerPagesFailed:challengerFailed.length},
      baseline:{url:finalBaseline.url,title:finalBaseline.title,metaDescription:finalBaseline.metaDescription,wordCount:finalBaseline.wordCount,headingCount:finalBaseline.headings.length,imageCount:finalBaseline.images.length,formCount:finalBaseline.forms.length,navItemCount:finalBaseline.navigation.length,hasSchema:finalBaseline.hasSchema,h1:finalBaseline.h1,navigation:finalBaseline.navigation.map(function(n){return n.text;}).slice(0,20),ctaButtons:finalBaseline.ctaButtons.slice(0,15),ctaLinks:baselineCTAs,footerLinks:finalBaseline.footerLinks.slice(0,15),design:finalBaseline.design||{}},
      challenger:{url:finalChallenger.url,title:finalChallenger.title,metaDescription:finalChallenger.metaDescription,wordCount:finalChallenger.wordCount,headingCount:finalChallenger.headings.length,imageCount:finalChallenger.images.length,formCount:finalChallenger.forms.length,navItemCount:finalChallenger.navigation.length,hasSchema:finalChallenger.hasSchema,h1:finalChallenger.h1,navigation:finalChallenger.navigation.map(function(n){return n.text;}).slice(0,20),ctaButtons:finalChallenger.ctaButtons.slice(0,15),ctaLinks:challengerCTAs,footerLinks:finalChallenger.footerLinks.slice(0,15),design:finalChallenger.design||{}},
      scores,analysis,screenshots,
      pages:{matched:pageResults.sort(function(a,b){return a.score-b.score;}),missing:missingFromChallenger.map(function(p){return{url:p.url,path:getPath(p.url),title:p.title||getPath(p.url),wordCount:p.wordCount};}),new:newInChallenger.map(function(p){return{url:p.url,path:getPath(p.url),title:p.title||getPath(p.url)};}),failed:{baseline:baselineFailed,challenger:challengerFailed}}
    }});
  }catch(error){console.error('Error: '+error.message);res.status(500).json({success:false,error:'Analysis failed: '+error.message});}
});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>{console.log('\n🚀 QA Checker on http://localhost:'+PORT+'\n   Gemini: '+(process.env.GEMINI_API_KEY?'✅':'❌')+'\n');});