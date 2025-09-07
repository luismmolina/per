import { NextRequest } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { HarmCategory, HarmBlockThreshold } from '@google/genai';

// Step 3: Final analysis with Gemini 2.5 Pro
async function performFinalAnalysis(question: string, synthesizedData: string, exploration: string, apiKey: string) {
  const genAI = new GoogleGenAI({ apiKey });
  
  console.log('🚀 Step 3: Final analysis with Gemini 2.5 Pro using first principles thinking...');
  const finalPrompt = `You are an expert business analyst and strategic advisor with deep expertise in first principles thinking. Answer this question using the provided data. Follow the consistency and precedence rules exactly so results do not change between runs on the same context.

CONTEXT UNDERSTANDING:
- BEFORE answering any question, thoroughly analyze and understand ALL provided data
- Consider EVERY piece of data that seems relevant, even if it appears tangential
- Look for hidden connections, patterns, and insights within the data
- Ensure you have a complete understanding of the business situation before proceeding
- If data seems incomplete, acknowledge what additional information would be valuable

ANALYTICAL APPROACH:
- Use first principles thinking to break down complex problems into fundamentals
- Maintain mathematical rigor with precise calculations — small errors can flip profit vs loss

CALCULATION STANDARDS:
- Show explicit arithmetic with numeric subtotals; code is optional but keep precision in intermediate steps
- Round only in the final answer; keep intermediate precision
- If any required data is missing, ask one clarifying question instead of substituting ad‑hoc averages

CONSISTENCY & METHOD PRECEDENCE (for month or multi‑month P&L):
1) Revenue: If a daily sales table exists for a month, SUM its venta values and use that total. If both a daily table and a conflicting monthly total exist, prefer the daily sum and list the conflict. Use a single monthly total only if no daily table exists.
2) Supplier COGS: If per‑month invoice lists exist, SUM those invoices. Do NOT use weekly averages if monthly invoices exist. Only if monthly invoices are incomplete or absent, fall back to a documented weekly average and clearly label the fallback.
3) Open Days: Derive open days strictly from rows with venta > 0. Do not infer from calendar unless the table is missing.
4) Tortillas: Multiply the usage rules by the open weekday/weekend counts from (3). Use per‑kg prices effective during the target month; do not apply later changes retroactively.
5) Agua fresca: Multiply daily liters by the open weekday/weekend counts from (3) at the per‑liter price effective during the month.
6) Gas LP: Prefer in‑month tank % deltas × average cost/percentage (computed from purchase records). If insufficient in‑month data, use the nearest reliable average. Only if no estimate possible, sum purchases in that month. State which tier you used.
7) Wages & Fixed Monthly: Use weekly wages prorated by (days_in_month/7). Use monthly baselines for rent, utilities, accountant, advertising, supplies.
8) Multi‑month average: Compute each month independently using 1–7, then average. Do not switch methodology between months.

AUDIT TRAIL:
- For each month, list the dates counted as open (venta > 0) and the resulting weekday/weekend counts.
- If any conflicting figures are present (e.g., two July totals), list them and justify the choice per the precedence above.

QUESTION: ${question}

DATA: ${synthesizedData}

RESPONSE STRUCTURE:
- Start with a clear, direct answer
- Extract only the necessary data and list conflicts if any
- Define variables; state the precedence used
- Compute with explicit arithmetic and subtotals for each month (if multi‑month)
- Provide concise, actionable recommendations with quantified impact

Remember: In business, precision matters. A 1% calculation error can be the difference between profit and loss.`;

  const finalContents = [{ role: 'user', parts: [{ text: finalPrompt }] }];
  
  // Count tokens for final step
  const model = process.env.GEMINI_MODEL || 'models/gemini-2.5-flash';
  const finalTokenCount = await genAI.models.countTokens({
    model,
    contents: finalContents,
  });
  
  const finalResult = await genAI.models.generateContentStream({
    model,
    contents: finalContents,
    config: {
      thinkingConfig: {
        includeThoughts: true,
        thinkingBudget: -1,
      },
      safetySettings: [
        {
          category: (HarmCategory as any).HARM_CATEGORY_HARASSMENT,
          threshold: (HarmBlockThreshold as any).BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: (HarmCategory as any).HARM_CATEGORY_HATE_SPEECH,
          threshold: (HarmBlockThreshold as any).BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: (HarmCategory as any).HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: (HarmBlockThreshold as any).BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: (HarmCategory as any).HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: (HarmBlockThreshold as any).BLOCK_MEDIUM_AND_ABOVE,
        },
      ] as any,
    },
  });

  const finalInputTokens = finalTokenCount.totalTokens || 0;
  const finalInputCost = (finalInputTokens / 1000000) * 1.25;
  
  console.log(`💰 Step 3 (Pro) - Input: ${finalInputTokens} tokens ($${finalInputCost.toFixed(4)})`);

  return { finalResult, finalInputCost, finalInputTokens };
}

// Helper function to assess data quality based on token reduction
function assessDataQuality(synthesizedTokens: number, fullTokens: number, reductionPercentage: number): number {
  // Score based on balance between efficiency and completeness
  if (reductionPercentage < 30) {
    return 10; // Excellent - minimal reduction, high completeness
  } else if (reductionPercentage < 50) {
    return 9; // Very good - good balance
  } else if (reductionPercentage < 70) {
    return 8; // Good - reasonable balance
  } else if (reductionPercentage < 85) {
    return 7; // Fair - some risk of missing context
  } else {
    return 6; // Poor - high risk of missing critical data
  }
}

