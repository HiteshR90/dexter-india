/**
 * Indian mutual fund NAV tools using mfapi.in (free, no auth required).
 *
 * - getMfNav: Get current and historical NAV for a scheme by code
 * - searchMf: Search mutual fund schemes by name
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Description
// ============================================================================

export const INDIA_MF_DESCRIPTION = `
Indian mutual fund tools: get current/historical NAV by scheme code, or search for mutual fund schemes by name. Uses mfapi.in (covers all AMFI-registered funds).

Common scheme codes: SBI Bluechip (119598), HDFC Top 100 (100042), Axis Bluechip (120503), Mirae Asset Large Cap (118834), Parag Parikh Flexi Cap (122639).
`.trim();

// ============================================================================
// API Base
// ============================================================================

const MF_API_BASE = 'https://api.mfapi.in/mf';

// ============================================================================
// In-memory cache
// ============================================================================

const mfCache = new Map<string, { data: unknown; expiresAt: number }>();
const NAV_CACHE_TTL = 60_000; // 1 min for current NAV
const SEARCH_CACHE_TTL = 300_000; // 5 min for search results

function getCached<T>(key: string): T | null {
  const item = mfCache.get(key);
  if (!item || Date.now() > item.expiresAt) {
    if (item) mfCache.delete(key);
    return null;
  }
  return item.data as T;
}

function setMfCache(key: string, data: unknown, ttl: number): void {
  mfCache.set(key, { data, expiresAt: Date.now() + ttl });
}

// ============================================================================
// Core fetch helper
// ============================================================================

async function mfApiFetch<T = unknown>(path: string): Promise<T> {
  const url = `${MF_API_BASE}${path}`;
  logger.debug(`MF API: Fetching ${url}`);

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'DexterFinanceBot/1.0',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MF API ${res.status}: ${text.slice(0, 200)}`);
  }

  return (await res.json()) as T;
}

// ============================================================================
// Tool: get_mf_nav
// ============================================================================

interface MfNavResponse {
  meta: {
    fund_house: string;
    scheme_type: string;
    scheme_category: string;
    scheme_code: number;
    scheme_name: string;
  };
  data: Array<{ date: string; nav: string }>;
  status: string;
}

const MfNavSchema = z.object({
  scheme_code: z
    .string()
    .describe(
      "AMFI scheme code (numeric string, e.g. '119598' for SBI Bluechip Fund). Use search_indian_mf to find the code."
    ),
  history_days: z
    .number()
    .default(30)
    .describe('Number of recent days of NAV history to return. Defaults to 30. Set to 1 for current NAV only.'),
});

export const getMfNav = new DynamicStructuredTool({
  name: 'get_mf_nav',
  description:
    'Fetches current and historical NAV (Net Asset Value) for an Indian mutual fund scheme by AMFI scheme code. Returns fund details and daily NAV data.',
  schema: MfNavSchema,
  func: async (input) => {
    const code = input.scheme_code.trim();
    const cacheKey = `nav:${code}`;

    try {
      let data = getCached<MfNavResponse>(cacheKey);
      if (!data) {
        data = await mfApiFetch<MfNavResponse>(`/${code}`);
        setMfCache(cacheKey, data, NAV_CACHE_TTL);
      }

      if (data.status === 'ERROR' || !data.meta) {
        return formatToolResult(
          { error: `Scheme ${code} not found. Use search_indian_mf to find valid scheme codes.` },
          []
        );
      }

      // Limit history
      const navHistory = (data.data || []).slice(0, input.history_days);
      const currentNav = navHistory.length > 0 ? navHistory[0] : null;

      // Calculate basic returns if we have enough data
      const returns: Record<string, number | null> = {};
      if (navHistory.length > 1) {
        const latestNav = parseFloat(navHistory[0].nav);
        const findNavDaysAgo = (days: number) => {
          const entry = navHistory.find((_, i) => i >= days - 2 && i <= days + 2);
          return entry ? parseFloat(entry.nav) : null;
        };

        const nav7d = findNavDaysAgo(7);
        const nav30d = findNavDaysAgo(30);
        if (nav7d) returns['1w'] = Number((((latestNav - nav7d) / nav7d) * 100).toFixed(2));
        if (nav30d) returns['1m'] = Number((((latestNav - nav30d) / nav30d) * 100).toFixed(2));
      }

      return formatToolResult(
        {
          scheme_code: code,
          fund_house: data.meta.fund_house,
          scheme_name: data.meta.scheme_name,
          scheme_type: data.meta.scheme_type,
          scheme_category: data.meta.scheme_category,
          current_nav: currentNav ? parseFloat(currentNav.nav) : null,
          nav_date: currentNav?.date || null,
          returns_percent: returns,
          nav_history: navHistory.map((d) => ({
            date: d.date,
            nav: parseFloat(d.nav),
          })),
          currency: 'INR',
        },
        [`https://www.amfiindia.com/net-asset-value/mutual-fund-scheme?SchemeCode=${code}`]
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return formatToolResult({ error: msg, scheme_code: code }, []);
    }
  },
});

// ============================================================================
// Tool: search_indian_mf
// ============================================================================

interface MfSearchResult {
  schemeCode: number;
  schemeName: string;
}

const SearchMfSchema = z.object({
  query: z
    .string()
    .describe(
      "Search query for mutual fund name (e.g. 'SBI Bluechip', 'HDFC Flexi Cap', 'Axis Small Cap')."
    ),
  limit: z
    .number()
    .default(10)
    .describe('Maximum number of results. Defaults to 10.'),
});

export const searchMf = new DynamicStructuredTool({
  name: 'search_indian_mf',
  description:
    'Search for Indian mutual fund schemes by name. Returns scheme codes and names. Use the scheme code with get_mf_nav to fetch NAV data.',
  schema: SearchMfSchema,
  func: async (input) => {
    const query = input.query.trim();
    const cacheKey = `search:${query.toLowerCase()}`;

    try {
      let results = getCached<MfSearchResult[]>(cacheKey);
      if (!results) {
        results = await mfApiFetch<MfSearchResult[]>(
          `/search?q=${encodeURIComponent(query)}`
        );
        setMfCache(cacheKey, results, SEARCH_CACHE_TTL);
      }

      const limited = (results || []).slice(0, input.limit);

      return formatToolResult(
        {
          query,
          count: limited.length,
          schemes: limited.map((s) => ({
            scheme_code: s.schemeCode,
            scheme_name: s.schemeName,
          })),
        },
        ['https://www.amfiindia.com/mutual-fund-scheme']
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return formatToolResult({ error: msg, query }, []);
    }
  },
});
