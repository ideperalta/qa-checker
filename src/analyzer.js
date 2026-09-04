const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;
function getClient() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set.');
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

async function analyzeVisualDifference(baselineB64, challengerB64) {
  const models = ['gemini-1.5-flash', 'gemini-1.5-pro'];
  
  // Extract pure base64 data by stripping the MIME prefix if present
  const bData = baselineB64.replace(/^data:image\/\w+;base64,/, '');
  const cData = challengerB64.replace(/^data:image\/\w+;base64,/, '');

  const imageParts = [
    { inlineData: { data: bData, mimeType: "image/jpeg" } },
    { inlineData: { data: cData, mimeType: "image/jpeg" } }
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

  for (let i = 0; i < models.length; i++) {
    try {
      const model = getClient().getGenerativeModel({ 
        model: models[i], 
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 } 
      });
      console.log(`  Running vision analysis on ${models[i]}...`);
      
      const result = await model.generateContent([prompt, ...imageParts]);
      const text = result.response.text();
      
      return JSON.parse(text.trim());
    } catch (err) {
      console.warn(`  Failed ${models[i]}: ${err.message}`);
      if (i === models.length - 1) {
        throw new Error('All Gemini visual analysis attempts failed.');
      }
    }
  }
}

module.exports = { analyzeVisualDifference };