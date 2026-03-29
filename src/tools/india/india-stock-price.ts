/**
 * Indian stock price tools — LangChain DynamicStructuredTool wrappers
 * around the NSE API for live quotes and historical OHLCV data.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { getNseQuote, getNseHistorical, getNiftyIndices, toNseDate } from './nse-api.js';
import { formatToolResult } from '../types.js';

// ============================================================================
// Descriptions (injected into system prompt)
// ============================================================================

export const INDIA_STOCK_PRICE_DESCRIPTION = `
Fetches current Indian stock prices from NSE India, including LTP, open, high, low, close, volume, 52-week high/low, and P/E ratio. Supports all NSE-listed equities (RELIANCE, INFY, TCS, HDFCBANK, etc).
`.trim();

export const INDIA_STOCK_PRICES_DESCRIPTION = `
Fetches historical OHLCV price data for Indian stocks from NSE India over a specified date range.
`.trim();

export const INDIA_INDICES_DESCRIPTION = `
Fetches current Nifty index values including NIFTY 50, NIFTY BANK, NIFTY IT, sector indices, and broad market indices from NSE India.
`.trim();

// ============================================================================
// Tool: get_india_stock_price (live quote)
// ============================================================================

const IndiaStockPriceSchema = z.object({
  symbol: z
    .string()
    .describe(
      "NSE stock symbol (e.g. 'RELIANCE', 'INFY', 'TCS', 'HDFCBANK'). Do NOT include .NS or .BO suffix."
    ),
});

export const getIndiaStockPrice = new DynamicStructuredTool({
  name: 'get_india_stock_price',
  description:
    'Fetches the current stock price for an Indian equity on NSE, including LTP, open, high, low, previous close, volume, 52-week high/low, P/E ratio, and change percentage.',
  schema: IndiaStockPriceSchema,
  func: async (input) => {
    const symbol = input.symbol.trim().toUpperCase();
    try {
      const quote = await getNseQuote(symbol);
      const snapshot = {
        symbol: quote.symbol,
        companyName: quote.companyName,
        lastPrice: quote.lastPrice,
        open: quote.open,
        high: quote.high,
        low: quote.low,
        previousClose: quote.close,
        change: quote.change,
        changePercent: quote.pChange,
        volume: quote.volume,
        weekHigh52: quote.weekHigh52,
        weekLow52: quote.weekLow52,
        pe: quote.pe,
        sectorPe: quote.sectorPe,
        faceValue: quote.faceValue,
        timestamp: quote.timestamp,
        currency: 'INR',
        exchange: 'NSE',
      };
      return formatToolResult(snapshot, [
        `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`,
      ]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return formatToolResult({ error: msg, symbol }, []);
    }
  },
});

// ============================================================================
// Tool: get_india_stock_prices (historical OHLCV)
// ============================================================================

const IndiaStockPricesSchema = z.object({
  symbol: z
    .string()
    .describe("NSE stock symbol (e.g. 'RELIANCE', 'INFY', 'TCS')."),
  start_date: z
    .string()
    .describe('Start date in YYYY-MM-DD format. Required.'),
  end_date: z
    .string()
    .describe('End date in YYYY-MM-DD format. Required.'),
});

export const getIndiaStockPrices = new DynamicStructuredTool({
  name: 'get_india_stock_prices',
  description:
    'Retrieves historical OHLCV price data for an Indian stock on NSE over a date range. Returns daily open, high, low, close prices and volume.',
  schema: IndiaStockPricesSchema,
  func: async (input) => {
    const symbol = input.symbol.trim().toUpperCase();
    try {
      const from = toNseDate(input.start_date);
      const to = toNseDate(input.end_date);
      const history = await getNseHistorical(symbol, from, to);
      return formatToolResult(
        {
          symbol,
          count: history.length,
          prices: history,
          currency: 'INR',
          exchange: 'NSE',
        },
        [
          `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`,
        ]
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return formatToolResult({ error: msg, symbol }, []);
    }
  },
});

// ============================================================================
// Tool: get_india_indices (Nifty indices)
// ============================================================================

const IndiaIndicesSchema = z.object({
  filter: z
    .string()
    .optional()
    .describe(
      "Optional filter keyword to match index names (e.g. 'NIFTY 50', 'BANK', 'IT'). If omitted, returns all indices."
    ),
});

export const getIndiaIndices = new DynamicStructuredTool({
  name: 'get_india_indices',
  description:
    'Fetches current values for NSE indices (NIFTY 50, NIFTY BANK, NIFTY IT, sector indices, etc). Optionally filter by keyword.',
  schema: IndiaIndicesSchema,
  func: async (input) => {
    try {
      let indices = await getNiftyIndices();
      if (input.filter) {
        const kw = input.filter.toUpperCase();
        indices = indices.filter((i) => i.index.toUpperCase().includes(kw));
      }
      return formatToolResult(
        {
          count: indices.length,
          indices,
        },
        ['https://www.nseindia.com/market-data/live-equity-market']
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return formatToolResult({ error: msg }, []);
    }
  },
});
