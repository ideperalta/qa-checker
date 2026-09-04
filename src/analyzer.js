const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;
function getClient() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set.');
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

function parseJsonSafely(text) {
  const cleanText = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '').replace(/^```\s*/, '');
  return JSON.parse(cleanText);
}

function getMimeType(base64Str) {
  if (base64Str.startsWith('data:image/png')) return 'image/png';
  if (base64Str.startsWith('data:image/webp')) return 'image/webp';
  return 'image/jpeg';
}

async function analyzeVisualDifference(baselineB64, challengerB64) {
  // Restoring the exact 2.5 and 2.0 models from your original codebase
  const models = [
    'gemini-2.5-flash-preview-05-20',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro'
  ];
  
  const bMime = getMimeType(baselineB64);
  const cMime = getMimeType(challengerB64);

  const bData = baselineB64.replace(/^data:image\/\w+;base64,/, '');
  const cData = challengerB64.replace(/^data:image\/\w+;base64,/, '');

  const imageParts = [
    { inlineData: { data: bData, mimeType: bMime } },
    { inlineData: { data: cData, mimeType: cMime } }
  ];

  const prompt = `You are a senior UI/UX QA engineer. You are provided with two screenshots of a website. 
  The FIRST image is the BASELINE (original site). 
  The SECOND image is the CHALLENGER (new site). 
  
  Compare them pixel by pixel and structure by structure.
  Return ONLY valid JSON with this exact structure, with no markdown code block formatting:
  {
    "matchScore": 0,
    "overallSummary": "A brief 2-sentence summary of visual parity.",
    "visualDifferences": ["diff 1", "diff 2"],
    "missingElements": ["missing 1", "missing 2"],
    "layoutShifts": ["shift 1", "shift 2"]
  }`;

  let errorLogs = [];

  for (let i = 0; i < models.length; i++) {
    try {
      const model = getClient().getGenerativeModel({ model: models[i] });
      console.log('  Running vision analysis on ' + models[i] + '...');
      
      const result = await model.generateContent([prompt, imageParts[0], imageParts[1]]);
      const text = result.response.text();
      
      return parseJsonSafely(text);
    } catch (err) {
      console.warn('  Failed ' + models[i] + ': ' + err.message);
      errorLogs.push(models[i] + ' failed: ' + err.message);
    }
  }
  
  throw new Error('Analysis failed. ' + errorLogs.join(' | '));
}

module.exports = { analyzeVisualDifference };