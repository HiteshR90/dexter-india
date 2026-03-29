/**
 * Core NSE India data fetcher.
 *
 * Hits NSE India's unofficial JSON APIs for live quotes, historical data,
 * and index snapshots. Manages cookie sessions (NSE requires a prior visit
 * to www.nseindia.com to set session cookies before API calls succeed).
 *
 * Also resolves common BSE-listed symbols to their NSE equivalents.
 */

import { logger } from '../../utils/logger.js';

// ============================================================================
// Constants
// ============================================================================

const NSE_BASE = 'https://www.nseindia.com';
const NSE_API = `${NSE_BASE}/api`;

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  Referer: NSE_BASE,
  Connection: 'keep-alive',
};

/** In-memory cache TTLs (ms) */
const QUOTE_CACHE_TTL = 30_000; // 30 seconds for live quotes
const HISTORICAL_CACHE_TTL = 300_000; // 5 minutes for historical
const INDEX_CACHE_TTL = 60_000; // 1 minute for indices

// ============================================================================
// Cookie / Session management
// ============================================================================

let cachedCookies: string | null = null;
let cookieExpiresAt = 0;

/**
 * Fetch the NSE homepage to obtain session cookies.
 * Cookies are cached for 4 minutes (NSE sessions last ~5 min).
 */
async function refreshCookies(): Promise<string> {
  if (cachedCookies && Date.now() < cookieExpiresAt) {
    return cachedCookies;
  }

  logger.debug('NSE: Refreshing session cookies');

  try {
    const res = await fetch(NSE_BASE, {
      headers: HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(8_000),
    });

    // Extract Set-Cookie headers
    const setCookieHeaders = res.headers.getSetCookie?.() ?? [];
    const cookies = setCookieHeaders
      .map((c: string) => c.split(';')[0])
      .join('; ');

    if (!cookies) {
      // Fallback: some runtimes expose cookies differently
      const rawCookie = res.headers.get('set-cookie') ?? '';
      cachedCookies = rawCookie
        .split(',')
        .map((c) => c.split(';')[0].trim())
        .filter(Boolean)
        .join('; ');
    } else {
      cachedCookies = cookies;
    }

    cookieExpiresAt = Date.now() + 4 * 60 * 1000; // 4 min
    logger.debug('NSE: Cookies obtained', { length: cachedCookies?.length });

    // Consume body to free resources
    await res.text();
    return cachedCookies || '';
  } catch (error) {
    logger.error('NSE: Failed to refresh cookies', error);
    return cachedCookies || '';
  }
}

// ============================================================================
// In-memory response cache
// ============================================================================

interface CacheItem<T> {
  data: T;
  expiresAt: number;
}

const responseCache = new Map<string, CacheItem<unknown>>();

function getCached<T>(key: string): T | null {
  const item = responseCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return item.data as T;
}

function setCache<T>(key: string, data: T, ttl: number): void {
  responseCache.set(key, { data, expiresAt: Date.now() + ttl });
  // Evict old entries periodically
  if (responseCache.size > 500) {
    const now = Date.now();
    Array.from(responseCache.entries()).forEach(([k, v]) => {
      if (now > v.expiresAt) responseCache.delete(k);
    });
  }
}

// ============================================================================
// Core fetch helper
// ============================================================================

