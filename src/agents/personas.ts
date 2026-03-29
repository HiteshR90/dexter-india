import { callLlm } from '../model/llm.js';
import { z } from 'zod';
import { getJhunjhunwalaPrompt } from './prompts/jhunjhunwala.js';
import { getDamaniPrompt } from './prompts/damani.js';
import { getContrarianPrompt } from './prompts/contrarian.js';
import { getMomentumPrompt } from './prompts/momentum.js';

const MODEL = 'anthropic/claude-haiku-4-5-20251001';

// ── Stock Data Interface ──
export interface StockData {
  symbol: string;
  name: string;
  currentPrice: number;
  avgPrice: number;
  pnlPercent: number;
  technicals: {
    rsi: number;
    macd: string;
    maSignal: string;
    overallScore: number;
  };
  fundamentals: {
    pe: number;
    roe: number;
    roce: number;
    debtToEquity: number;
    revenueGrowth: number;
    overallScore: number;
  };
  recentNews: string[];
}

// ── Persona Verdict Schema ──
export const PersonaVerdictSchema = z.object({
  persona: z.string(),
  verdict: z.enum(['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL']),
  conviction: z.number().min(1).max(10),
  reasoning: z.string(),
  targetPrice: z.number().optional(),
  timeHorizon: z.string().optional(),
});

export type PersonaVerdict = z.infer<typeof PersonaVerdictSchema>;

// ── Persona Definitions ──
const PERSONAS = [
  { name: 'Rakesh Jhunjhunwala', getPrompt: getJhunjhunwalaPrompt },
  { name: 'Radhakishan Damani', getPrompt: getDamaniPrompt },
  { name: 'Contrarian Value', getPrompt: getContrarianPrompt },
  { name: 'Momentum Trader', getPrompt: getMomentumPrompt },
] as const;

// ── Run Single Persona ──
export async function runPersona(
  personaName: string,
  systemPrompt: string,
  stockData: StockData,
): Promise<PersonaVerdict> {
  const outputSchema = z.object({
    verdict: z.enum(['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL']),
    conviction: z.number().min(1).max(10).describe('Conviction level 1-10'),
    reasoning: z.string().describe('2-3 sentence reasoning for the verdict'),
    targetPrice: z.number().optional().describe('12-month target price in INR'),
    timeHorizon: z.string().optional().describe('Recommended holding period e.g. "6-12 months"'),
  });

  const userPrompt = `Analyze ${stockData.symbol} (${stockData.name}) at ₹${stockData.currentPrice}. Give your verdict with conviction level and reasoning.`;

  const { response } = await callLlm(userPrompt, {
    model: MODEL,
    systemPrompt,
    outputSchema,
  });

  const result = response as unknown as z.infer<typeof outputSchema>;

  return {
    persona: personaName,
    verdict: result.verdict,
    conviction: result.conviction,
    reasoning: result.reasoning,
    targetPrice: result.targetPrice,
    timeHorizon: result.timeHorizon,
  };
}

// ── Run All Personas ──
export async function runAllPersonas(stockData: StockData): Promise<PersonaVerdict[]> {
  const results = await Promise.all(
    PERSONAS.map((p) => {
      const systemPrompt = p.getPrompt(stockData);
      return runPersona(p.name, systemPrompt, stockData);
    }),
  );

  return results;
}
