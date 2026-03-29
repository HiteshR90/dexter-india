/**
 * Telegram portfolio report generator.
 * Generates formatted text reports for Telegram delivery.
 * Can be triggered via cron or API.
 */

import { getHoldings } from '../tools/portfolio/portfolio-store.js';
import { getNseQuote, getNiftyIndices } from '../tools/india/nse-api.js';
import { applyRiskOverrides } from '../agents/risk/hard-overrides.js';
import { computeTaxAnalysis } from '../agents/risk/tax-agent.js';

export interface TelegramReport {
  text: string;
  type: 'daily' | 'weekly';
  generatedAt: Date;
}

/**
 * Generate daily morning brief (no LLM, fast)
 */
export async function generateDailyReport(): Promise<TelegramReport> {
  const holdings = await getHoldings();
  if (holdings.length === 0) return { text: 'No holdings in portfolio.', type: 'daily', generatedAt: new Date() };

  // Fetch indices
  let indices: any[] = [];
  try {
    const all = await getNiftyIndices();
    indices = ['NIFTY 50', 'NIFTY BANK', 'NIFTY IT'].map(name => {
      const idx = all.find((i: any) => i.index === name);
      return { name, last: idx?.last ?? 0, change: idx?.percentChange ?? 0 };
    });
  } catch {}

  // Fetch quotes for top 20
  const top20 = holdings
    .sort((a, b) => (b.lastPrice * b.quantity) - (a.lastPrice * a.quantity))
    .slice(0, 20);
  
  const quotes = new Map<string, any>();
  for (const h of top20.slice(0, 10)) {
    try {
      const q = await getNseQuote(h.symbol);
      if (q) quotes.set(h.symbol, q);
    } catch {}
  }

  // Compute totals
  let totalValue = 0, totalInvested = 0, todayPnl = 0;
  for (const h of holdings) {
    const q = quotes.get(h.symbol);
    const price = q?.lastPrice ?? h.lastPrice;
    const value = price * h.quantity;
    const invested = h.avgPrice * h.quantity;
    totalValue += value;
    totalInvested += invested;
    if (q) todayPnl += q.change * h.quantity;
  }
  const totalPnl = totalValue - totalInvested;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  // Risk report
  const riskHoldings = holdings.map(h => {
    const price = quotes.get(h.symbol)?.lastPrice ?? h.lastPrice;
    const value = price * h.quantity;
    return {
      symbol: h.symbol, quantity: h.quantity, avgPrice: h.avgPrice,
      currentPrice: price, value, portfolioWeight: totalValue > 0 ? (value / totalValue) * 100 : 0,
      sector: h.sector || 'Unknown', pnlPercent: h.avgPrice > 0 ? ((price - h.avgPrice) / h.avgPrice) * 100 : 0,
    };
  });
  const riskReport = applyRiskOverrides(riskHoldings, {});

  // Top gainers/losers today
  const withDayChange = top20
    .map(h => ({ symbol: h.symbol, change: quotes.get(h.symbol)?.pChange ?? 0 }))
    .filter(h => h.change !== 0);
  const gainers = [...withDayChange].sort((a, b) => b.change - a.change).slice(0, 3);
  const losers = [...withDayChange].sort((a, b) => a.change - b.change).slice(0, 3);

  // Format
  const fmt = (n: number) => n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
  const fmtINR = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 10000000) return `${(n / 10000000).toFixed(2)} Cr`;
    if (abs >= 100000) return `${(n / 100000).toFixed(2)} L`;
    if (abs >= 1000) return `${(n / 1000).toFixed(1)} K`;
    return n.toFixed(0);
  };

  let text = `📊 Daily Portfolio Brief — ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}\n\n`;

  // Market
  if (indices.length > 0) {
    text += `📈 Market:\n`;
    for (const idx of indices) {
      text += `  ${idx.name}: ${idx.last.toLocaleString()} (${fmt(idx.change)}%)\n`;
    }
    text += `\n`;
  }

  // Portfolio
  text += `💼 Portfolio:\n`;
  text += `  Value: ₹${fmtINR(totalValue)}\n`;
  text += `  P&L: ₹${fmtINR(totalPnl)} (${fmt(totalPnlPct)}%)\n`;
  text += `  Today: ₹${fmtINR(todayPnl)}\n`;
  text += `  Stocks: ${holdings.length}\n\n`;

  // Top movers
  if (gainers.length > 0) {
    text += `🟢 Top Gainers:\n`;
    for (const g of gainers) text += `  ${g.symbol}: ${fmt(g.change)}%\n`;
    text += `\n`;
  }
  if (losers.length > 0) {
    text += `🔴 Top Losers:\n`;
    for (const l of losers) text += `  ${l.symbol}: ${fmt(l.change)}%\n`;
    text += `\n`;
  }

  // Risk alerts
  if (riskReport.criticalAlerts.length > 0) {
    text += `🚨 Risk Alerts:\n`;
    for (const a of riskReport.criticalAlerts) text += `  ${a}\n`;
    text += `\n`;
  }

  text += `Diversification: ${riskReport.portfolioMetrics.diversificationScore}/100`;

  return { text, type: 'daily', generatedAt: new Date() };
}

/**
 * Generate weekly deep report (includes AI analysis summary if available)
 */
export async function generateWeeklyReport(): Promise<TelegramReport> {
  const daily = await generateDailyReport();
  
  // Tax analysis
  const holdings = await getHoldings();
  const taxHoldings = holdings.map(h => ({
    symbol: h.symbol, quantity: h.quantity, avgPrice: h.avgPrice,
    currentPrice: h.lastPrice, pnl: (h.lastPrice - h.avgPrice) * h.quantity,
    buyDate: h.uploadedAt,
  }));
  const taxReport = computeTaxAnalysis(taxHoldings);

  let text = daily.text;
  text += `\n\n━━━━━━━━━━━━━━━━━━━━\n`;
  text += `💰 Tax Summary (Weekly):\n`;
  text += `  STCG stocks: ${taxReport.summary.stcgCount}\n`;
  text += `  LTCG stocks: ${taxReport.summary.ltcgCount}\n`;
  text += `  LTCG exemption left: ₹${(taxReport.summary.ltcgExemptionRemaining / 1000).toFixed(1)}K\n`;

  if (taxReport.summary.nearLTCGCount > 0) {
    text += `  ⏳ ${taxReport.summary.nearLTCGCount} stocks near LTCG — don't sell yet!\n`;
  }
  if (taxReport.summary.harvestCandidateCount > 0) {
    text += `  🌾 ${taxReport.summary.harvestCandidateCount} harvest candidates — save ₹${(taxReport.summary.potentialTaxSaving / 1000).toFixed(1)}K\n`;
  }

  for (const alert of taxReport.alerts) {
    text += `  ${alert}\n`;
  }

  return { text, type: 'weekly', generatedAt: new Date() };
}

// CLI entrypoint: bun run src/dashboard/telegram-report.ts daily|weekly
if (import.meta.main) {
  const mode = process.argv[2] || 'daily';
  const fn = mode === 'weekly' ? generateWeeklyReport : generateDailyReport;
  fn().then(report => {
    console.log(report.text);
    process.exit(0);
  }).catch(e => {
    console.error('Report generation failed:', e.message);
    process.exit(1);
  });
}
