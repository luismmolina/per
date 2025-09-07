import { NextRequest } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Step 1: Planning with Gemini 2.5 Flash
async function createAnalysisPlan(question: string, apiKey: string) {
  const genAI = new GoogleGenAI({ apiKey });
  
  console.log('🔍 Step 1: Creating analysis plan with Gemini 2.5 Flash...');
  const planPrompt = `You are a business analysis planner. Given this question and context, create a detailed step-by-step plan for answering it.

QUESTION: ${question}

Create a plan that includes:
1. What specific data points are needed
2. What calculations or analysis should be performed
3. What insights should be highlighted
4. What format the answer should take

Respond with ONLY the plan, no explanations. Use bullet points for clarity.`;

  const planContents = [{ role: 'user', parts: [{ text: planPrompt }] }];
  
  // Count tokens for plan step
  const model = process.env.GEMINI_MODEL || 'models/gemini-2.5-flash';
  const planTokenCount = await genAI.models.countTokens({
    model,
    contents: planContents,
  });
  
  const planResult = await genAI.models.generateContent({
    model,
    contents: planContents,
  });
  
  const plan = planResult.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log('📋 Plan created:', plan.substring(0, 200) + '...');
  
  // Get plan response tokens
  const planResponseTokens = planResult.usageMetadata?.totalTokenCount || 0;
  const planInputCost = ((planTokenCount.totalTokens || 0) / 1000000) * 0.30;
  const planOutputCost = (planResponseTokens / 1000000) * 2.50;
  const planTotalCost = planInputCost + planOutputCost;
  
  console.log(`💰 Step 1 (Plan) - Input: ${planTokenCount.totalTokens} tokens ($${planInputCost.toFixed(4)}), Output: ${planResponseTokens} tokens ($${planOutputCost.toFixed(4)}), Total: $${planTotalCost.toFixed(4)}`);

  return { plan, planTotalCost };
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) {
      return new Response('Error: GEMINI_API_KEY is not set.', { status: 500 });
    }

    const { question } = await req.json();
    if (!question) {
      return new Response('Error: Question is required.', { status: 400 });
    }

    const result = await createAnalysisPlan(question, apiKey);
    
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Plan API error:', e);
    return new Response(`Error: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
} 
