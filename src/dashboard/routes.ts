import { parsePortfolioCsv, type Holding } from "../tools/portfolio/csv-parser";
import {
  saveHoldings,
  getHoldings,
  type StoredHolding,
} from "../tools/portfolio/portfolio-store";
import {
  getNseQuote,
  getNiftyIndices,
  type NseQuote,
  type NiftyIndex,
} from "../tools/india/nse-api";
import { fetchAllIndiaNews } from "../tools/india/india-news";
import { generateInsights, type PortfolioInsights } from "./insights";

// Cache for quotes (refresh every 30s)
let quotesCache: Map<string, NseQuote> = new Map();
let quotesCacheTime = 0;
const CACHE_TTL = 30_000;

async function fetchQuotes(symbols: string[]): Promise<Map<string, NseQuote>> {
  if (Date.now() - quotesCacheTime < CACHE_TTL && quotesCache.size > 0) {
    return quotesCache;
  }
  if (symbols.length === 0) return new Map();

  const results = new Map<string, NseQuote>();
  // Fetch in batches of 3 with delays to avoid NSE rate limiting
  // For large portfolios, only fetch top 50 symbols to avoid hammering NSE
  const toFetch = symbols.slice(0, 50);
  for (let i = 0; i < toFetch.length; i += 3) {
    const batch = toFetch.slice(i, i + 3);
    const promises = batch.map(async (s) => {
      try {
        const q = await getNseQuote(s);
        if (q) results.set(s, q);
      } catch { /* skip */ }
    });
    await Promise.allSettled(promises);
    if (i + 3 < toFetch.length) await new Promise((r) => setTimeout(r, 500));
  }

  quotesCache = results;
  quotesCacheTime = Date.now();
  return results;
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleUpload(req: Request): Promise<Response> {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return json({ error: "No file uploaded" }, 400);

    const text = await file.text();
    const result = parsePortfolioCsv(text);

    if (result.holdings.length === 0) {
      return json({ error: "No valid holdings found in CSV" }, 400);
    }

    const saved = await saveHoldings(result.holdings);
    return json({ success: true, count: saved.count, broker: result.broker });
  } catch (e: any) {
    return json({ error: e.message || "Upload failed" }, 500);
  }
}