async function nseFetch<T = unknown>(path: string, retries = 2): Promise<T> {
  const url = `${NSE_API}${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const cookies = await refreshCookies();
      const res = await fetch(url, {
        headers: {
          ...HEADERS,
          Cookie: cookies,
        },
        signal: AbortSignal.timeout(8_000),
      });

      if (res.status === 401 || res.status === 403) {
        logger.warn(`NSE: Auth error (${res.status}), clearing cookies`);
        cachedCookies = null;
        cookieExpiresAt = 0;
        if (attempt < retries) continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`NSE API ${res.status}: ${text.slice(0, 200)}`);
      }

      return (await res.json()) as T;
    } catch (error) {
      if (attempt === retries) throw error;
      logger.warn(`NSE: Retry ${attempt + 1}/${retries} for ${path}`);
      // Brief backoff
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  throw new Error(`NSE: All retries exhausted for ${path}`);
}

// ============================================================================
// BSE → NSE symbol mapping (common mismatches)
// ============================================================================

const BSE_TO_NSE: Record<string, string> = {
  RELIANCE: 'RELIANCE',
  TCS: 'TCS',
  INFY: 'INFY',
  HDFCBANK: 'HDFCBANK',
  ICICIBANK: 'ICICIBANK',
  HINDUNILVR: 'HINDUNILVR',
  SBIN: 'SBIN',
  BHARTIARTL: 'BHARTIARTL',
  ITC: 'ITC',
  KOTAKBANK: 'KOTAKBANK',
  LT: 'LT',
  AXISBANK: 'AXISBANK',
  WIPRO: 'WIPRO',
  HCLTECH: 'HCLTECH',
  ASIANPAINT: 'ASIANPAINT',
  MARUTI: 'MARUTI',
  TATAMOTORS: 'TATAMOTORS',
  SUNPHARMA: 'SUNPHARMA',
  TITAN: 'TITAN',
  BAJFINANCE: 'BAJFINANCE',
  NESTLEIND: 'NESTLEIND',
  ULTRACEMCO: 'ULTRACEMCO',
  TECHM: 'TECHM',
  POWERGRID: 'POWERGRID',
  NTPC: 'NTPC',
  TATASTEEL: 'TATASTEEL',
  JSWSTEEL: 'JSWSTEEL',
  ADANIENT: 'ADANIENT',
  ADANIPORTS: 'ADANIPORTS',
  COALINDIA: 'COALINDIA',
  ONGC: 'ONGC',
  DRREDDY: 'DRREDDY',
  CIPLA: 'CIPLA',
  EICHERMOT: 'EICHERMOT',
  BAJAJFINSV: 'BAJAJFINSV',
  DIVISLAB: 'DIVISLAB',
  GRASIM: 'GRASIM',
  BPCL: 'BPCL',
  HEROMOTOCO: 'HEROMOTOCO',
  BRITANNIA: 'BRITANNIA',
};

/**
 * Resolve a symbol to its NSE equivalent.
 * Strips .NS / .BO suffixes, uppercases, and checks mapping table.
 */
export function resolveNseSymbol(symbol: string): string {
  let clean = symbol
    .trim()
    .toUpperCase()
    .replace(/\.(NS|BO|NSE|BSE)$/i, '');

  return BSE_TO_NSE[clean] || clean;
}

// ============================================================================
// Public API functions
// ============================================================================

export interface NseQuote {
  symbol: string;
  companyName: string;
  lastPrice: number;
  open: number;
  high: number;
  low: number;
  close: number; // previous close
  change: number;
  pChange: number;
  volume: number;
  totalTradedValue: number;
  weekHigh52: number;
  weekLow52: number;
  marketCap?: number;
  pe?: number;
  sectorPe?: number;
  bookValue?: number;
  faceValue?: number;
  deliveryPercentage?: number;
  timestamp: string;
}

/**
 * Fetch live quote for an NSE-listed equity.
 */
export async function getNseQuote(rawSymbol: string): Promise<NseQuote> {
  const symbol = resolveNseSymbol(rawSymbol);
  const cacheKey = `quote:${symbol}`;
  const cached = getCached<NseQuote>(cacheKey);
  if (cached) return cached;

  logger.info(`NSE: Fetching quote for ${symbol}`);
  const data = await nseFetch<Record<string, unknown>>(
    `/quote-equity?symbol=${encodeURIComponent(symbol)}`
  );

  const info = (data.info as Record<string, unknown>) || {};
  const priceInfo = (data.priceInfo as Record<string, unknown>) || {};
  const secInfo = (data.securityInfo as Record<string, unknown>) || {};
  const metadata = (data.metadata as Record<string, unknown>) || {};
  const tradeInfo = (data.preOpenMarket as Record<string, unknown>) || {};

  const weekHL = (priceInfo.weekHighLow as Record<string, unknown>) || {};

  const quote: NseQuote = {
    symbol,
    companyName: (info.companyName as string) || (metadata.companyName as string) || symbol,
    lastPrice: Number(priceInfo.lastPrice) || 0,
    open: Number(priceInfo.open) || 0,
    high: Number(priceInfo.intraDayHighLow && (priceInfo.intraDayHighLow as Record<string, unknown>).max) || 0,
    low: Number(priceInfo.intraDayHighLow && (priceInfo.intraDayHighLow as Record<string, unknown>).min) || 0,
    close: Number(priceInfo.previousClose) || Number(priceInfo.close) || 0,
    change: Number(priceInfo.change) || 0,
    pChange: Number(priceInfo.pChange) || 0,
    volume: Number((data.securityWiseDP as Record<string, unknown>)?.quantityTraded) || 0,
    totalTradedValue: Number(priceInfo.totalTradedValue) || 0,
    weekHigh52: Number(weekHL.max) || 0,
    weekLow52: Number(weekHL.min) || 0,
    marketCap: Number(secInfo.issuedCap) || undefined,
    pe: Number(metadata.pdSymbolPe) || undefined,
    sectorPe: Number(metadata.pdSectorPe) || undefined,
    faceValue: Number(secInfo.faceValue) || undefined,
    timestamp: (priceInfo.lastUpdateTime as string) || new Date().toISOString(),
  };

  setCache(cacheKey, quote, QUOTE_CACHE_TTL);
  return quote;
}

export interface NseHistoricalEntry {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

/**
 * Fetch historical OHLCV data for an NSE equity.
 * @param from - DD-MM-YYYY format
 * @param to - DD-MM-YYYY format
 */
export async function getNseHistorical(
  rawSymbol: string,
  from: string,
  to: string
): Promise<NseHistoricalEntry[]> {
  const symbol = resolveNseSymbol(rawSymbol);
  const cacheKey = `hist:${symbol}:${from}:${to}`;
  const cached = getCached<NseHistoricalEntry[]>(cacheKey);
  if (cached) return cached;

  logger.info(`NSE: Fetching historical for ${symbol} from ${from} to ${to}`);

  // NSE limits to ~60-day windows. Split if needed.
  const entries: NseHistoricalEntry[] = [];
  const chunks = splitDateRange(from, to, 60);

  for (const [chunkFrom, chunkTo] of chunks) {
    const data = await nseFetch<Record<string, unknown>>(
      `/historical/cm/equity?symbol=${encodeURIComponent(symbol)}&from=${chunkFrom}&to=${chunkTo}`
    );

    const records = (data.data as Record<string, unknown>[]) || [];
    for (const rec of records) {
      entries.push({
        date: (rec.CH_TIMESTAMP as string) || (rec.mTIMESTAMP as string) || '',
        open: Number(rec.CH_OPENING_PRICE) || 0,
        high: Number(rec.CH_TRADE_HIGH_PRICE) || 0,
        low: Number(rec.CH_TRADE_LOW_PRICE) || 0,
        close: Number(rec.CH_CLOSING_PRICE) || 0,
        volume: Number(rec.CH_TOT_TRADED_QTY) || 0,
        turnover: Number(rec.CH_TOT_TRADED_VAL) || 0,
      });
    }
  }

  // Sort by date ascending
  entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  setCache(cacheKey, entries, HISTORICAL_CACHE_TTL);
  return entries;
}

export interface NiftyIndex {
  index: string;
  last: number;
  variation: number;
  percentChange: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  advances: number;
  declines: number;
  unchanged: number;
}

/**
 * Fetch all Nifty index snapshots.
 */
export async function getNiftyIndices(): Promise<NiftyIndex[]> {
  const cacheKey = 'indices:all';
  const cached = getCached<NiftyIndex[]>(cacheKey);
  if (cached) return cached;

  logger.info('NSE: Fetching all indices');
  const data = await nseFetch<Record<string, unknown>>('/allIndices');
  const rawIndices = (data.data as Record<string, unknown>[]) || [];

  const indices: NiftyIndex[] = rawIndices.map((idx) => ({
    index: String(idx.index || idx.indexSymbol || ''),
    last: Number(idx.last) || 0,
    variation: Number(idx.variation) || 0,
    percentChange: Number(idx.percentChange) || 0,
    open: Number(idx.open) || 0,
    high: Number(idx.high) || 0,
    low: Number(idx.low) || 0,
    previousClose: Number(idx.previousClose) || 0,
    advances: Number(idx.advances) || 0,
    declines: Number(idx.declines) || 0,
    unchanged: Number(idx.unchanged) || 0,
  }));

  setCache(cacheKey, indices, INDEX_CACHE_TTL);
  return indices;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse DD-MM-YYYY to a Date object.
 */
function parseDDMMYYYY(dateStr: string): Date {
  const [dd, mm, yyyy] = dateStr.split('-').map(Number);
  return new Date(yyyy, mm - 1, dd);
}

/**
 * Format a Date to DD-MM-YYYY.
 */
function formatDDMMYYYY(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Split a date range into chunks of maxDays each.
 * Returns array of [from, to] pairs in DD-MM-YYYY format.
 */
function splitDateRange(from: string, to: string, maxDays: number): [string, string][] {
  const startDate = parseDDMMYYYY(from);
  const endDate = parseDDMMYYYY(to);
  const chunks: [string, string][] = [];

  let current = new Date(startDate);
  while (current < endDate) {
    const chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + maxDays);
    if (chunkEnd > endDate) {
      chunkEnd.setTime(endDate.getTime());
    }
    chunks.push([formatDDMMYYYY(current), formatDDMMYYYY(chunkEnd)]);
    current = new Date(chunkEnd);
    current.setDate(current.getDate() + 1);
  }

  if (chunks.length === 0) {
    chunks.push([from, to]);
  }

  return chunks;
}

/**
 * Convert YYYY-MM-DD to DD-MM-YYYY (NSE format).
 */
export function toNseDate(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split('-');
  return `${dd}-${mm}-${yyyy}`;
}
