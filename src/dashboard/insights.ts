/**
 * Portfolio Insights Engine
 * Analyzes holdings and generates actionable BUY/HOLD/SELL signals
 * using rule-based heuristics + optional LLM analysis.
 */

import { type StoredHolding } from "../tools/portfolio/portfolio-store";
import { type NseQuote } from "../tools/india/nse-api";

// ============================================================================
// Types
// ============================================================================

export type Signal = "STRONG_SELL" | "SELL" | "HOLD" | "BUY" | "STRONG_BUY";

export interface StockInsight {
  symbol: string;
  name: string;
  signal: Signal;
  score: number; // -100 (strong sell) to +100 (strong buy)
  reasons: string[];
  metrics: {
    totalReturn: number;
    dayChange: number;
    portfolioWeight: number;
    distFrom52High: number;
    distFrom52Low: number;
    avgPrice: number;
    currentPrice: number;
    invested: number;
    currentValue: number;
    pnl: number;
  };
}

export interface PortfolioInsights {
  generatedAt: string;
  summary: {
    totalStocks: number;
    strongSell: number;
    sell: number;
    hold: number;
    buy: number;
    strongBuy: number;
    portfolioHealth: string;
    healthScore: number;
    keyActions: string[];
  };
  insights: StockInsight[];
  riskAlerts: string[];
  opportunities: string[];
}

// ============================================================================
// Scoring Rules
// ============================================================================

interface EnrichedHolding {
  symbol: string;
  name: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  invested: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  dayChange: number;
  dayChangePct: number;
  portfolioWeight: number;
  high52w: number;
  low52w: number;
  volume: number;
  isFreeHolding: boolean; // avg price = 0 (bonus/split)
}

function computeScore(h: EnrichedHolding): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // --- FREE HOLDINGS (bonus/corporate action, avg = 0) ---
  if (h.isFreeHolding) {
    score += 30;
    reasons.push("🎁 Free holding (bonus/split/corporate action) — no cost basis, pure profit");
  }

  // --- TOTAL RETURN ---
  if (h.pnlPct > 100) {
    score += 15;
    reasons.push(`📈 Exceptional return: ${h.pnlPct.toFixed(0)}% gain — consider booking partial profits`);
  } else if (h.pnlPct > 50) {
    score += 10;
    reasons.push(`📈 Strong return: ${h.pnlPct.toFixed(0)}% gain`);
  } else if (h.pnlPct > 20) {
    score += 5;
    reasons.push(`📈 Good return: ${h.pnlPct.toFixed(0)}% gain`);
  } else if (h.pnlPct > 0) {
    score += 2;
    reasons.push(`📊 Marginal gain: ${h.pnlPct.toFixed(1)}%`);
  } else if (h.pnlPct > -10) {
    score -= 5;
    reasons.push(`📉 Minor loss: ${h.pnlPct.toFixed(1)}%`);
  } else if (h.pnlPct > -30) {
    score -= 15;
    reasons.push(`📉 Significant loss: ${h.pnlPct.toFixed(0)}% — review if thesis intact`);
  } else if (h.pnlPct > -50) {
    score -= 25;
    reasons.push(`🔴 Heavy loss: ${h.pnlPct.toFixed(0)}% — strongly consider exiting unless turnaround thesis`);
  } else {
    score -= 35;
    reasons.push(`🚨 Severe loss: ${h.pnlPct.toFixed(0)}% — likely value trap, consider tax-loss harvesting`);
  }

  // --- DAY MOMENTUM ---
  if (h.dayChangePct < -5) {
    score -= 10;
    reasons.push(`⚡ Sharp fall today: ${h.dayChangePct.toFixed(1)}% — check for negative news`);
  } else if (h.dayChangePct < -3) {
    score -= 5;
    reasons.push(`📉 Falling today: ${h.dayChangePct.toFixed(1)}%`);
  } else if (h.dayChangePct > 5) {
    score += 5;
    reasons.push(`🚀 Strong rally today: +${h.dayChangePct.toFixed(1)}%`);
  }

  // --- 52-WEEK PROXIMITY ---
  if (h.high52w > 0 && h.currentPrice > 0) {
    const distFromHigh = ((h.high52w - h.currentPrice) / h.high52w) * 100;
    const distFromLow = h.low52w > 0 ? ((h.currentPrice - h.low52w) / h.low52w) * 100 : 0;

    if (distFromHigh < 5) {
      score += 10;
      reasons.push(`🏔️ Near 52-week high (${distFromHigh.toFixed(0)}% away) — momentum stock`);
    } else if (distFromHigh > 40) {
      score -= 10;
      reasons.push(`📉 ${distFromHigh.toFixed(0)}% below 52-week high — beaten down`);
    }

    if (distFromLow < 10 && distFromLow >= 0) {
      score -= 10;
      reasons.push(`⚠️ Near 52-week low — weak momentum, may fall further`);
    }
  }

  // --- CONCENTRATION RISK ---
  if (h.portfolioWeight > 15) {
    score -= 10;
    reasons.push(`⚠️ Very high concentration: ${h.portfolioWeight.toFixed(1)}% of portfolio — reduce for safety`);
  } else if (h.portfolioWeight > 10) {
    score -= 5;
    reasons.push(`⚠️ High concentration: ${h.portfolioWeight.toFixed(1)}% of portfolio`);
  }

  // --- POSITION SIZE ---
  if (h.invested > 0 && h.invested < 3000) {
    score -= 5;
    reasons.push(`💤 Tiny position (₹${h.invested.toFixed(0)} invested) — too small to matter, consider exiting`);
  }

  // --- MEGA GAIN with FREE HOLDING ---
  if (h.isFreeHolding && h.currentValue > 50000) {
    score += 15;
    reasons.push(`💎 Large free holding worth ₹${(h.currentValue / 1000).toFixed(0)}K — let it run`);
  }

  return { score, reasons };
}

