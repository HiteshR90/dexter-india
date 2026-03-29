/**
 * Technical indicators engine for Indian stocks.
 * Pure TypeScript — no external TA-Lib dependency.
 * Computes RSI, MACD, Bollinger Bands, SMA, EMA, ATR, Volume Ratio.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { getNseHistorical, toNseDate } from './nse-api.js';
import { formatToolResult } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalAnalysis {
  symbol: string;
  date: string;
  rsi: number;
  rsiSignal: 'overbought' | 'oversold' | 'neutral';
  macd: { macd: number; signal: number; histogram: number; trend: 'bullish' | 'bearish' };
  bollinger: { upper: number; middle: number; lower: number; position: 'above' | 'middle' | 'below' };
  sma: { sma20: number; sma50: number; sma200: number };
  ema: { ema12: number; ema26: number };
  movingAverageSignal: 'golden_cross' | 'death_cross' | 'bullish' | 'bearish' | 'neutral';
  volumeRatio: number;
  volumeSignal: 'high' | 'normal' | 'low';
  atr: number;
  overallSignal: 'strong_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong_bearish';
  overallScore: number;
}

// ============================================================================
// Core indicator functions
// ============================================================================

/**
 * Simple Moving Average — average of the last `period` values.
 */
export function computeSMA(data: number[], period: number): number {
  if (data.length < period) return 0;
  const slice = data.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

/**
 * Exponential Moving Average — uses the entire array to build up the EMA,
 * returns the final value.
 */
export function computeEMA(data: number[], period: number): number {
  if (data.length < period) return 0;
  const k = 2 / (period + 1);
  // Seed with SMA of first `period` values
  let ema = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Full EMA series — returns an array of EMA values (same length as input,
 * first `period-1` entries are 0).
 */
function emaArray(data: number[], period: number): number[] {
  const result = new Array<number>(data.length).fill(0);
  if (data.length < period) return result;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  result[period - 1] = ema;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

/**
 * RSI (Relative Strength Index) — Wilder's smoothing method.
 */
export function computeRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50; // neutral fallback

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  // First avg gain / avg loss (simple average of first `period` changes)
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smooth with Wilder's method
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * MACD (12, 26, 9) — returns final MACD line, signal line, and histogram.
 */
export function computeMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
  if (closes.length < 35) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  const ema12 = emaArray(closes, 12);
  const ema26 = emaArray(closes, 26);

  // MACD line = EMA12 - EMA26 (valid from index 25 onward)
  const macdLine: number[] = [];
  for (let i = 25; i < closes.length; i++) {
    macdLine.push(ema12[i] - ema26[i]);
  }

  // Signal line = 9-period EMA of MACD line
  const signalArr = emaArray(macdLine, 9);

  const macdVal = macdLine[macdLine.length - 1];
  const signalVal = signalArr[signalArr.length - 1];
  const histogram = macdVal - signalVal;

  return {
    macd: round(macdVal),
    signal: round(signalVal),
    histogram: round(histogram),
  };
}

/**
 * Bollinger Bands (default 20-period, 2 standard deviations).
 */
export function computeBollinger(
  closes: number[],
  period: number = 20,
  stdDevMultiplier: number = 2
): { upper: number; middle: number; lower: number } {
  if (closes.length < period) {
    const last = closes[closes.length - 1] || 0;
    return { upper: last, middle: last, lower: last };
  }

  const slice = closes.slice(-period);
  const middle = slice.reduce((s, v) => s + v, 0) / period;

  const variance = slice.reduce((s, v) => s + (v - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: round(middle + stdDevMultiplier * stdDev),
    middle: round(middle),
    lower: round(middle - stdDevMultiplier * stdDev),
  };
}

/**
 * ATR (Average True Range) — Wilder's smoothing.
 */
export function computeATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number {
  const len = highs.length;
  if (len < period + 1) return 0;

  // True Range series
  const tr: number[] = [];
  for (let i = 1; i < len; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    tr.push(Math.max(hl, hc, lc));
  }

  // First ATR = simple average of first `period` TRs
  let atr = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;

  // Wilder's smoothing
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }

  return round(atr);
}

// ============================================================================
// Composite analysis
// ============================================================================

function round(n: number, decimals: number = 2): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * Compute all technical indicators from an array of daily OHLCV data.
 * Expects data sorted ascending by date (oldest first).
 * The `symbol` field must be supplied externally (defaults to 'UNKNOWN').
 */
export function computeTechnicals(data: OHLCV[], symbol: string = 'UNKNOWN'): TechnicalAnalysis {
  if (!data || data.length === 0) {
    throw new Error('No OHLCV data provided');
  }

  // Sort ascending just in case
  const sorted = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const closes = sorted.map((d) => d.close);
  const highs = sorted.map((d) => d.high);
  const lows = sorted.map((d) => d.low);
  const volumes = sorted.map((d) => d.volume);
  const lastClose = closes[closes.length - 1];
  const lastDate = sorted[sorted.length - 1].date;

  // --- RSI ---
  const rsi = round(computeRSI(closes, 14));
  const rsiSignal: TechnicalAnalysis['rsiSignal'] =
    rsi >= 70 ? 'overbought' : rsi <= 30 ? 'oversold' : 'neutral';

  // --- MACD ---
  const macdResult = computeMACD(closes);
  const macdTrend: 'bullish' | 'bearish' = macdResult.histogram >= 0 ? 'bullish' : 'bearish';

  // --- Bollinger Bands ---
  const bollinger = computeBollinger(closes, 20, 2);
  const bollingerPosition: TechnicalAnalysis['bollinger']['position'] =
    lastClose > bollinger.upper ? 'above' : lastClose < bollinger.lower ? 'below' : 'middle';

  // --- SMAs ---
  const sma20 = round(computeSMA(closes, 20));
  const sma50 = round(computeSMA(closes, 50));
  const sma200 = round(computeSMA(closes, 200));

  // --- EMAs ---
  const ema12 = round(computeEMA(closes, 12));
  const ema26 = round(computeEMA(closes, 26));

  // --- Moving Average Signal ---
  // Check for golden/death cross using SMA50 vs SMA200
  // We need the previous values to detect a *cross*
  let movingAverageSignal: TechnicalAnalysis['movingAverageSignal'] = 'neutral';
  if (closes.length >= 201) {
    const prevCloses = closes.slice(0, -1);
    const prevSma50 = computeSMA(prevCloses, 50);
    const prevSma200 = computeSMA(prevCloses, 200);

    if (prevSma50 <= prevSma200 && sma50 > sma200) {
      movingAverageSignal = 'golden_cross';
    } else if (prevSma50 >= prevSma200 && sma50 < sma200) {
      movingAverageSignal = 'death_cross';
    } else if (lastClose > sma50 && sma50 > sma200) {
      movingAverageSignal = 'bullish';
    } else if (lastClose < sma50 && sma50 < sma200) {
      movingAverageSignal = 'bearish';
    }
  } else if (closes.length >= 50) {
    if (lastClose > sma50) movingAverageSignal = 'bullish';
    else movingAverageSignal = 'bearish';
  }

  // --- Volume ---
  const avgVolume20 = computeSMA(volumes, 20);
  const lastVolume = volumes[volumes.length - 1];
  const volumeRatio = avgVolume20 > 0 ? round(lastVolume / avgVolume20, 2) : 1;
  const volumeSignal: TechnicalAnalysis['volumeSignal'] =
    volumeRatio >= 1.5 ? 'high' : volumeRatio <= 0.5 ? 'low' : 'normal';

  // --- ATR ---
  const atr = computeATR(highs, lows, closes, 14);

  // --- Overall Score (-100 to +100) ---
  let score = 0;

  // RSI: +/-20
  if (rsi <= 30) score += 20; // oversold = bullish opportunity
  else if (rsi >= 70) score -= 20; // overbought = bearish
  else if (rsi < 45) score += 10;
  else if (rsi > 55) score -= 10;

  // MACD: +/-20
  if (macdResult.histogram > 0) score += 20;
  else score -= 20;

  // Bollinger: +/-15
  if (bollingerPosition === 'below') score += 15; // near lower band = potential bounce
  else if (bollingerPosition === 'above') score -= 15; // near upper = potential pullback

  // MA alignment: +/-25
  if (sma200 > 0 && sma50 > 0) {
    if (lastClose > sma50 && sma50 > sma200) score += 25;
    else if (lastClose < sma50 && sma50 < sma200) score -= 25;
    else if (lastClose > sma200) score += 10;
    else score -= 10;
  }

  // Golden/death cross: +/-20
  if (movingAverageSignal === 'golden_cross') score += 20;
  else if (movingAverageSignal === 'death_cross') score -= 20;

  // Volume confirmation: +/-10
  if (volumeRatio >= 1.5) {
    // High volume amplifies the prevailing trend
    if (score > 0) score += 10;
    else if (score < 0) score -= 10;
  }

  // Clamp to [-100, 100]
  score = Math.max(-100, Math.min(100, score));

  // --- Overall signal ---
  let overallSignal: TechnicalAnalysis['overallSignal'];
  if (score >= 50) overallSignal = 'strong_bullish';
  else if (score >= 20) overallSignal = 'bullish';
  else if (score <= -50) overallSignal = 'strong_bearish';
  else if (score <= -20) overallSignal = 'bearish';
  else overallSignal = 'neutral';

  return {
    symbol,
    date: lastDate,
    rsi,
    rsiSignal,
    macd: { ...macdResult, trend: macdTrend },
    bollinger: { ...bollinger, position: bollingerPosition },
    sma: { sma20, sma50, sma200 },
    ema: { ema12, ema26 },
    movingAverageSignal,
    volumeRatio,
    volumeSignal,
    atr,
    overallSignal,
    overallScore: score,
  };
}

// ============================================================================
// LangChain Tool
// ============================================================================

export const TECHNICAL_ANALYSIS_DESCRIPTION = `
Computes technical analysis indicators for Indian stocks listed on NSE. Returns RSI, MACD, Bollinger Bands, SMA (20/50/200), EMA (12/26), ATR, volume analysis, and an overall bullish/bearish signal with a score from -100 to +100. Uses 200 days of historical price data.
`.trim();

const TechnicalAnalysisSchema = z.object({
  symbol: z
    .string()
    .describe(
      "NSE stock symbol (e.g. 'RELIANCE', 'INFY', 'TCS', 'HDFCBANK'). Do NOT include .NS or .BO suffix."
    ),
});

export const getStockTechnicals = new DynamicStructuredTool({
  name: 'get_stock_technicals',
  description:
    'Computes technical analysis indicators (RSI, MACD, Bollinger Bands, SMA, EMA, ATR, volume ratio) for an Indian stock on NSE. Returns an overall bullish/bearish signal with a score from -100 to +100.',
  schema: TechnicalAnalysisSchema,
  func: async (input) => {
    const symbol = input.symbol.trim().toUpperCase();
    try {
      // Fetch ~365 calendar days to get ~200 trading days
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 365);

      const fromStr = toNseDate(from.toISOString().slice(0, 10));
      const toStr = toNseDate(to.toISOString().slice(0, 10));

      const history = await getNseHistorical(symbol, fromStr, toStr);

      if (!history || history.length < 30) {
        return formatToolResult(
          { error: `Insufficient historical data for ${symbol}. Got ${history?.length || 0} records.` },
          []
        );
      }

      const ohlcvData: OHLCV[] = history.map((h) => ({
        date: h.date,
        open: h.open,
        high: h.high,
        low: h.low,
        close: h.close,
        volume: h.volume,
      }));

      const analysis = computeTechnicals(ohlcvData, symbol);

      return formatToolResult(analysis, [
        `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`,
      ]);
    } catch (err) {
      return formatToolResult(
        { error: `Failed to compute technicals for ${symbol}: ${(err as Error).message}` },
        []
      );
    }
  },
});
