/**
 * Meta-tool for Indian market data.
 *
 * Routes natural language queries about Indian markets to the appropriate
 * sub-tools (stock prices, indices, news, mutual funds). Follows the same
 * pattern as src/tools/finance/get-market-data.ts.
 */

import { DynamicStructuredTool, StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AIMessage, ToolCall } from '@langchain/core/messages';
import { z } from 'zod';
import { callLlm } from '../../model/llm.js';
import { formatToolResult } from '../types.js';
import { getCurrentDate } from '../../agent/prompts.js';

// Import India market tools directly (avoid circular deps)
import { getIndiaStockPrice, getIndiaStockPrices, getIndiaIndices } from './india-stock-price.js';
import { getIndiaNews } from './india-news.js';
import { getMfNav, searchMf } from './india-mf.js';

// ============================================================================
// Description
// ============================================================================

export const GET_INDIA_MARKET_DATA_DESCRIPTION = `
Intelligent meta-tool for retrieving Indian market data. Takes a natural language query and automatically routes to appropriate Indian market data sources.

## When to Use

- Current Indian stock prices (NSE/BSE listed equities)
- Historical Indian stock prices over date ranges
- Nifty indices (NIFTY 50, BANK NIFTY, sector indices)
- Indian market news from top sources (Moneycontrol, ET, Livemint, NDTV Profit)
- Mutual fund NAV and scheme search
- Indian market overview and sector performance

## When NOT to Use

- US/global stock prices (use get_market_data instead)
- Cryptocurrency prices (use get_market_data instead)
- Company financials/SEC filings (use get_financials)
- General web searches (use web_search)

## Usage Notes

- Call ONCE with the complete natural language query
- Handles Indian ticker resolution (Reliance → RELIANCE, Infosys → INFY)
- Handles date inference (e.g., "last month", "past year", "YTD")
- Returns structured JSON data with source URLs
`.trim();

// ============================================================================
// Sub-tools available for routing
// ============================================================================

const INDIA_TOOLS: StructuredToolInterface[] = [
  getIndiaStockPrice,
  getIndiaStockPrices,
  getIndiaIndices,
  getIndiaNews,
  getMfNav,
  searchMf,
];

const INDIA_TOOL_MAP = new Map(INDIA_TOOLS.map((t) => [t.name, t]));

// ============================================================================
// Router prompt
// ============================================================================

function buildRouterPrompt(): string {
  return `You are an Indian market data routing assistant.
Current date: ${getCurrentDate()}

Given a user's natural language query about Indian markets, call the appropriate tool(s).

## Guidelines

1. **Ticker Resolution** (Indian stocks — use NSE symbols):
   - Reliance / RIL → RELIANCE
   - Infosys → INFY
   - TCS / Tata Consultancy → TCS
   - HDFC Bank → HDFCBANK
   - ICICI Bank → ICICIBANK
   - Hindustan Unilever / HUL → HINDUNILVR
   - State Bank / SBI → SBIN
   - Bharti Airtel / Airtel → BHARTIARTL
   - ITC → ITC
   - Kotak Bank / Kotak Mahindra → KOTAKBANK
   - L&T / Larsen → LT
   - Axis Bank → AXISBANK
   - Wipro → WIPRO
   - HCL Tech → HCLTECH
   - Asian Paints → ASIANPAINT
   - Maruti / Maruti Suzuki → MARUTI
   - Tata Motors → TATAMOTORS
   - Sun Pharma → SUNPHARMA
   - Titan → TITAN
   - Bajaj Finance → BAJFINANCE
   - Tata Steel → TATASTEEL
   - Adani Enterprises → ADANIENT
   - Adani Ports → ADANIPORTS
   - Dr Reddy's → DRREDDY
   - NTPC → NTPC
   - Power Grid → POWERGRID
   - Coal India → COALINDIA
   - ONGC → ONGC
   - Cipla → CIPLA

2. **Date Inference**: Convert relative dates to YYYY-MM-DD:
   - "last month" → start_date 1 month ago, end_date today
   - "past year" → start_date 1 year ago, end_date today
   - "YTD" → start_date Jan 1 of current year, end_date today
   - "2024" → start_date 2024-01-01, end_date 2024-12-31

3. **Tool Selection**:
   - Current stock price/quote → get_india_stock_price
   - Historical stock prices → get_india_stock_prices
   - Nifty/index values, market overview → get_india_indices
   - Market news, headlines, RBI, policy → get_india_news
   - Mutual fund NAV by scheme code → get_mf_nav
   - Search for mutual fund schemes → search_indian_mf
   - "Why did X go up/down" → get_india_stock_price + get_india_news
   - "How is the market doing" → get_india_indices + get_india_news

4. **Efficiency**:
   - For current price, use get_india_stock_price (not historical)
   - For comparisons, call get_india_stock_price for each ticker
   - Use smallest date range that answers the question

Call the appropriate tool(s) now.`;
}

