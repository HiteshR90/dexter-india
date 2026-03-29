import { callLlm } from '../model/llm.js';
import { z } from 'zod';
import type { StockData, PersonaVerdict } from './personas.js';
import type { DebateResult } from './debate.js';

const MODEL = 'anthropic/claude-haiku-4-5-20251001';

// ── Risk Flags ──
export interface RiskFlags {
  highConcentration?: boolean;    // >20% of portfolio in this stock
  deepLoss?: boolean;             // P&L < -30%
  highVolatility?: boolean;       // stock is very volatile
  sectorOverweight?: boolean;     // too much in one sector
  recentBadNews?: boolean;        // negative news in last 7 days
  insiderSelling?: boolean;       // promoter/insider selling
}

// ── Stock Decision ──
export const StockDecisionSchema = z.object({
  symbol: z.string(),
  decision: z.enum(['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'EXIT']),
  confidence: z.number().min(1).max(100),
  targetPrice: z.number().optional(),
  stopLoss: z.number().optional(),
  reasoning: z.string(),
  keyFactors: z.array(z.string()),
});

export type StockDecision = z.infer<typeof StockDecisionSchema>;

// ── CIO Decision Agent ──
export async function makeDecision(
  stockData: StockData,
  personaVerdicts: PersonaVerdict[],
  debateResult: DebateResult,
  riskFlags: RiskFlags,
): Promise<StockDecision> {
  const verdictSummary = personaVerdicts
    .map((v) => `${v.persona}: ${v.verdict} (${v.conviction}/10)`)
    .join(', ');

  const avgConviction =
    personaVerdicts.reduce((sum, v) => sum + v.conviction, 0) / personaVerdicts.length;

  const bullCount = personaVerdicts.filter((v) =>
    ['STRONG_BUY', 'BUY'].includes(v.verdict),
  ).length;
  const bearCount = personaVerdicts.filter((v) =>
    ['SELL', 'STRONG_SELL'].includes(v.verdict),
  ).length;

  const riskFlagsList = Object.entries(riskFlags)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const systemPrompt = `You are the Chief Investment Officer (CIO) of an Indian equity portfolio. Make the FINAL decision on this stock.

DECISION FRAMEWORK:
- Weigh persona verdicts (consensus matters), debate outcome, risk flags, and technicals+fundamentals
- If 3+ personas say SELL and debate bear wins → lean EXIT
- If 3+ personas say BUY and debate bull wins → lean BUY/STRONG_BUY
- Risk flags can override bullish signals (capital preservation first)
- For stocks in deep loss (>30%), consider tax-loss harvesting vs recovery potential
- Always set stop-loss for HOLD/BUY decisions (typically 10-15% below current price)
- Be decisive. Wishy-washy HOLD with low conviction = SELL`;

  const outputSchema = z.object({
    decision: z.enum(['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'EXIT']),
    confidence: z.number().min(1).max(100),
    targetPrice: z.number().optional().describe('12-month target price in INR'),
    stopLoss: z.number().optional().describe('Stop-loss price in INR'),
    reasoning: z.string().describe('2-3 sentence final reasoning'),
    keyFactors: z.array(z.string()).describe('Top 3-5 factors driving this decision'),
  });

  const prompt = `STOCK: ${stockData.symbol} (${stockData.name})
Price: ₹${stockData.currentPrice} | Avg Cost: ₹${stockData.avgPrice} | P&L: ${stockData.pnlPercent}%
Technical Score: ${stockData.technicals.overallScore}/100 | Fundamental Score: ${stockData.fundamentals.overallScore}/100

PERSONA VERDICTS: ${verdictSummary}
Avg Conviction: ${avgConviction.toFixed(1)}/10 | Bull: ${bullCount} | Bear: ${bearCount} | Hold: ${4 - bullCount - bearCount}

DEBATE WINNER: ${debateResult.winner.toUpperCase()} (confidence: ${debateResult.confidence}%)
Moderator: ${debateResult.moderatorSummary}

RISK FLAGS: ${riskFlagsList.length > 0 ? riskFlagsList.join(', ') : 'None'}

Make your final CIO decision.`;

  const { response } = await callLlm(prompt, { model: MODEL, systemPrompt, outputSchema });
  const result = response as unknown as z.infer<typeof outputSchema>;

  return {
    symbol: stockData.symbol,
    decision: result.decision,
    confidence: result.confidence,
    targetPrice: result.targetPrice,
    stopLoss: result.stopLoss,
    reasoning: result.reasoning,
    keyFactors: result.keyFactors,
  };
}
