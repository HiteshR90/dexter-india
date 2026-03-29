import { callLlm } from '../model/llm.js';
import { z } from 'zod';
import type { StockData, PersonaVerdict } from './personas.js';

const MODEL = 'anthropic/claude-haiku-4-5-20251001';

// ── Debate Result ──
export interface DebateResult {
  winner: 'bull' | 'bear';
  bullArgument: string;
  bearArgument: string;
  moderatorSummary: string;
  confidence: number;
}

function formatVerdicts(verdicts: PersonaVerdict[]): string {
  return verdicts
    .map((v) => `${v.persona}: ${v.verdict} (${v.conviction}/10) — ${v.reasoning}`)
    .join('\n');
}

// ── Bull Agent ──
export async function bullAgent(
  stockData: StockData,
  personaVerdicts: PersonaVerdict[],
  previousBearArg?: string,
): Promise<string> {
  const rebuttal = previousBearArg
    ? `\n\nThe bear argues: "${previousBearArg}"\nCounter this argument while making your bull case stronger.`
    : '';

  const systemPrompt = `You are a Bull analyst. Make the STRONGEST possible case for HOLDING/BUYING this stock. Use data, not hope. Be specific with numbers and catalysts.`;

  const prompt = `Stock: ${stockData.symbol} (${stockData.name}) at ₹${stockData.currentPrice}
P&L: ${stockData.pnlPercent}% | PE: ${stockData.fundamentals.pe} | ROE: ${stockData.fundamentals.roe}% | RSI: ${stockData.technicals.rsi}
Technical Score: ${stockData.technicals.overallScore}/100 | Fundamental Score: ${stockData.fundamentals.overallScore}/100

Persona Verdicts:
${formatVerdicts(personaVerdicts)}

News: ${stockData.recentNews.join(' | ')}
${rebuttal}
Make your bull case in 3-4 sentences. Be specific and data-driven.`;

  const { response } = await callLlm(prompt, { model: MODEL, systemPrompt });
  return response as string;
}

// ── Bear Agent ──
export async function bearAgent(
  stockData: StockData,
  personaVerdicts: PersonaVerdict[],
  previousBullArg?: string,
): Promise<string> {
  const rebuttal = previousBullArg
    ? `\n\nThe bull argues: "${previousBullArg}"\nCounter this argument while making your bear case stronger.`
    : '';

  const systemPrompt = `You are a Bear analyst. Make the STRONGEST possible case for SELLING/EXITING this stock. Focus on risks, red flags, and downside scenarios. Be specific.`;

  const prompt = `Stock: ${stockData.symbol} (${stockData.name}) at ₹${stockData.currentPrice}
P&L: ${stockData.pnlPercent}% | PE: ${stockData.fundamentals.pe} | ROE: ${stockData.fundamentals.roe}% | RSI: ${stockData.technicals.rsi}
Technical Score: ${stockData.technicals.overallScore}/100 | Fundamental Score: ${stockData.fundamentals.overallScore}/100

Persona Verdicts:
${formatVerdicts(personaVerdicts)}

News: ${stockData.recentNews.join(' | ')}
${rebuttal}
Make your bear case in 3-4 sentences. Be specific about risks and red flags.`;

  const { response } = await callLlm(prompt, { model: MODEL, systemPrompt });
  return response as string;
}

// ── Moderator ──
async function moderator(
  stockData: StockData,
  bullArg: string,
  bearArg: string,
): Promise<{ winner: 'bull' | 'bear'; summary: string; confidence: number }> {
  const outputSchema = z.object({
    winner: z.enum(['bull', 'bear']).describe('Which side made a stronger case'),
    summary: z.string().describe('2-3 sentence summary of the key deciding factors'),
    confidence: z.number().min(1).max(100).describe('Confidence in the decision 1-100'),
  });

  const systemPrompt = `You are an impartial market moderator. Evaluate both bull and bear arguments objectively. Pick the winner based on strength of evidence, not bias. Consider risk-adjusted returns.`;

  const prompt = `Stock: ${stockData.symbol} at ₹${stockData.currentPrice} (P&L: ${stockData.pnlPercent}%)

BULL CASE: ${bullArg}

BEAR CASE: ${bearArg}

Who makes a stronger evidence-based argument? Pick a winner.`;

  const { response } = await callLlm(prompt, { model: MODEL, systemPrompt, outputSchema });
  return response as unknown as z.infer<typeof outputSchema>;
}

// ── Run Full Debate (2 rounds + moderator) ──
export async function runDebate(
  stockData: StockData,
  personaVerdicts: PersonaVerdict[],
): Promise<DebateResult> {
  // Round 1: Opening arguments
  const [bullR1, bearR1] = await Promise.all([
    bullAgent(stockData, personaVerdicts),
    bearAgent(stockData, personaVerdicts),
  ]);

  // Round 2: Rebuttals
  const [bullR2, bearR2] = await Promise.all([
    bullAgent(stockData, personaVerdicts, bearR1),
    bearAgent(stockData, personaVerdicts, bullR1),
  ]);

  const finalBull = `${bullR1}\n\nRebuttal: ${bullR2}`;
  const finalBear = `${bearR1}\n\nRebuttal: ${bearR2}`;

  // Moderator decides
  const decision = await moderator(stockData, finalBull, finalBear);

  return {
    winner: decision.winner,
    bullArgument: finalBull,
    bearArgument: finalBear,
    moderatorSummary: decision.summary,
    confidence: decision.confidence,
  };
}
