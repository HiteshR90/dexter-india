/**
 * Portfolio LangChain tools for the Dexter financial agent.
 * Provides upload_portfolio, get_portfolio, and portfolio_summary tools.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { parsePortfolioCsv } from './csv-parser.js';
import { saveHoldings, getHoldings, saveSnapshot, getLatestSnapshot } from './portfolio-store.js';

export const uploadPortfolio = new DynamicStructuredTool({
  name: 'upload_portfolio',
  description:
    'Upload and parse a portfolio CSV file from Zerodha or Groww. Auto-detects the broker format from headers. ' +
    'Pass the full CSV content as a string. Holdings are saved to the local database.',
  schema: z.object({
    csvContent: z
      .string()
      .describe('The full CSV content string from a Zerodha or Groww portfolio export.'),
  }),
  func: async (input) => {
    try {
      const result = parsePortfolioCsv(input.csvContent);
      const { count } = await saveHoldings(result.holdings);

      // Save a snapshot with the current values from CSV
      const totalValue = result.holdings.reduce((sum, h) => sum + h.currentValue, 0);
      const totalPnl = result.holdings.reduce((sum, h) => sum + h.pnl, 0);
      await saveSnapshot(totalValue, totalPnl);

      return formatToolResult({
        success: true,
        broker: result.broker,
        holdingsCount: count,
        totalValue: Math.round(totalValue * 100) / 100,
        totalPnl: Math.round(totalPnl * 100) / 100,
        errors: result.errors.length > 0 ? result.errors : undefined,
        holdings: result.holdings.map((h) => ({
          symbol: h.symbol,
          name: h.name,
          quantity: h.quantity,
          avgPrice: h.avgPrice,
          currentValue: h.currentValue,
          pnl: h.pnl,
        })),
      });
    } catch (err) {
      return formatToolResult({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});

export const getPortfolio = new DynamicStructuredTool({
  name: 'get_portfolio',
  description:
    'Get the current portfolio holdings from the local database. ' +
    'Returns stored holdings with average prices and quantities. ' +
    'Live prices will be integrated with india-stock-price in the future.',
  schema: z.object({}),
  func: async () => {
    try {
      const holdings = await getHoldings();

      if (holdings.length === 0) {
        return formatToolResult({
          success: true,
          message: 'No portfolio uploaded yet. Use upload_portfolio to import a CSV from Zerodha or Groww.',
          holdings: [],
        });
      }

      return formatToolResult({
        success: true,
        holdingsCount: holdings.length,
        holdings: holdings.map((h) => ({
          symbol: h.symbol,
          name: h.name,
          quantity: h.quantity,
          avgPrice: h.avgPrice,
          sector: h.sector,
        })),
      });
    } catch (err) {
      return formatToolResult({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});

export const portfolioSummary = new DynamicStructuredTool({
  name: 'portfolio_summary',
  description:
    'Get a summary of the portfolio including total value, P&L, sector breakdown, and top holdings. ' +
    'Requires a portfolio to be uploaded first via upload_portfolio.',
  schema: z.object({}),
  func: async () => {
    try {
      const holdings = await getHoldings();

      if (holdings.length === 0) {
        return formatToolResult({
          success: true,
          message: 'No portfolio uploaded yet. Use upload_portfolio to import a CSV from Zerodha or Groww.',
        });
      }

      const latestSnapshot = await getLatestSnapshot();

      // Sector breakdown
      const sectorMap = new Map<string, { count: number; totalQty: number; symbols: string[] }>();
      for (const h of holdings) {
        const sector = h.sector || 'Unknown';
        const existing = sectorMap.get(sector) || { count: 0, totalQty: 0, symbols: [] };
        existing.count++;
        existing.totalQty += h.quantity;
        existing.symbols.push(h.symbol);
        sectorMap.set(sector, existing);
      }

      const sectorBreakdown = Array.from(sectorMap.entries()).map(([sector, data]) => ({
        sector,
        holdingsCount: data.count,
        symbols: data.symbols,
      }));

      // Top holdings by invested value (qty * avg price)
      const sortedByValue = [...holdings]
        .map((h) => ({
          symbol: h.symbol,
          name: h.name,
          quantity: h.quantity,
          investedValue: Math.round(h.quantity * h.avgPrice * 100) / 100,
        }))
        .sort((a, b) => b.investedValue - a.investedValue);

      const totalInvested = sortedByValue.reduce((sum, h) => sum + h.investedValue, 0);

      return formatToolResult({
        success: true,
        totalHoldings: holdings.length,
        totalInvestedValue: Math.round(totalInvested * 100) / 100,
        latestSnapshot: latestSnapshot
          ? {
              totalValue: latestSnapshot.totalValue,
              totalPnl: latestSnapshot.totalPnl,
              snapshotAt: latestSnapshot.snapshotAt,
            }
          : null,
        topHoldings: sortedByValue.slice(0, 10),
        sectorBreakdown,
      });
    } catch (err) {
      return formatToolResult({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});
