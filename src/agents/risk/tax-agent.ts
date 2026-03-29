/**
 * India-specific Tax Agent for portfolio holdings.
 * Handles STCG/LTCG classification, tax estimation, and tax-loss harvesting.
 *
 * Indian equity tax rules (FY 2024-25 onwards):
 *   STCG (< 12 months): 20%
 *   LTCG (>= 12 months): 12.5%, with ₹1.25L annual exemption
 */

export interface TaxAnalysis {
  symbol: string;
  holdingPeriod: number; // days
  taxCategory: 'STCG' | 'LTCG' | 'UNKNOWN';
  daysToLTCG: number; // days until 12-month mark (0 if already LTCG)
  taxRate: number; // % (20 for STCG, 12.5 for LTCG)
  estimatedTax: number; // ₹ tax if sold now
  netPnlAfterTax: number; // ₹
  recommendation: string;
  isHarvestCandidate: boolean; // true if loss position that could be harvested
  harvestSaving: number; // ₹ potential tax saving from harvesting
}

export interface PortfolioTaxReport {
  holdings: TaxAnalysis[];
  summary: {
    totalSTCG: number;
    totalLTCG: number;
    stcgCount: number;
    ltcgCount: number;
    nearLTCGCount: number; // within 30 days of LTCG threshold
    totalEstimatedTax: number;
    harvestCandidateCount: number;
    potentialTaxSaving: number;
    ltcgExemptionUsed: number; // out of ₹1.25L
    ltcgExemptionRemaining: number;
  };
  alerts: string[];
}

export interface HoldingForTax {
  symbol: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  buyDate?: string; // ISO date string
  uploadedAt?: string; // fallback proxy for buy date
}

const LTCG_THRESHOLD_DAYS = 365; // 12 months
const STCG_RATE = 20; // %
const LTCG_RATE = 12.5; // %
const LTCG_EXEMPTION = 125000; // ₹1.25L annual exemption
const NEAR_LTCG_WINDOW = 30; // days

/**
 * Compute tax analysis for a single holding.
 */
