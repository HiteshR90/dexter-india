/**
 * Indian market news tool — fetches and parses RSS feeds from major
 * Indian financial news sources (Moneycontrol, ET Markets, Livemint, NDTV Profit).
 *
 * Uses regex-based XML parsing to avoid external dependencies.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Description
// ============================================================================

export const INDIA_NEWS_DESCRIPTION = `
Fetches latest Indian market and financial news from top sources: Moneycontrol, Economic Times Markets, Livemint, and NDTV Profit. Can filter by search query.
`.trim();

// ============================================================================
// RSS Feed Sources
// ============================================================================

interface RssFeed {
  name: string;
  url: string;
  category: string;
}

const RSS_FEEDS: RssFeed[] = [
  {
    name: 'Moneycontrol',
    url: 'https://www.moneycontrol.com/rss/marketreports.xml',
    category: 'markets',
  },
  {
    name: 'Moneycontrol Business',
    url: 'https://www.moneycontrol.com/rss/business.xml',
    category: 'business',
  },
  {
    name: 'ET Markets',
    url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
    category: 'markets',
  },
  {
    name: 'ET Stocks',
    url: 'https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms',
    category: 'stocks',
  },
  {
    name: 'Livemint Markets',
    url: 'https://www.livemint.com/rss/markets',
    category: 'markets',
  },
  {
    name: 'NDTV Profit',
    url: 'https://feeds.feedburner.com/ndtvprofit-latest',
    category: 'business',
  },
];

// ============================================================================
// RSS Parser (no external deps)
// ============================================================================

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  description?: string;
}

/**
 * Extract text content from an XML tag using regex.
 */
function extractTag(xml: string, tag: string): string {
  // Handle CDATA sections
  const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  // Standard tag extraction
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') : '';
}

/**
 * Parse RSS XML into NewsItem array.
 */
function parseRss(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];

  // Split by <item> tags
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = extractTag(itemXml, 'title');
    const link = extractTag(itemXml, 'link') || extractTag(itemXml, 'guid');
    const pubDate = extractTag(itemXml, 'pubDate');
    const description = extractTag(itemXml, 'description');

    if (title && link) {
      items.push({
        title: decodeHtmlEntities(title),
        link: link.trim(),
        pubDate: pubDate || '',
        source,
        description: description ? decodeHtmlEntities(description).slice(0, 200) : undefined,
      });
    }
  }

  return items;
}

/**
 * Decode common HTML entities.
 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, ''); // Strip remaining HTML tags
}

// ============================================================================
// In-memory cache for RSS feeds
// ============================================================================

const newsCache = new Map<string, { items: NewsItem[]; expiresAt: number }>();
const NEWS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Core fetch function
// ============================================================================

async function fetchFeed(feed: RssFeed): Promise<NewsItem[]> {
  const cached = newsCache.get(feed.url);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.items;
  }

  try {
    const res = await fetch(feed.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; DexterBot/1.0; +https://dexter.finance)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      logger.warn(`IndiaNews: Failed to fetch ${feed.name}: ${res.status}`);
      return [];
    }

    const xml = await res.text();
    const items = parseRss(xml, feed.name);

    newsCache.set(feed.url, { items, expiresAt: Date.now() + NEWS_CACHE_TTL });
    return items;
  } catch (error) {
    logger.warn(`IndiaNews: Error fetching ${feed.name}`, error);
    return [];
  }
}

/**
 * Public helper: fetch all news, optionally filtered by keyword.
 * Used by the dashboard routes without going through the LangChain tool.
 */
export async function fetchAllIndiaNews(
  query?: string,
  limit = 15,
): Promise<NewsItem[]> {
  const allItems: NewsItem[] = [];
  const results = await Promise.allSettled(RSS_FEEDS.map(fetchFeed));
  for (const r of results) {
    if (r.status === 'fulfilled') allItems.push(...r.value);
  }

  let filtered = allItems;
  if (query) {
    const q = query.toLowerCase();
    filtered = allItems.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.description?.toLowerCase().includes(q) ?? false),
    );
  }

  return filtered
    .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
    .slice(0, limit);
}

export type { NewsItem };

// ============================================================================
// Tool: get_india_news
// ============================================================================

const IndiaNewsSchema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      "Optional search query to filter news (e.g. 'Reliance', 'Nifty', 'RBI', 'IPO'). If omitted, returns latest headlines."
    ),
  source: z
    .enum(['all', 'moneycontrol', 'et', 'livemint', 'ndtv'])
    .default('all')
    .describe("Filter by news source. Defaults to 'all'."),
  limit: z
    .number()
    .default(15)
    .describe('Maximum number of news items to return. Defaults to 15.'),
});

export const getIndiaNews = new DynamicStructuredTool({
  name: 'get_india_news',
  description:
    'Fetches latest Indian market and financial news from Moneycontrol, Economic Times, Livemint, and NDTV Profit. Optionally filter by keyword or source.',
  schema: IndiaNewsSchema,
  func: async (input) => {
    try {
      // Filter feeds by source
      let feeds = RSS_FEEDS;
      if (input.source !== 'all') {
        const sourceMap: Record<string, string[]> = {
          moneycontrol: ['Moneycontrol', 'Moneycontrol Business'],
          et: ['ET Markets', 'ET Stocks'],
          livemint: ['Livemint Markets'],
          ndtv: ['NDTV Profit'],
        };
        const allowed = sourceMap[input.source] || [];
        feeds = feeds.filter((f) => allowed.includes(f.name));
      }

      // Fetch all feeds in parallel
      const feedResults = await Promise.all(feeds.map(fetchFeed));
      let allItems = feedResults.flat();

      // Filter by query if provided
      if (input.query) {
        const queryLower = input.query.toLowerCase();
        const queryWords = queryLower.split(/\s+/);
        allItems = allItems.filter((item) => {
          const text = `${item.title} ${item.description || ''}`.toLowerCase();
          return queryWords.some((word) => text.includes(word));
        });
      }

      // Sort by pubDate descending (newest first)
      allItems.sort((a, b) => {
        const dateA = a.pubDate ? new Date(a.pubDate).getTime() : 0;
        const dateB = b.pubDate ? new Date(b.pubDate).getTime() : 0;
        return dateB - dateA;
      });

      // Limit results
      const limited = allItems.slice(0, input.limit);

      // Collect source URLs
      const urls = limited.map((item) => item.link).filter(Boolean);

      return formatToolResult(
        {
          count: limited.length,
          query: input.query || null,
          news: limited.map((item) => ({
            title: item.title,
            link: item.link,
            pubDate: item.pubDate,
            source: item.source,
            snippet: item.description,
          })),
        },
        urls
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return formatToolResult({ error: msg }, []);
    }
  },
});
