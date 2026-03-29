/**
 * Indian stock fundamental data scraper — scrapes Screener.in for key
 * financial metrics and computes a fundamental score (-100 to +100).
 *
 * Zero external deps: uses fetch() + regex parsing. Results cached 1 hour.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface ScoreEntry {
  metric: string;
  value: number;
  score: number;
  reason: string;
}

export interface FundamentalData {
  symbol: string;
  companyName: string;
  sector: string;
  marketCap: number;
  currentPrice: number;
  pe: number;
  pb: number;
  roe: number;
  roce: number;
  debtToEquity: number;
  dividendYield: number;
  revenueGrowth3Y: number;
  profitGrowth3Y: number;
  promoterHolding: number;
  promoterPledge: number;
  bookValue: number;
  faceValue: number;
  fundamentalScore: number;
  scoreBreakdown: ScoreEntry[];
}

// ============================================================================
// Cache (in-memory, 1-hour TTL)
// ============================================================================

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, { data: FundamentalData; ts: number }>();

function getCached(symbol: string): FundamentalData | null {
  const entry = cache.get(symbol);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data;
  if (entry) cache.delete(symbol);
  return null;
}

function setCache(symbol: string, data: FundamentalData): void {
  cache.set(symbol, { data, ts: Date.now() });
}

// ============================================================================
// HTML Fetcher
// ============================================================================

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function fetchScreenerHTML(symbol: string): Promise<string> {
  const url = `https://www.screener.in/company/${encodeURIComponent(symbol)}/consolidated/`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });

  // If consolidated not found, try standalone
  if (resp.status === 404 || resp.url.includes('/search/')) {
    const url2 = `https://www.screener.in/company/${encodeURIComponent(symbol)}/`;
    const resp2 = await fetch(url2, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    if (!resp2.ok) throw new Error(`Screener.in returned ${resp2.status} for ${symbol}`);
    return resp2.text();
  }

  if (!resp.ok) throw new Error(`Screener.in returned ${resp.status} for ${symbol}`);
  return resp.text();
}

// ============================================================================
// HTML Parsers (regex-based, zero deps)
// ============================================================================

/** Extract a number from HTML text, handling commas and % signs */
function parseNum(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/,/g, '').replace(/%/g, '').replace(/₹/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/** Extract value from top-ratios list by label text */
function extractRatio(html: string, label: string): number {
  // Pattern: <li>...<span class="name">Label</span>...<span class="number">Value</span>...</li>
  // Also handles <span class="name">Label</span> ... <span class="nowrap value"> or just <span class="number">
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    // Pattern 1: name span followed by number span (standard top-ratios)
    new RegExp(
      `<span[^>]*class="[^"]*name[^"]*"[^>]*>[^<]*${escapedLabel}[^<]*</span>[\\s\\S]*?<(?:span|b)[^>]*class="[^"]*(?:number|value)[^"]*"[^>]*>\\s*([\\d,.\\/%-]+)`,
      'i'
    ),
    // Pattern 2: name in a <li> with value nearby
    new RegExp(
      `${escapedLabel}[\\s\\S]*?<(?:span|b)[^>]*class="[^"]*(?:number|value|nowrap)[^"]*"[^>]*>\\s*([\\d,.\\/%-]+)`,
      'i'
    ),
    // Pattern 3: simple label: value in a list item
    new RegExp(
      `${escapedLabel}[:\\s]*<[^>]*>\\s*([\\d,.%-]+)`,
      'i'
    ),
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return parseNum(m[1]);
  }
  return 0;
}

/** Extract company name from page title or heading */
function extractCompanyName(html: string): string {
  // Try <h1>...</h1> first
  const h1 = html.match(/<h1[^>]*>([^<]+)</i);
  if (h1?.[1]) return h1[1].trim();
  // Try <title>
  const title = html.match(/<title[^>]*>([^<]+)/i);
  if (title?.[1]) {
    return title[1].replace(/- Screener.*$/i, '').replace(/\s*\|.*$/, '').trim();
  }
  return '';
}