export function computeSingleTax(holding: HoldingForTax): TaxAnalysis {
  const now = new Date();
  const buyDateStr = holding.buyDate || holding.uploadedAt;
  let holdingPeriod = 0;
  let taxCategory: 'STCG' | 'LTCG' | 'UNKNOWN' = 'UNKNOWN';
  let daysToLTCG = 0;

  if (buyDateStr) {
    const buyDate = new Date(buyDateStr);
    holdingPeriod = Math.floor(
      (now.getTime() - buyDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (holdingPeriod >= LTCG_THRESHOLD_DAYS) {
      taxCategory = 'LTCG';
      daysToLTCG = 0;
    } else {
      taxCategory = 'STCG';
      daysToLTCG = LTCG_THRESHOLD_DAYS - holdingPeriod;
    }
  }

  const pnl = holding.pnl;
  const taxRate = taxCategory === 'LTCG' ? LTCG_RATE : STCG_RATE;

  // Only positive PnL is taxed
  let estimatedTax = 0;
  if (pnl > 0) {
    estimatedTax = (pnl * taxRate) / 100;
  }
  const netPnlAfterTax = pnl - estimatedTax;

  // Tax-loss harvesting: if in loss, selling crystallizes the loss
  // which can offset gains, saving tax at the applicable rate
  const isHarvestCandidate = pnl < 0;
  const harvestSaving = isHarvestCandidate
    ? Math.abs(pnl) * (taxRate / 100) // saving = loss * tax rate
    : 0;

  // Recommendation
  let recommendation: string;
  if (taxCategory === 'UNKNOWN') {
    recommendation = 'Buy date unknown — cannot determine tax category';
  } else if (taxCategory === 'LTCG') {
    recommendation = pnl > 0
      ? 'LTCG eligible — 12.5% tax with ₹1.25L exemption'
      : 'LTCG — loss can offset other LTCG gains';
  } else if (daysToLTCG <= NEAR_LTCG_WINDOW && pnl > 0) {
    recommendation = `Wait ${daysToLTCG} days for LTCG — save ${((STCG_RATE - LTCG_RATE) / 100 * pnl).toFixed(0)} in tax`;
  } else if (isHarvestCandidate) {
    recommendation = `Tax-loss harvest candidate — could save ₹${harvestSaving.toFixed(0)} in taxes`;
  } else {
    recommendation = `STCG — ${daysToLTCG} days to LTCG eligibility`;
  }

  return {
    symbol: holding.symbol,
    holdingPeriod,
    taxCategory,
    daysToLTCG,
    taxRate,
    estimatedTax: Math.round(estimatedTax),
    netPnlAfterTax: Math.round(netPnlAfterTax),
    recommendation,
    isHarvestCandidate,
    harvestSaving: Math.round(harvestSaving),
  };
}

/**
 * Compute tax analysis for entire portfolio.
 */
export function computeTaxAnalysis(holdings: HoldingForTax[]): PortfolioTaxReport {
  const analyses = holdings.map(computeSingleTax);
  const alerts: string[] = [];

  let totalSTCG = 0;
  let totalLTCG = 0;
  let stcgCount = 0;
  let ltcgCount = 0;
  let nearLTCGCount = 0;
  let totalEstimatedTax = 0;
  let harvestCandidateCount = 0;
  let potentialTaxSaving = 0;
  let ltcgGains = 0; // track gross LTCG gains for exemption calc

  for (const a of analyses) {
    if (a.taxCategory === 'STCG') {
      stcgCount++;
      if (a.estimatedTax > 0) totalSTCG += a.estimatedTax;
    } else if (a.taxCategory === 'LTCG') {
      ltcgCount++;
      if (a.estimatedTax > 0) {
        totalLTCG += a.estimatedTax;
        // Track gross gains for exemption
        const holding = holdings.find((h) => h.symbol === a.symbol);
        if (holding && holding.pnl > 0) ltcgGains += holding.pnl;
      }
    }

    if (a.daysToLTCG > 0 && a.daysToLTCG <= NEAR_LTCG_WINDOW) {
      nearLTCGCount++;
    }

    totalEstimatedTax += a.estimatedTax;

    if (a.isHarvestCandidate) {
      harvestCandidateCount++;
      potentialTaxSaving += a.harvestSaving;
    }
  }

  // LTCG exemption calculation
  const ltcgExemptionUsed = Math.min(ltcgGains, LTCG_EXEMPTION);
  const ltcgExemptionRemaining = Math.max(0, LTCG_EXEMPTION - ltcgExemptionUsed);

  // Adjust LTCG tax for exemption
  const ltcgTaxSaved = (ltcgExemptionUsed * LTCG_RATE) / 100;
  totalLTCG = Math.max(0, totalLTCG - ltcgTaxSaved);
  totalEstimatedTax = Math.max(0, totalEstimatedTax - ltcgTaxSaved);

  // Generate alerts
  if (nearLTCGCount > 0) {
    alerts.push(
      `${nearLTCGCount} stock${nearLTCGCount > 1 ? 's' : ''} within 30 days of LTCG — don't sell yet!`,
    );
  }

  if (harvestCandidateCount > 0) {
    alerts.push(
      `${harvestCandidateCount} stock${harvestCandidateCount > 1 ? 's are' : ' is a'} tax-loss harvest candidate${harvestCandidateCount > 1 ? 's' : ''} — could save ₹${potentialTaxSaving.toLocaleString('en-IN')}`,
    );
  }

  if (ltcgExemptionRemaining > 0) {
    alerts.push(
      `₹${ltcgExemptionRemaining.toLocaleString('en-IN')} of LTCG exemption remaining this financial year`,
    );
  }

  if (ltcgExemptionRemaining === 0 && ltcgGains > LTCG_EXEMPTION) {
    alerts.push(
      `LTCG exemption of ₹1.25L fully utilized — all further LTCG gains taxed at 12.5%`,
    );
  }

  return {
    holdings: analyses,
    summary: {
      totalSTCG: Math.round(totalSTCG),
      totalLTCG: Math.round(totalLTCG),
      stcgCount,
      ltcgCount,
      nearLTCGCount,
      totalEstimatedTax: Math.round(totalEstimatedTax),
      harvestCandidateCount,
      potentialTaxSaving: Math.round(potentialTaxSaving),
      ltcgExemptionUsed: Math.round(ltcgExemptionUsed),
      ltcgExemptionRemaining: Math.round(ltcgExemptionRemaining),
    },
    alerts,
  };
}