function scoreToSignal(score: number): Signal {
  if (score >= 30) return "STRONG_BUY";
  if (score >= 10) return "BUY";
  if (score >= -10) return "HOLD";
  if (score >= -25) return "SELL";
  return "STRONG_SELL";
}

// ============================================================================
// Main Analysis
// ============================================================================

export function generateInsights(
  holdings: StoredHolding[],
  quotes: Map<string, NseQuote>,
): PortfolioInsights {
  // Compute totals
  const totalValue = holdings.reduce((sum, h) => {
    const q = quotes.get(h.symbol);
    const price = q?.lastPrice ?? h.lastPrice ?? 0;
    return sum + (price > 0 ? price * h.quantity : h.avgPrice * h.quantity);
  }, 0);

  // Enrich holdings
  const enriched: EnrichedHolding[] = holdings.map((h) => {
    const q = quotes.get(h.symbol);
    const currentPrice = q?.lastPrice ?? h.lastPrice ?? 0;
    const invested = h.avgPrice * h.quantity;
    const currentValue = currentPrice > 0 ? currentPrice * h.quantity : invested;
    const pnl = currentValue - invested;
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : (currentValue > 0 ? 100 : 0);

    return {
      symbol: h.symbol,
      name: h.name,
      quantity: h.quantity,
      avgPrice: h.avgPrice,
      currentPrice,
      invested,
      currentValue,
      pnl,
      pnlPct,
      dayChange: q?.change ?? 0,
      dayChangePct: q?.pChange ?? 0,
      portfolioWeight: totalValue > 0 ? (currentValue / totalValue) * 100 : 0,
      high52w: q?.weekHigh52 ?? 0,
      low52w: q?.weekLow52 ?? 0,
      volume: q?.volume ?? 0,
      isFreeHolding: h.avgPrice === 0 || h.avgPrice < 1,
    };
  });

  // Generate insights per stock
  const insights: StockInsight[] = enriched.map((h) => {
    const { score, reasons } = computeScore(h);
    const distFrom52High = h.high52w > 0 ? ((h.high52w - h.currentPrice) / h.high52w) * 100 : 0;
    const distFrom52Low = h.low52w > 0 ? ((h.currentPrice - h.low52w) / h.low52w) * 100 : 0;

    return {
      symbol: h.symbol,
      name: h.name,
      signal: scoreToSignal(score),
      score,
      reasons,
      metrics: {
        totalReturn: h.pnlPct,
        dayChange: h.dayChangePct,
        portfolioWeight: h.portfolioWeight,
        distFrom52High,
        distFrom52Low,
        avgPrice: h.avgPrice,
        currentPrice: h.currentPrice,
        invested: h.invested,
        currentValue: h.currentValue,
        pnl: h.pnl,
      },
    };
  });

  // Sort by score (worst first — most urgent action)
  insights.sort((a, b) => a.score - b.score);

  // Count signals
  const counts = { STRONG_SELL: 0, SELL: 0, HOLD: 0, BUY: 0, STRONG_BUY: 0 };
  insights.forEach((i) => counts[i.signal]++);

  // Risk alerts
  const riskAlerts: string[] = [];
  const topByWeight = [...enriched].sort((a, b) => b.portfolioWeight - a.portfolioWeight);
  const top5Weight = topByWeight.slice(0, 5).reduce((s, h) => s + h.portfolioWeight, 0);
  if (top5Weight > 50) {
    riskAlerts.push(`🔴 Top 5 stocks account for ${top5Weight.toFixed(0)}% of portfolio — very concentrated`);
  }

  const bigLosers = enriched.filter((h) => h.pnlPct < -40 && h.invested > 5000);
  if (bigLosers.length > 0) {
    riskAlerts.push(`🔴 ${bigLosers.length} stocks down >40% — review for value traps`);
  }

  const tinyPositions = enriched.filter((h) => h.currentValue < 3000 && h.currentValue > 0);
  if (tinyPositions.length > 10) {
    riskAlerts.push(`⚠️ ${tinyPositions.length} micro positions (<₹3K each) — housekeeping needed, too many small bets`);
  }

  if (enriched.length > 100) {
    riskAlerts.push(`⚠️ ${enriched.length} stocks is very high — hard to track, consider trimming to 30-50`);
  }

  // Opportunities
  const opportunities: string[] = [];
  const freeHoldings = enriched.filter((h) => h.isFreeHolding);
  if (freeHoldings.length > 0) {
    const freeValue = freeHoldings.reduce((s, h) => s + h.currentValue, 0);
    opportunities.push(`💎 ${freeHoldings.length} free holdings worth ₹${(freeValue / 100000).toFixed(1)}L — pure alpha`);
  }

  const beaten = enriched.filter((h) => h.pnlPct < -30 && h.invested > 10000);
  if (beaten.length > 0) {
    opportunities.push(`📊 ${beaten.length} stocks down >30% from your buy — check if fundamentals changed for averaging down`);
  }

  const multibaggars = enriched.filter((h) => h.pnlPct > 100);
  if (multibaggars.length > 0) {
    opportunities.push(`🚀 ${multibaggars.length} multibaggers (>100% gain) — consider booking 25-50% profits to lock in gains`);
  }

  // Key actions
  const keyActions: string[] = [];
  const sellCount = counts.STRONG_SELL + counts.SELL;
  if (sellCount > 0) {
    keyActions.push(`Exit ${sellCount} underperforming stocks to free up capital`);
  }
  if (tinyPositions.length > 10) {
    keyActions.push(`Clean up ${tinyPositions.length} tiny positions — merge or exit`);
  }
  if (multibaggars.length > 3) {
    keyActions.push(`Book partial profits in ${multibaggars.length} multibaggers`);
  }
  if (enriched.length > 80) {
    keyActions.push(`Consolidate portfolio from ${enriched.length} to 30-50 high-conviction picks`);
  }

  // Health score
  const avgReturn = enriched.reduce((s, h) => s + h.pnlPct, 0) / enriched.length;
  const profitableCount = enriched.filter((h) => h.pnl > 0).length;
  const profitableRatio = profitableCount / enriched.length;
  const healthScore = Math.round(
    Math.min(100, Math.max(0, 50 + avgReturn * 0.3 + profitableRatio * 30 - (enriched.length > 100 ? 10 : 0)))
  );

  let portfolioHealth: string;
  if (healthScore >= 75) portfolioHealth = "Excellent";
  else if (healthScore >= 60) portfolioHealth = "Good";
  else if (healthScore >= 45) portfolioHealth = "Average";
  else if (healthScore >= 30) portfolioHealth = "Below Average";
  else portfolioHealth = "Needs Attention";

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalStocks: enriched.length,
      strongSell: counts.STRONG_SELL,
      sell: counts.SELL,
      hold: counts.HOLD,
      buy: counts.BUY,
      strongBuy: counts.STRONG_BUY,
      portfolioHealth,
      healthScore,
      keyActions,
    },
    insights,
    riskAlerts,
    opportunities,
  };
}
