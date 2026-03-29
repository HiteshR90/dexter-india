/**
 * Hard Risk Overrides — code-enforced rules that CANNOT be overridden by AI.
 * These run AFTER AI makes recommendations and can force-change decisions.
 */

export interface RiskOverride {
  symbol: string;
  originalDecision: string;
  overriddenTo: string;
  rule: string;
  reason: string;
  severity: 'warning' | 'critical' | 'forced';
}

export interface PortfolioRiskReport {
  overrides: RiskOverride[];
  warnings: string[];
  criticalAlerts: string[];
  portfolioMetrics: {
    totalStocks: number;
    maxSingleWeight: number;
    maxSingleStock: string;
    maxSectorWeight: number;
    maxSector: string;
    tinyPositionCount: number;
    severeDrawdownCount: number;
    herfindahlIndex: number;
    diversificationScore: number; // 0-100
  };
}

export const HARD_RULES = {
  maxSingleStockWeight: 10,      // % — force trim recommendation if exceeded
  maxSectorWeight: 25,           // % — force diversify warning
  maxTotalStocks: 50,            // flag for consolidation if exceeded
  minPositionValue: 2000,        // ₹ — flag tiny positions for exit
  severeDrawdown: -50,           // % — auto-flag as SELL regardless of AI
  forceExitDrawdown: -70,        // % — FORCE EXIT, no debate allowed
  maxPortfolioStocks: 50,        // recommended max
};

export interface HoldingForRisk {
  symbol: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  value: number;
  portfolioWeight: number; // %
  sector: string;
}

/**
 * Apply hard risk overrides to AI decisions.
 * Returns overrides, warnings, and portfolio metrics.
 */