/** Extract sector/industry */
function extractSector(html: string): string {
  // Screener shows sector in company info section
  const patterns = [
    /Sector[:\s]*<[^>]*>\s*<a[^>]*>([^<]+)/i,
    /Industry[:\s]*<[^>]*>\s*<a[^>]*>([^<]+)/i,
    /sector[^"]*"[^>]*>\s*<a[^>]*>([^<]+)/i,
    /company-info[^>]*>[\s\S]*?(?:Sector|Industry)[^<]*<[^>]*>([^<]+)/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return 'Unknown';
}

/** Extract promoter holding from shareholding section */
function extractPromoterHolding(html: string): number {
  // Look for "Promoters" row in shareholding table — take last value (most recent quarter)
  const patterns = [
    /Promoters[\s\S]*?<td[^>]*>\s*([\d.]+)\s*%?\s*<\/td>(?![\s\S]*?Promoters)/i,
    /Promoter[^s][\s\S]*?<td[^>]*>\s*([\d.]+)\s*%?\s*<\/td>/i,
  ];

  // Try to find all promoter row values and take the last one
  const rowMatch = html.match(/Promoters[\s\S]*?<\/tr>/i);
  if (rowMatch) {
    const cells = [...rowMatch[0].matchAll(/<td[^>]*>\s*([\d.]+)\s*%?\s*<\/td>/gi)];
    if (cells.length > 0) {
      const lastVal = cells[cells.length - 1][1];
      return parseNum(lastVal);
    }
  }

  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return parseNum(m[1]);
  }
  return 0;
}

/** Extract promoter pledge % */
function extractPromoterPledge(html: string): number {
  const patterns = [
    /[Pp]ledge[d]?\s*(?:of\s*)?(?:promoter\s*)?(?:holding)?[\s\S]*?<[^>]*>\s*([\d.]+)\s*%?/i,
    /[Pp]romoter.*?[Pp]ledge[\s\S]*?([\d.]+)\s*%/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return parseNum(m[1]);
  }
  return 0;
}

/** Extract growth numbers (Revenue / Profit CAGR) */
function extractGrowth(html: string, type: 'revenue' | 'profit'): number {
  const label = type === 'revenue' ? 'Compounded Sales Growth' : 'Compounded Profit Growth';
  // Look for the section and find "3 Years:" or "3 Years" value
  const sectionRe = new RegExp(`${label}[\\s\\S]*?(?=Compounded|Return on|$)`, 'i');
  const section = html.match(sectionRe);
  if (section) {
    const threeYr = section[0].match(/3\s*[Yy]ears?[:\s]*<[^>]*>\s*([-\d.]+)\s*%?/);
    if (threeYr?.[1]) return parseNum(threeYr[1]);
  }

  // Fallback: look for "10 Years / 5 Years / 3 Years / TTM" pattern
  const altLabel = type === 'revenue' ? 'Sales Growth' : 'Profit Growth';
  const altRe = new RegExp(`${altLabel}[\\s\\S]*?3\\s*[Yy]ears?[:\\s]*<[^>]*>\\s*([-\\d.]+)\\s*%?`, 'i');
  const altMatch = html.match(altRe);
  if (altMatch?.[1]) return parseNum(altMatch[1]);

  return 0;
}

// ============================================================================
// Scoring Engine
// ============================================================================

function computeScore(data: Omit<FundamentalData, 'fundamentalScore' | 'scoreBreakdown'>): {
  fundamentalScore: number;
  scoreBreakdown: ScoreEntry[];
} {
  const breakdown: ScoreEntry[] = [];

  const add = (metric: string, value: number, score: number, reason: string) => {
    breakdown.push({ metric, value, score, reason });
  };

  // PE
  if (data.pe > 0) {
    if (data.pe < 15) add('PE Ratio', data.pe, 15, 'Attractively valued (PE < 15)');
    else if (data.pe <= 25) add('PE Ratio', data.pe, 5, 'Fairly valued (PE 15-25)');
    else if (data.pe <= 40) add('PE Ratio', data.pe, -5, 'Slightly expensive (PE 25-40)');
    else add('PE Ratio', data.pe, -15, 'Expensive (PE > 40)');
  }

  // ROE
  if (data.roe > 20) add('ROE', data.roe, 15, 'Excellent return on equity (> 20%)');
  else if (data.roe >= 15) add('ROE', data.roe, 10, 'Good return on equity (15-20%)');
  else if (data.roe >= 10) add('ROE', data.roe, 5, 'Moderate return on equity (10-15%)');
  else add('ROE', data.roe, -10, 'Poor return on equity (< 10%)');

  // ROCE
  if (data.roce > 20) add('ROCE', data.roce, 15, 'Excellent capital efficiency (> 20%)');
  else if (data.roce >= 15) add('ROCE', data.roce, 10, 'Good capital efficiency (15-20%)');
  else if (data.roce < 10) add('ROCE', data.roce, -10, 'Poor capital efficiency (< 10%)');

  // Debt to Equity
  if (data.debtToEquity < 0.5) add('Debt/Equity', data.debtToEquity, 10, 'Low debt (D/E < 0.5)');
  else if (data.debtToEquity <= 1) add('Debt/Equity', data.debtToEquity, 5, 'Moderate debt (D/E 0.5-1)');
  else if (data.debtToEquity <= 2) add('Debt/Equity', data.debtToEquity, -5, 'High debt (D/E 1-2)');
  else add('Debt/Equity', data.debtToEquity, -15, 'Very high debt (D/E > 2)');

  // Promoter Holding
  if (data.promoterHolding > 60) add('Promoter Holding', data.promoterHolding, 10, 'High promoter confidence (> 60%)');
  else if (data.promoterHolding >= 40) add('Promoter Holding', data.promoterHolding, 5, 'Moderate promoter holding (40-60%)');
  else if (data.promoterHolding > 0) add('Promoter Holding', data.promoterHolding, -5, 'Low promoter holding (< 40%)');

  // Promoter Pledge
  if (data.promoterPledge > 20) add('Promoter Pledge', data.promoterPledge, -15, 'High pledge risk (> 20%)');
  else if (data.promoterPledge >= 10) add('Promoter Pledge', data.promoterPledge, -10, 'Moderate pledge risk (10-20%)');
  else add('Promoter Pledge', data.promoterPledge, 0, 'Low/no pledge (< 10%)');

  // Revenue Growth
  if (data.revenueGrowth3Y > 15) add('Revenue Growth 3Y', data.revenueGrowth3Y, 10, 'Strong revenue growth (> 15%)');
  else if (data.revenueGrowth3Y >= 5) add('Revenue Growth 3Y', data.revenueGrowth3Y, 5, 'Moderate revenue growth (5-15%)');
  else if (data.revenueGrowth3Y >= 0) add('Revenue Growth 3Y', data.revenueGrowth3Y, -5, 'Weak revenue growth (0-5%)');
  else add('Revenue Growth 3Y', data.revenueGrowth3Y, -10, 'Negative revenue growth');

  // Profit Growth
  if (data.profitGrowth3Y > 15) add('Profit Growth 3Y', data.profitGrowth3Y, 10, 'Strong profit growth (> 15%)');
  else if (data.profitGrowth3Y >= 5) add('Profit Growth 3Y', data.profitGrowth3Y, 5, 'Moderate profit growth (5-15%)');
  else if (data.profitGrowth3Y >= 0) add('Profit Growth 3Y', data.profitGrowth3Y, 0, 'Flat profit growth');
  else add('Profit Growth 3Y', data.profitGrowth3Y, -10, 'Negative profit growth');

  // Dividend Yield
  if (data.dividendYield > 3) add('Dividend Yield', data.dividendYield, 5, 'Good dividend yield (> 3%)');
  else if (data.dividendYield >= 1) add('Dividend Yield', data.dividendYield, 2, 'Moderate dividend yield (1-3%)');

  const fundamentalScore = Math.max(-100, Math.min(100, breakdown.reduce((s, e) => s + e.score, 0)));
  return { fundamentalScore, scoreBreakdown: breakdown };
}

// ============================================================================
// Main Scraper
// ============================================================================

export async function fetchFundamentals(symbol: string): Promise<FundamentalData> {
  const sym = symbol.trim().toUpperCase();

  // Check cache
  const cached = getCached(sym);
  if (cached) return cached;

  const html = await fetchScreenerHTML(sym);

  // Parse all metrics
  const companyName = extractCompanyName(html);
  const sector = extractSector(html);
  const marketCap = extractRatio(html, 'Market Cap');
  const currentPrice = extractRatio(html, 'Current Price');
  const pe = extractRatio(html, 'Stock P/E');
  const pb = extractRatio(html, 'Price to book value') || extractRatio(html, 'Book Value') > 0
    ? +(currentPrice / (extractRatio(html, 'Book Value') || 1)).toFixed(2)
    : 0;
  const roe = extractRatio(html, 'ROE') || extractRatio(html, 'Return on equity');
  const roce = extractRatio(html, 'ROCE') || extractRatio(html, 'Return on capital employed');
  const debtToEquity = extractRatio(html, 'Debt to equity') || extractRatio(html, 'Debt / Equity');
  const dividendYield = extractRatio(html, 'Dividend Yield') || extractRatio(html, 'Dividend yield');
  const bookValue = extractRatio(html, 'Book Value');
  const faceValue = extractRatio(html, 'Face Value');
  const promoterHolding = extractPromoterHolding(html);
  const promoterPledge = extractPromoterPledge(html);
  const revenueGrowth3Y = extractGrowth(html, 'revenue');
  const profitGrowth3Y = extractGrowth(html, 'profit');

  // Compute PB properly
  const pbRatio = extractRatio(html, 'Price to book value') || (bookValue > 0 ? +(currentPrice / bookValue).toFixed(2) : 0);

  const base = {
    symbol: sym,
    companyName,
    sector,
    marketCap,
    currentPrice,
    pe,
    pb: pbRatio,
    roe,
    roce,
    debtToEquity,
    dividendYield,
    revenueGrowth3Y,
    profitGrowth3Y,
    promoterHolding,
    promoterPledge,
    bookValue,
    faceValue,
  };

  const { fundamentalScore, scoreBreakdown } = computeScore(base);
  const result: FundamentalData = { ...base, fundamentalScore, scoreBreakdown };

  // Cache it
  setCache(sym, result);
  return result;
}

// ============================================================================
// Description (for system prompt injection)
// ============================================================================

export const FUNDAMENTAL_ANALYSIS_DESCRIPTION = `
Fetches fundamental financial data for any NSE-listed Indian stock from Screener.in. Returns key metrics including PE, PB, ROE, ROCE, Debt/Equity, Market Cap, Dividend Yield, Revenue & Profit Growth (3Y CAGR), Promoter Holding & Pledge, Book Value, Face Value, sector, and a computed fundamental score (-100 to +100). Use this for fundamental analysis of Indian equities.
`.trim();

// ============================================================================
// LangChain Tool
// ============================================================================

const FundamentalsSchema = z.object({
  symbol: z
    .string()
    .describe(
      "NSE stock symbol (e.g. 'RELIANCE', 'INFY', 'TCS', 'HDFCBANK'). Do NOT include .NS or .BO suffix."
    ),
});

export const getStockFundamentals = new DynamicStructuredTool({
  name: 'get_stock_fundamentals',
  description:
    'Fetches fundamental financial data for an Indian stock from Screener.in — PE, PB, ROE, ROCE, Debt/Equity, Market Cap, Promoter Holding, Revenue & Profit Growth, Dividend Yield, and a computed fundamental score (-100 to +100).',
  schema: FundamentalsSchema,
  func: async (input) => {
    const symbol = input.symbol.trim().toUpperCase();
    try {
      const data = await fetchFundamentals(symbol);
      const url = `https://www.screener.in/company/${encodeURIComponent(symbol)}/consolidated/`;

      // Build a readable summary alongside the raw data
      const summary = [
        `📊 ${data.companyName} (${data.symbol}) — Fundamental Analysis`,
        `Sector: ${data.sector}`,
        ``,
        `Market Cap: ₹${data.marketCap.toLocaleString('en-IN')} Cr | CMP: ₹${data.currentPrice}`,
        `PE: ${data.pe} | PB: ${data.pb} | Book Value: ₹${data.bookValue} | Face Value: ₹${data.faceValue}`,
        `ROE: ${data.roe}% | ROCE: ${data.roce}%`,
        `Debt/Equity: ${data.debtToEquity} | Dividend Yield: ${data.dividendYield}%`,
        `Revenue Growth (3Y): ${data.revenueGrowth3Y}% | Profit Growth (3Y): ${data.profitGrowth3Y}%`,
        `Promoter Holding: ${data.promoterHolding}% | Pledge: ${data.promoterPledge}%`,
        ``,
        `🎯 Fundamental Score: ${data.fundamentalScore}/100`,
        ...data.scoreBreakdown.map(
          (s) => `  ${s.score >= 0 ? '✅' : '⚠️'} ${s.metric}: ${s.value} → ${s.score > 0 ? '+' : ''}${s.score} (${s.reason})`
        ),
      ].join('\n');

      return formatToolResult({ ...data, summary }, [url]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return formatToolResult(
        { error: `Failed to fetch fundamentals for ${symbol}: ${msg}` },
        []
      );
    }
  },
});
