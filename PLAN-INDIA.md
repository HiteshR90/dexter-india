# Dexter India — Indian Stock Market + Portfolio Dashboard

## Vision
Fork/extend Dexter to support Indian stock markets (NSE/BSE) with a web dashboard
for portfolio tracking. Users upload their holdings CSV (Zerodha/Groww) and get a
live dashboard with insights, news, sentiment, and P&L tracking.

## Phase 1: Indian Market Data Tools (src/tools/india/)

### 1.1 NSE/BSE Stock Price Tool (`india-stock-price.ts`)
- Use nsetools API or scrape NSE India for live quotes
- Endpoints: get_india_stock_price, get_india_stock_prices (historical)
- Support both NSE and BSE symbols
- Free, no API key needed

### 1.2 Indian Market News Tool (`india-news.ts`)
- RSS feeds: Moneycontrol, ET Markets, Livemint, NDTV Profit
- Tool: get_india_news(ticker?, category?)
- Parse feed with RSS parser (already in Bun ecosystem)

### 1.3 Indian Market Data Meta-Tool (`india-market-data.ts`)
- Same pattern as get-market-data.ts but routes to Indian tools
- Natural language: "What's RELIANCE price?" → india stock price tool
- Handles NSE/BSE symbol resolution

### 1.4 Mutual Fund NAV Tool (`india-mf.ts`)
- Use mfapi.in (free, no auth)
- get_mf_nav(scheme_code), search_mf(query)
- Historical NAV for return calculations

## Phase 2: Portfolio CSV Import (src/tools/portfolio/)

### 2.1 CSV Parser (`csv-parser.ts`)
- Zerodha format: Instrument, Qty, Avg. cost, LTP, Cur. val, P&L, Net chg., Day chg.
- Groww format: Symbol, Company Name, Quantity, Avg Price, Current Price, Current Value, P&L
- Auto-detect broker from CSV headers
- Store parsed holdings in SQLite (already using better-sqlite3)

### 2.2 Portfolio Tool (`portfolio-tool.ts`)
- upload_portfolio: Parse CSV, store holdings
- get_portfolio: Return current holdings with live prices
- portfolio_analysis: Sector allocation, concentration risk, P&L summary

## Phase 3: Web Dashboard (src/dashboard/)

### 3.1 Backend API Server (`server.ts`)
- Bun native HTTP server (no Express needed)
- REST endpoints:
  - POST /api/upload — CSV upload
  - GET /api/portfolio — Holdings with live prices
  - GET /api/portfolio/analysis — Sector allocation, P&L
  - GET /api/news — News for portfolio stocks
  - GET /api/market — Market indices (Nifty, Bank Nifty)
  - WS /ws — Real-time price updates

### 3.2 Frontend (`public/`)
- Single page HTML + vanilla JS (or lightweight React)
- Components:
  - Holdings table with live P&L (green/red)
  - Sector allocation pie chart
  - Today's P&L card
  - Total portfolio value card
  - News feed for portfolio stocks
  - Market indices bar (Nifty 50, Bank Nifty, Nifty IT)
  - Sentiment indicator per stock

### 3.3 Dashboard Features
- CSV drag-and-drop upload
- Auto-refresh prices every 30s during market hours
- Sort by P&L, value, sector
- Filter by stock/sector
- Mobile responsive

## Phase 4: Agent Integration

### 4.1 Register India Tools in Registry
- Add to src/tools/registry.ts alongside existing finance tools
- Conditional: enable when INDIA_MARKET=true in .env

### 4.2 Portfolio-Aware Agent
- Agent can answer: "How is my portfolio doing?"
- Agent uses portfolio data + news + sentiment for insights
- "Which of my stocks has the most risk?"
- "Rebalancing suggestions based on sector concentration"

## File Structure
```
src/
├── tools/
│   ├── india/                    # NEW — Indian market tools
│   │   ├── index.ts
│   │   ├── india-stock-price.ts  # NSE/BSE live + historical
│   │   ├── india-news.ts         # RSS feeds
│   │   ├── india-market-data.ts  # Meta-tool (router)
│   │   ├── india-mf.ts           # Mutual fund NAV
│   │   └── nse-api.ts            # NSE data fetcher
│   ├── portfolio/                # NEW — Portfolio management
│   │   ├── index.ts
│   │   ├── csv-parser.ts         # Zerodha + Groww CSV
│   │   ├── portfolio-store.ts    # SQLite persistence
│   │   └── portfolio-tool.ts     # Agent tool
│   └── registry.ts              # Updated with India tools
├── dashboard/                    # NEW — Web UI
│   ├── server.ts                 # Bun HTTP server
│   ├── routes.ts                 # API endpoints
│   └── public/
│       ├── index.html
│       ├── app.js
│       └── style.css
└── ...existing dexter files
```

## Tech Choices
- Bun native HTTP (no extra deps)
- SQLite via better-sqlite3 (already a dep)
- Chart.js for pie charts (CDN)
- NSE unofficial API / scraping for live data
- mfapi.in for mutual fund data
- RSS parsing for news

## Commands
```bash
# Start Dexter agent (terminal mode, includes India tools)
bun start

# Start dashboard server
bun run dashboard

# Start both
bun run dev:india
```

## .env additions
```
# Indian Market (enable India tools)
INDIA_MARKET=true
DASHBOARD_PORT=3000
```
