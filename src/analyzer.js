const{GoogleGenerativeAI}=require('@google/generative-ai');
let genAI=null;
function getClient(){if(!genAI){if(!process.env.GEMINI_API_KEY)throw new Error('GEMINI_API_KEY not set.');genAI=new GoogleGenerativeAI(process.env.GEMINI_API_KEY);}return genAI;}
async function analyzeWithGemini(baseline,challenger,ctx){
  var MODELS=['gemini-2.5-flash-preview-05-20','gemini-2.5-flash','gemini-2.0-flash','gemini-1.5-flash','gemini-1.5-pro'];
  for(var i=0;i<MODELS.length;i++){
    try{
      var model=getClient().getGenerativeModel({model:MODELS[i],generationConfig:{temperature:0.2,maxOutputTokens:4096}});
      console.log('  Trying: '+MODELS[i]);
      var result=await model.generateContent(buildPrompt(summarize(baseline),summarize(challenger),ctx));
      console.log('  ✅ Worked: '+MODELS[i]);
      return parseJsonSafely(result.response.text());
    }catch(err){console.warn('  Failed '+MODELS[i]+': '+err.message);if(i===MODELS.length-1)return algorithmicFallback(baseline,challenger,ctx);}
  }
}
function summarize(s){
  return{url:s.url,title:s.title,metaDescription:s.metaDescription?s.metaDescription.substring(0,200):null,canonicalUrl:s.canonicalUrl||null,hasSchema:s.hasSchema,schemaTypes:s.schemaTypes,ogTags:s.ogTags,h1:s.h1,h2:(s.h2||[]).slice(0,12),h3:(s.h3||[]).slice(0,8),navigation:s.navigation.map(function(n){return n.text;}).slice(0,20),ctaButtons:s.ctaButtons.slice(0,15),forms:s.forms.map(function(f){return{fieldCount:f.fields.length,fields:f.fields.map(function(x){return x.label;}).slice(0,10),submitText:f.submitText};}),footerLinks:s.footerLinks.slice(0,15),imageCount:s.images.length,wordCount:s.wordCount,phones:s.phones,emails:s.emails,sampleContent:(s.paragraphs||[]).slice(0,5).map(function(p){return p.substring(0,160);}),design:s.design||{}};
}
function buildPrompt(b,c,ctx){
  var mp=ctx?'\n## MULTI-PAGE:\n- Baseline: '+(ctx.totalBaseline||'N/A')+'\n- Challenger: '+(ctx.totalChallenger||'N/A')+'\n- Matched: '+(ctx.matched||[]).length+'\n- Missing: '+(ctx.missingFromChallenger||[]).length+'\n- Avg: '+(ctx.avgPageScore||'N/A')+'%\n':'';
  var dB=b.design?'\n## BASELINE DESIGN:\n'+JSON.stringify(b.design,null,2):'';
  var dC=c.design?'\n## CHALLENGER DESIGN:\n'+JSON.stringify(c.design,null,2):'';
  return 'You are a senior QA analyst. Compare BASELINE vs CHALLENGER.\nFocus: content, navigation, SEO, forms, look & feel.\n\n## BASELINE:\n'+JSON.stringify(b,null,2)+'\n\n## CHALLENGER:\n'+JSON.stringify(c,null,2)+'\n'+mp+dB+dC+
    '\n\nReturn ONLY valid JSON:\n{"overallSummary":"","matchPercentage":0,"categoryScores":{"content":0,"navigation":0,"seo":0,"design":0,"forms":0},"designComparison":{"colorsMatch":true,"fontsMatch":true,"layoutMatch":true,"colorChanges":"","fontChanges":"","layoutChanges":"","missingComponents":[],"addedComponents":[],"overallLookFeelScore":0,"lookFeelSummary":""},"criticalIssues":[{"title":"","description":"","baseline":"","challenger":"","impact":""}],"warnings":[{"title":"","description":"","baseline":"","challenger":"","impact":""}],"informational":[{"title":"","description":"","baseline":"","challenger":""}],"missingElements":[""],"addedElements":[""],"contentChanges":[""],"recommendations":[""]}';
}
function parseJsonSafely(text){return JSON.parse(text.trim().replace(/^```json\s*/i,'').replace(/\s*```$/,'').replace(/^```\s*/,'').replace(/\s*```$/,''));}
function algorithmicFallback(baseline,challenger,ctx){
  var crit=[],warn=[],info=[],missing=[];
  var bNav=baseline.navigation.map(function(n){return n.text.toLowerCase();}),cNav=challenger.navigation.map(function(n){return n.text.toLowerCase();});
  bNav.forEach(function(item){if(!cNav.some(function(c){return c.includes(item)||item.includes(c);})){crit.push({title:'Missing nav: "'+item+'"',description:'"'+item+'" in baseline not challenger.',baseline:item,challenger:'Not found',impact:'Users cannot find this section.'});missing.push('Nav: "'+item+'"');}});
  if(baseline.h1.length>0&&challenger.h1.length===0)crit.push({title:'Missing H1',description:'No H1 in challenger.',baseline:baseline.h1[0],challenger:'None',impact:'SEO impact.'});
  if(baseline.forms.length>challenger.forms.length)crit.push({title:'Missing Forms',description:'Baseline:'+baseline.forms.length+' Challenger:'+challenger.forms.length+'.',baseline:baseline.forms.length+' forms',challenger:challenger.forms.length+' forms',impact:'Conversion actions unavailable.'});
  if(baseline.metaDescription&&!challenger.metaDescription)warn.push({title:'Missing Meta Desc',description:'Baseline has meta; challenger does not.',baseline:baseline.metaDescription,challenger:'None',impact:'Lower CTR.'});
  if(baseline.hasSchema&&!challenger.hasSchema)warn.push({title:'Missing Schema',description:'Schema in baseline, absent in challenger.',baseline:'Present',challenger:'None',impact:'Loss of rich results.'});
  var bD=baseline.design||{},cD=challenger.design||{};
  if(bD.cssFramework&&cD.cssFramework&&bD.cssFramework!==cD.cssFramework)warn.push({title:'CSS Framework Changed',description:'Baseline: '+bD.cssFramework+' → Challenger: '+cD.cssFramework+'.',baseline:bD.cssFramework,challenger:cD.cssFramework,impact:'Visual differences likely.'});
  if(bD.layoutType&&cD.layoutType&&bD.layoutType!==cD.layoutType)warn.push({title:'Layout Changed',description:'Layout: '+bD.layoutType+' → '+cD.layoutType+'.',baseline:bD.layoutType,challenger:cD.layoutType,impact:'Page structure looks different.'});
  if(bD.hasHero&&!cD.hasHero)warn.push({title:'Hero Section Missing',description:'Baseline has hero; challenger does not.',baseline:'Present',challenger:'Missing',impact:'Visual impact reduced.'});
  if(JSON.stringify(bD.googleFonts)!==JSON.stringify(cD.googleFonts))info.push({title:'Fonts Changed',description:'Font families differ.',baseline:(bD.googleFonts||[]).join(', ')||'Default',challenger:(cD.googleFonts||[]).join(', ')||'Default'});
  if(bD.themeColor&&cD.themeColor&&bD.themeColor!==cD.themeColor)info.push({title:'Theme Color Changed',description:'Brand color changed.',baseline:bD.themeColor,challenger:cD.themeColor});
  if(ctx&&ctx.missingFromChallenger&&ctx.missingFromChallenger.length>0){var mp=ctx.missingFromChallenger;crit.push({title:mp.length+' Page(s) Missing',description:'Missing: '+mp.slice(0,5).map(function(p){try{return new URL(p.url).pathname;}catch(e){return p.url;}}).join(', ')+(mp.length>5?' +more':'')+'.',baseline:mp.length+' pages',challenger:'Not found',impact:'Pages unreachable.'});mp.forEach(function(p){try{missing.push('Page: '+new URL(p.url).pathname);}catch(e){}});}
  var navS=bNav.length>0?Math.round(((bNav.length-crit.filter(function(i){return i.title.startsWith('Missing nav');}).length)/bNav.length)*100):100;
  var seoS=Math.max(0,100-(baseline.metaDescription&&!challenger.metaDescription?25:0)-(baseline.hasSchema&&!challenger.hasSchema?20:0)-(baseline.h1.length>0&&challenger.h1.length===0?20:0));
  var frmS=baseline.forms.length>0?Math.round((challenger.forms.length/baseline.forms.length)*100):100;
  var cntS=baseline.wordCount>0?Math.min(100,Math.round((challenger.wordCount/baseline.wordCount)*100)):100;
  var dsnS=Math.max(0,100-warn.filter(function(w){return w.title.includes('Layout')||w.title.includes('Hero')||w.title.includes('Framework');}).length*15-info.filter(function(i){return i.title.includes('Font')||i.title.includes('Color');}).length*5);
  var tot=Math.min(100,Math.max(0,Math.round(cntS*0.30+navS*0.25+seoS*0.20+frmS*0.15+dsnS*0.10)-crit.length*3));
  if(ctx&&ctx.missingFromChallenger&&ctx.totalBaseline)tot=Math.max(0,Math.round(tot*(1-(ctx.missingFromChallenger.length/ctx.totalBaseline)*0.5)));
  return{overallSummary:'Algorithmic: '+crit.length+' critical, '+warn.length+' warnings.',matchPercentage:tot,categoryScores:{content:cntS,navigation:navS,seo:seoS,design:dsnS,forms:frmS},designComparison:{colorsMatch:JSON.stringify(bD.colors)===JSON.stringify(cD.colors),fontsMatch:JSON.stringify(bD.googleFonts)===JSON.stringify(cD.googleFonts),layoutMatch:bD.layoutType===cD.layoutType,colorChanges:(bD.colors||[]).join(',')+'→'+(cD.colors||[]).join(','),fontChanges:(bD.googleFonts||[]).join(',')+'→'+(cD.googleFonts||[]).join(','),layoutChanges:(bD.layoutType||'unknown')+'→'+(cD.layoutType||'unknown'),missingComponents:bD.hasHero&&!cD.hasHero?['Hero section']:[],addedComponents:[],overallLookFeelScore:dsnS,lookFeelSummary:'Design comparison based on extracted CSS, fonts, and layout.'},criticalIssues:crit,warnings:warn,informational:info,missingElements:missing,addedElements:[],contentChanges:[],recommendations:['Verify all pages exist.','Check navigation items.','Restore missing forms/meta.','Review design consistency.']};
}
module.exports={analyzeWithGemini};