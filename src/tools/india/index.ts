/**
 * Indian market data tools — exports and descriptions.
 */

// Stock prices & indices
export {
  getIndiaStockPrice,
  getIndiaStockPrices,
  getIndiaIndices,
  INDIA_STOCK_PRICE_DESCRIPTION,
  INDIA_STOCK_PRICES_DESCRIPTION,
  INDIA_INDICES_DESCRIPTION,
} from './india-stock-price.js';

// News
export { getIndiaNews, INDIA_NEWS_DESCRIPTION } from './india-news.js';

// Mutual funds
export { getMfNav, searchMf, INDIA_MF_DESCRIPTION } from './india-mf.js';

// Meta-tool (market data router)
export {
  createGetIndiaMarketData,
  GET_INDIA_MARKET_DATA_DESCRIPTION,
} from './india-market-data.js';

// Fundamental analysis (Screener.in scraper)
export {
  getStockFundamentals,
  fetchFundamentals,
  FUNDAMENTAL_ANALYSIS_DESCRIPTION,
} from './fundamentals.js';

// Technical analysis (indicators)
export {
  getStockTechnicals,
  computeTechnicals,
  TECHNICAL_ANALYSIS_DESCRIPTION,
} from './technical-indicators.js';

// NSE API utilities (for direct use if needed)
export { getNseQuote, getNseHistorical, getNiftyIndices, resolveNseSymbol, toNseDate } from './nse-api.js';