// ============================================================================
// Helper
// ============================================================================

function formatSubToolName(name: string): string {
  return name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ============================================================================
// Tool: get_india_market_data
// ============================================================================

const GetIndiaMarketDataSchema = z.object({
  query: z
    .string()
    .describe(
      'Natural language query about Indian markets, stock prices, indices, news, or mutual funds'
    ),
});

export function createGetIndiaMarketData(model: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'get_india_market_data',
    description: `Intelligent meta-tool for Indian market data. Takes a natural language query and routes to appropriate Indian market tools. Use for:
- Current and historical Indian stock prices (NSE)
- Nifty indices and market overview
- Indian financial news
- Mutual fund NAV and scheme search`,
    schema: GetIndiaMarketDataSchema,
    func: async (input, _runManager, config?: RunnableConfig) => {
      const onProgress = config?.metadata?.onProgress as
        | ((msg: string) => void)
        | undefined;

      // 1. Call LLM with India tools bound
      onProgress?.('Fetching Indian market data...');
      const { response } = await callLlm(input.query, {
        model,
        systemPrompt: buildRouterPrompt(),
        tools: INDIA_TOOLS,
      });
      const aiMessage = response as AIMessage;

      // 2. Check for tool calls
      const toolCalls = aiMessage.tool_calls as ToolCall[];
      if (!toolCalls || toolCalls.length === 0) {
        return formatToolResult({ error: 'No tools selected for query' }, []);
      }

      // 3. Execute tool calls in parallel
      const toolNames = [
        ...new Set(toolCalls.map((tc) => formatSubToolName(tc.name))),
      ];
      onProgress?.(`Fetching from ${toolNames.join(', ')}...`);

      const results = await Promise.all(
        toolCalls.map(async (tc) => {
          try {
            const tool = INDIA_TOOL_MAP.get(tc.name);
            if (!tool) throw new Error(`Tool '${tc.name}' not found`);

            const rawResult = await tool.invoke(tc.args);
            const result =
              typeof rawResult === 'string'
                ? rawResult
                : JSON.stringify(rawResult);
            const parsed = JSON.parse(result);
            return {
              tool: tc.name,
              args: tc.args,
              data: parsed.data,
              sourceUrls: parsed.sourceUrls || [],
              error: null,
            };
          } catch (error) {
            return {
              tool: tc.name,
              args: tc.args,
              data: null,
              sourceUrls: [],
              error:
                error instanceof Error ? error.message : String(error),
            };
          }
        })
      );

      // 4. Combine results
      const successfulResults = results.filter((r) => r.error === null);
      const failedResults = results.filter((r) => r.error !== null);
      const allUrls = results.flatMap((r) => r.sourceUrls);

      const combinedData: Record<string, unknown> = {};
      for (const result of successfulResults) {
        const symbol =
          (result.args as Record<string, unknown>).symbol as
            | string
            | undefined;
        const key = symbol
          ? `${result.tool}_${symbol}`
          : result.tool;
        combinedData[key] = result.data;
      }

      if (failedResults.length > 0) {
        combinedData._errors = failedResults.map((r) => ({
          tool: r.tool,
          args: r.args,
          error: r.error,
        }));
      }

      return formatToolResult(combinedData, allUrls);
    },
  });
}
