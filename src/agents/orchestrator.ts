import { runAllPersonas } from './personas.js';
import { runDebate } from './debate.js';
import { makeDecision } from './decision.js';
import { callLlm } from '../model/llm.js';
import { z } from 'zod';
import type { StockData, PersonaVerdict } from './personas.js';
import type { DebateResult } from './debate.js';
import type { StockDecision, RiskFlags } from './decision.js';

const MODEL = 'anthropic/claude-haiku-4-5-20251001';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const BATCH_SIZE = 3;

// ── Types ──
export interface Holding {
  symbol: string;
  name: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  pnlPercent: number;
}

export interface TechnicalData {
  rsi: number;
  macd: string;
  maSignal: string;
  overallScore: number;
}

export interface FundamentalData {
  pe: number;
  roe: number;
  roce: number;
  debtToEquity: number;
  revenueGrowth: number;
  overallScore: number;
}

export interface FullStockAnalysis {
  symbol: string;
  name: string;
  stockData: StockData;
  personaVerdicts: PersonaVerdict[];
  debateResult: DebateResult;
  decision: StockDecision;
  analyzedAt: Date;
}

export interface PortfolioAnalysis {
  analyses: FullStockAnalysis[];
  weeklyActionPlan: string;
  analyzedAt: Date;
  totalStocks: number;
}

// ── Cache ──
interface CacheEntry {
  data: FullStockAnalysis;
  expiresAt: number;
}

const analysisCache = new Map<string, CacheEntry>();

function getCached(symbol: string): FullStockAnalysis | null {
  const entry = analysisCache.get(symbol);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    analysisCache.delete(symbol);
    return null;
  }
  return entry.data;
}

function setCache(symbol: string, data: FullStockAnalysis): void {
  analysisCache.set(symbol, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// ── Build StockData ──
function buildStockData(
  holding: Holding,
  technicals: TechnicalData,
  fundamentals: FundamentalData,
  news: string[],
): StockData {
  return {
    symbol: holding.symbol,
    name: holding.name,
    currentPrice: holding.currentPrice,
    avgPrice: holding.avgPrice,
    pnlPercent: holding.pnlPercent,
    technicals,
    fundamentals,
    recentNews: news,
  };
}

// ── Detect Risk Flags ──
function detectRiskFlags(
  holding: Holding,
  fundamentals: FundamentalData,
  totalPortfolioValue?: number,
): RiskFlags {
  const flags: RiskFlags = {};

  if (holding.pnlPercent < -30) flags.deepLoss = true;
  if (fundamentals.debtToEquity > 2) flags.highVolatility = true;

  if (totalPortfolioValue) {
    const holdingValue = holding.quantity * holding.currentPrice;
    if (holdingValue / totalPortfolioValue > 0.2) flags.highConcentration = true;
  }

  return flags;
}

// ── Analyze Single Stock ──
export async function analyzeStock(
  symbol: string,
  holding: Holding,
  technicals: TechnicalData,
  fundamentals: FundamentalData,
  news: string[],
): Promise<FullStockAnalysis> {
  // Check cache
  const cached = getCached(symbol);
  if (cached) return cached;

  const stockData = buildStockData(holding, technicals, fundamentals, news);

  // Step 1: Run all personas in parallel
  const personaVerdicts = await runAllPersonas(stockData);

  // Step 2: Run bull vs bear debate
  const debateResult = await runDebate(stockData, personaVerdicts);

  // Step 3: CIO makes final decision
  const riskFlags = detectRiskFlags(holding, fundamentals);
  const decision = await makeDecision(stockData, personaVerdicts, debateResult, riskFlags);

  const analysis: FullStockAnalysis = {
    symbol,
    name: holding.name,
    stockData,
    personaVerdicts,
    debateResult,
    decision,
    analyzedAt: new Date(),
  };

  // Cache result
  setCache(symbol, analysis);

  return analysis;
}

// ── Batch helper ──
async function processBatch<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// ── Generate Weekly Action Plan ──
async function generateWeeklyPlan(analyses: FullStockAnalysis[]): Promise<string> {
  const summary = analyses
    .map(
      (a) =>
        `${a.symbol}: ${a.decision.decision} (${a.decision.confidence}%) — ${a.decision.reasoning}`,
    )
    .join('\n');

  const sells = analyses.filter((a) => ['SELL', 'EXIT'].includes(a.decision.decision));
  const buys = analyses.filter((a) => ['BUY', 'STRONG_BUY'].includes(a.decision.decision));
  const holds = analyses.filter((a) => a.decision.decision === 'HOLD');

  const systemPrompt = `You are a portfolio manager creating a weekly action plan for an Indian equity investor. Be specific, actionable, and prioritize by urgency. Use plain language, no jargon. Format as a numbered list.`;

  const prompt = `Portfolio Summary (${analyses.length} stocks):
${summary}

EXIT/SELL candidates: ${sells.length} stocks
BUY/STRONG_BUY: ${buys.length} stocks
HOLD: ${holds.length} stocks

Create a prioritized weekly action plan. What to do first, what can wait. Include specific price levels where mentioned.`;

  const { response } = await callLlm(prompt, { model: MODEL, systemPrompt });
  return response as string;
}

// ── Analyze Full Portfolio ──
export async function analyzePortfolio(
  holdings: Holding[],
  technicalsMap: Record<string, TechnicalData>,
  fundamentalsMap: Record<string, FundamentalData>,
  newsMap: Record<string, string[]>,
): Promise<PortfolioAnalysis> {
  // Analyze stocks in batches of 3
  const analyses = await processBatch(holdings, BATCH_SIZE, async (holding) => {
    const technicals = technicalsMap[holding.symbol] || {
      rsi: 50,
      macd: 'neutral',
      maSignal: 'neutral',
      overallScore: 50,
    };
    const fundamentals = fundamentalsMap[holding.symbol] || {
      pe: 0,
      roe: 0,
      roce: 0,
      debtToEquity: 0,
      revenueGrowth: 0,
      overallScore: 50,
    };
    const news = newsMap[holding.symbol] || [];

    return analyzeStock(holding.symbol, holding, technicals, fundamentals, news);
  });

  // Generate weekly action plan
  const weeklyActionPlan = await generateWeeklyPlan(analyses);

  return {
    analyses,
    weeklyActionPlan,
    analyzedAt: new Date(),
    totalStocks: holdings.length,
  };
}