// Helper function to get quality description
function getQualityDescription(score: number): string {
  if (score >= 9) return "Excellent - Minimal data loss, high confidence";
  if (score >= 8) return "Very Good - Good balance of efficiency and completeness";
  if (score >= 7) return "Good - Reasonable trade-off between cost and quality";
  if (score >= 6) return "Fair - Some risk of missing context";
  return "Poor - High risk of incomplete analysis";
}

// Convert stream to readable stream - FIXED VERSION
function iteratorToStream(iterator: AsyncGenerator<any, any, undefined>): ReadableStream<any> {
  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      
      try {
        for await (const chunk of iterator) {
          if ((globalThis as any).process?.env?.DEBUG) {
            console.log('🔍 Received chunk from Gemini:', JSON.stringify(chunk, null, 2));
          }
          
          // Process regular content from the Gemini SDK
          if (chunk.candidates && chunk.candidates[0] && chunk.candidates[0].content) {
            const content = chunk.candidates[0].content;
            
            if (content.parts) {
              for (const part of content.parts) {
                if (part.text) {
                  // Debug: Log all parts to see what we're getting
                  console.log('📦 Part received:', {
                    hasThought: part.thought === true,
                    thoughtProperty: part.thought,
                    textLength: part.text?.length || 0,
                    textPreview: part.text?.substring(0, 100) + '...'
                  });
                  
                  // Check if this part has the thought property
                  if (part.thought === true) {
                    // Send thought summary as SSE
                    const data = {
                      type: 'thought',
                      content: part.text
                    };
                    const sseData = `data: ${JSON.stringify(data)}\n\n`;
                    controller.enqueue(encoder.encode(sseData));
                    console.log('🧠 Sending thought to frontend:', part.text?.substring(0, 200) + '...');
                  } else {
                    // Send regular text content as SSE
                    const data = {
                      type: 'text',
                      content: part.text
                    };
                    const sseData = `data: ${JSON.stringify(data)}\n\n`;
                    controller.enqueue(encoder.encode(sseData));
                    if ((globalThis as any).process?.env?.DEBUG) {
                      console.log('💬 Sending text to frontend:', part.text?.substring(0, 100) + '...');
                    }
                  }
                } else if (part.executableCode) {
                  // Send code as SSE
                  const data = {
                    type: 'code',
                    content: {
                      code: part.executableCode.code,
                      language: part.executableCode.language
                    }
                  };
                  const sseData = `data: ${JSON.stringify(data)}\n\n`;
                  controller.enqueue(encoder.encode(sseData));
                } else if (part.codeExecutionResult) {
                  // Send code execution result as SSE
                  const data = {
                    type: 'code_result',
                    content: {
                      outcome: part.codeExecutionResult.outcome,
                      output: part.codeExecutionResult.output
                    }
                  };
                  const sseData = `data: ${JSON.stringify(data)}\n\n`;
                  controller.enqueue(encoder.encode(sseData));
                }
              }
            }
          }
        }
        
        controller.close();
      } catch (error) {
        console.error('Stream error:', error);
        controller.error(error);
      }
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = (globalThis as any).process?.env?.GEMINI_API_KEY || (globalThis as any).process?.env?.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) {
      return new Response('Error: GEMINI_API_KEY is not set.', { status: 500 });
    }

    const { question, synthesizedData, exploration } = await req.json();
    if (!question || !synthesizedData || !exploration) {
      return new Response('Error: Question, synthesizedData, and exploration are required.', { status: 400 });
    }

    const { finalResult, finalInputCost, finalInputTokens } = await performFinalAnalysis(
      question, 
      synthesizedData, 
      exploration, 
      apiKey
    );
    
    // Calculate cost comparison and quality assessment
    const genAI = new GoogleGenAI({ apiKey });
    const fullContextPrompt = `You are a business analyst. Answer the following question using the provided context.

QUESTION: ${question}

CONTEXT: ${exploration}

Provide a comprehensive, actionable answer. Use code execution for calculations when needed. Include specific numbers and insights.`;

    const fullContextContents = [{ role: 'user', parts: [{ text: fullContextPrompt }] }];
    const model = process.env.GEMINI_MODEL || 'models/gemini-2.5-flash';
    const fullContextTokenCount = await genAI.models.countTokens({
      model,
      contents: fullContextContents,
    });
    
    const fullContextTokens = fullContextTokenCount.totalTokens || 0;
    const fullContextCost = (fullContextTokens / 1000000) * 1.25;
    const tokenReduction = fullContextTokens - finalInputTokens;
    const tokenReductionPercentage = (tokenReduction / fullContextTokens) * 100;
    
    console.log(`💰 Single-Model Equivalent Cost: $${fullContextCost.toFixed(4)} (${fullContextTokens} tokens)`);
    console.log(`💰 Step 3 Cost: $${finalInputCost.toFixed(4)} (${finalInputTokens} tokens)`);
    console.log(`💰 Token Reduction: ${tokenReduction} tokens (${tokenReductionPercentage.toFixed(1)}% reduction)`);
    
    // Data quality assessment
    const dataQualityScore = assessDataQuality(finalInputTokens, fullContextTokens, tokenReductionPercentage);
    console.log(`📊 Data Quality Score: ${dataQualityScore}/10 (${getQualityDescription(dataQualityScore)})`);
    
    // Convert the SDK's stream to a ReadableStream for the Next.js response
    const stream = iteratorToStream(finalResult);

    // Return the stream as Server-Sent Events
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (e) {
    console.error('Analyze API error:', e);
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