export function applyRiskOverrides(
  holdings: HoldingForRisk[],
  decisions: Record<string, string>,
  sectorMap?: Record<string, number>,
): PortfolioRiskReport {
  const overrides: RiskOverride[] = [];
  const warnings: string[] = [];
  const criticalAlerts: string[] = [];

  const totalValue = holdings.reduce((s, h) => s + h.value, 0);

  // Build sector weights if not provided
  const sectorWeights: Record<string, number> = {};
  if (sectorMap) {
    for (const [sec, val] of Object.entries(sectorMap)) {
      sectorWeights[sec] = totalValue > 0 ? (val / totalValue) * 100 : 0;
    }
  } else {
    for (const h of holdings) {
      const sec = h.sector || 'Unknown';
      sectorWeights[sec] = (sectorWeights[sec] || 0) + h.portfolioWeight;
    }
  }

  let tinyPositionCount = 0;
  let severeDrawdownCount = 0;

  for (const h of holdings) {
    const originalDecision = decisions[h.symbol] || 'HOLD';
    const drawdownPct = h.avgPrice > 0
      ? ((h.currentPrice - h.avgPrice) / h.avgPrice) * 100
      : 0;

    // Rule 1: Force exit on extreme drawdown (-70%+)
    if (drawdownPct <= HARD_RULES.forceExitDrawdown) {
      severeDrawdownCount++;
      overrides.push({
        symbol: h.symbol,
        originalDecision,
        overriddenTo: 'FORCE_EXIT',
        rule: 'forceExitDrawdown',
        reason: `${h.symbol} is down ${drawdownPct.toFixed(1)}% — beyond -70% threshold. FORCE EXIT, no debate.`,
        severity: 'forced',
      });
      criticalAlerts.push(
        `🚨 FORCE EXIT: ${h.symbol} down ${drawdownPct.toFixed(1)}% — catastrophic loss, must exit immediately`,
      );
      continue; // Skip other rules, this overrides everything
    }

    // Rule 2: Severe drawdown (-50%+) → SELL
    if (drawdownPct <= HARD_RULES.severeDrawdown) {
      severeDrawdownCount++;
      overrides.push({
        symbol: h.symbol,
        originalDecision,
        overriddenTo: 'SELL',
        rule: 'severeDrawdown',
        reason: `${h.symbol} is down ${drawdownPct.toFixed(1)}% — beyond -50% threshold. Auto-flagged as SELL.`,
        severity: 'critical',
      });
      criticalAlerts.push(
        `⚠️ SELL OVERRIDE: ${h.symbol} down ${drawdownPct.toFixed(1)}% — severe drawdown, overriding AI to SELL`,
      );
      continue;
    }

    // Rule 3: Overweight single stock (>10%)
    if (h.portfolioWeight > HARD_RULES.maxSingleStockWeight) {
      overrides.push({
        symbol: h.symbol,
        originalDecision,
        overriddenTo: 'TRIM',
        rule: 'maxSingleStockWeight',
        reason: `${h.symbol} is ${h.portfolioWeight.toFixed(1)}% of portfolio — exceeds ${HARD_RULES.maxSingleStockWeight}% limit. Trim to reduce concentration risk.`,
        severity: 'warning',
      });
      warnings.push(
        `${h.symbol} is ${h.portfolioWeight.toFixed(1)}% of portfolio — consider trimming to below ${HARD_RULES.maxSingleStockWeight}%`,
      );
    }

    // Rule 4: Tiny position (<₹2000)
    if (h.value < HARD_RULES.minPositionValue && h.value > 0) {
      tinyPositionCount++;
      overrides.push({
        symbol: h.symbol,
        originalDecision,
        overriddenTo: 'EXIT_TINY',
        rule: 'minPositionValue',
        reason: `${h.symbol} position value ₹${h.value.toFixed(0)} is below ₹${HARD_RULES.minPositionValue} minimum. Too small to matter — exit or consolidate.`,
        severity: 'warning',
      });
    }
  }

  // Rule 5: Sector concentration warnings
  let maxSectorWeight = 0;
  let maxSector = 'Unknown';
  for (const [sec, weight] of Object.entries(sectorWeights)) {
    if (weight > maxSectorWeight) {
      maxSectorWeight = weight;
      maxSector = sec;
    }
    if (weight > HARD_RULES.maxSectorWeight) {
      warnings.push(
        `Sector "${sec}" is ${weight.toFixed(1)}% of portfolio — exceeds ${HARD_RULES.maxSectorWeight}% limit. Diversify.`,
      );
    }
  }

  // Rule 6: Too many stocks
  if (holdings.length > HARD_RULES.maxTotalStocks) {
    warnings.push(
      `Portfolio has ${holdings.length} stocks — exceeds recommended max of ${HARD_RULES.maxTotalStocks}. Consider consolidating.`,
    );
  }

  // Compute Herfindahl-Hirschman Index (sum of squared weights)
  const herfindahlIndex = holdings.reduce(
    (sum, h) => sum + Math.pow(h.portfolioWeight / 100, 2),
    0,
  );

  // Diversification score: 0 = fully concentrated, 100 = perfectly diversified
  // HHI of 1 stock = 1.0, HHI of N equal stocks = 1/N
  // Score = (1 - HHI) * 100, capped at 0-100
  const n = holdings.length;
  const minHHI = n > 0 ? 1 / n : 1;
  const diversificationScore = n > 1
    ? Math.max(0, Math.min(100, ((1 - herfindahlIndex) / (1 - minHHI)) * 100))
    : 0;

  // Find max single stock weight
  let maxSingleWeight = 0;
  let maxSingleStock = '';
  for (const h of holdings) {
    if (h.portfolioWeight > maxSingleWeight) {
      maxSingleWeight = h.portfolioWeight;
      maxSingleStock = h.symbol;
    }
  }

  return {
    overrides,
    warnings,
    criticalAlerts,
    portfolioMetrics: {
      totalStocks: holdings.length,
      maxSingleWeight,
      maxSingleStock,
      maxSectorWeight,
      maxSector,
      tinyPositionCount,
      severeDrawdownCount,
      herfindahlIndex: Math.round(herfindahlIndex * 10000) / 10000,
      diversificationScore: Math.round(diversificationScore),
    },
  };
}