export async function handlePortfolio(): Promise<Response> {
  try {
    const holdings = await getHoldings();
    const symbols = holdings.map((h) => h.symbol);

    // Try to fetch live quotes, but don't fail if NSE is unavailable
    let quotes = new Map<string, NseQuote>();
    try {
      quotes = await fetchQuotes(symbols);
    } catch {
      // NSE unavailable (weekend, rate limit, etc.) — continue with stored prices
    }

    // Use stored avgPrice * qty for invested, and live quote or CSV closing price for current
    const enriched = holdings.map((h) => {
      const q = quotes.get(h.symbol);
      // Use live NSE price if available, otherwise fall back to price stored from CSV
      const currentPrice = q?.lastPrice ?? h.lastPrice ?? 0;
      const value = currentPrice > 0 ? currentPrice * h.quantity : h.quantity * h.avgPrice;
      const invested = h.avgPrice * h.quantity;
      const pnl = value - invested;
      const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
      const dayChange = q?.change ?? 0;
      const dayChangePct = q?.pChange ?? 0;
      const hasLiveData = !!q;

      return {
        symbol: h.symbol,
        name: q?.companyName || h.name || h.symbol,
        quantity: h.quantity,
        avgPrice: h.avgPrice,
        currentPrice,
        value,
        invested,
        pnl,
        pnlPct,
        dayChange,
        dayChangePct,
        sector: h.sector || "Unknown",
        high: q?.high ?? 0,
        low: q?.low ?? 0,
        volume: q?.volume ?? 0,
        live: hasLiveData,
      };
    });

    const totalValue = enriched.reduce((s, h) => s + h.value, 0);
    const totalInvested = enriched.reduce((s, h) => s + h.invested, 0);
    const totalPnl = totalValue - totalInvested;
    const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
    const todayPnl = enriched.reduce((s, h) => s + h.dayChange * h.quantity, 0);

    return json({
      holdings: enriched,
      summary: {
        totalValue,
        totalInvested,
        totalPnl,
        totalPnlPct,
        todayPnl,
        todayPnlPct: totalValue > 0 ? (todayPnl / (totalValue - todayPnl)) * 100 : 0,
        stockCount: enriched.length,
      },
    });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
}

export async function handleAnalysis(): Promise<Response> {
  try {
    const holdings = await getHoldings();
    const symbols = holdings.map((h) => h.symbol);
    let quotes = new Map<string, NseQuote>();
    try {
      quotes = await fetchQuotes(symbols);
    } catch { /* continue with stored prices */ }

    const enriched = holdings.map((h) => {
      const q = quotes.get(h.symbol);
      const currentPrice = q?.lastPrice ?? h.lastPrice ?? 0;
      const value = currentPrice > 0 ? currentPrice * h.quantity : h.quantity * h.avgPrice;
      const invested = h.avgPrice * h.quantity;
      return {
        symbol: h.symbol,
        name: q?.companyName || h.name,
        sector: h.sector || "Unknown",
        value,
        invested,
        pnl: value - invested,
        pnlPct: invested > 0 ? ((value - invested) / invested) * 100 : 0,
        dayChangePct: q?.pChange ?? 0,
        weight: 0,
      };
    });

    const totalValue = enriched.reduce((s, h) => s + h.value, 0);
    enriched.forEach((h) => (h.weight = totalValue > 0 ? (h.value / totalValue) * 100 : 0));

    // Sector allocation
    const sectorMap: Record<string, number> = {};
    for (const h of enriched) {
      const sec = h.sector || "Unknown";
      sectorMap[sec] = (sectorMap[sec] || 0) + h.value;
    }
    const sectors = Object.entries(sectorMap)
      .map(([name, value]) => ({
        name,
        value,
        pct: totalValue > 0 ? (value / totalValue) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);

    // Top gainers & losers by day change
    const sorted = [...enriched].sort((a, b) => b.dayChangePct - a.dayChangePct);
    const topGainers = sorted.slice(0, 5);
    const topLosers = sorted.slice(-5).reverse();

    // Concentration
    const topByWeight = [...enriched].sort((a, b) => b.weight - a.weight);
    const top5Weight = topByWeight.slice(0, 5).reduce((s, h) => s + h.weight, 0);

    return json({
      sectors,
      topGainers,
      topLosers,
      concentration: {
        top5Weight,
        top5: topByWeight.slice(0, 5).map((h) => ({ symbol: h.symbol, weight: h.weight })),
        herfindahl: enriched.reduce((s, h) => s + (h.weight / 100) ** 2, 0),
      },
    });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
}

export async function handleMarket(): Promise<Response> {
  try {
    const allIndices = await getNiftyIndices();
    const wanted = ["NIFTY 50", "NIFTY BANK", "NIFTY IT"];
    const indices = wanted.map((name) => {
      const idx = allIndices.find((i) => i.index === name);
      return {
        name: name.replace("NIFTY ", "Nifty "),
        last: idx?.last ?? 0,
        change: idx?.variation ?? 0,
        pChange: idx?.percentChange ?? 0,
      };
    });
    return json({ indices });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
}

export async function handleInsights(): Promise<Response> {
  try {
    const holdings = await getHoldings();
    if (holdings.length === 0) return json({ error: "No holdings. Upload a CSV first." }, 400);

    const symbols = holdings.map((h) => h.symbol);
    let quotes = new Map<string, NseQuote>();
    try {
      quotes = await fetchQuotes(symbols);
    } catch { /* continue with stored prices */ }

    const insights = generateInsights(holdings, quotes);
    return json(insights);
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
}

export async function handleNews(): Promise<Response> {
  try {
    const holdings = await getHoldings();
    const symbols = holdings.map((h) => h.symbol);

    // Fetch real RSS news, then filter for portfolio stocks
    const allNews = await fetchAllIndiaNews(undefined, 50);

    // Try to match news to portfolio stocks
    const portfolioNews = allNews.filter((item) =>
      symbols.some(
        (s) =>
          item.title.toLowerCase().includes(s.toLowerCase()) ||
          (item.description?.toLowerCase().includes(s.toLowerCase()) ?? false),
      ),
    );

    // If not enough portfolio-specific news, pad with general market news
    const news = portfolioNews.length >= 5
      ? portfolioNews.slice(0, 20)
      : [...portfolioNews, ...allNews.filter((n) => !portfolioNews.includes(n))].slice(0, 20);

    return json({
      news: news.map((n) => ({
        title: n.title,
        link: n.link,
        source: n.source,
        date: n.pubDate,
        sentiment: "neutral",
      })),
    });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
}
