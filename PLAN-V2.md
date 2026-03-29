# Dexter India V2 — Multi-Agent AI Portfolio Intelligence

## Vision
Evolve Dexter India from rule-based scoring to a **multi-agent AI system** that
thinks like a real Indian trading firm. Each stock goes through analyst review,
bull vs bear debate, risk checks, and a final CIO decision — just like institutional
money managers operate.

### Inspired By
| Repo | Stars | What We Borrow |
|------|-------|----------------|
| **TradingAgents** (TauricResearch) | 9.3K | Analyst → Researcher debate → Risk → PM pipeline |
| **ai-hedge-fund** (virattt) | 49.6K | Famous investor personas (Jhunjhunwala!), backtesting |
| **QuantAgent** (Y-Research-SBU) | 1.7K | 4-agent technical analysis, chart vision |
| **NOFX** (NoFxAiOS) | 11.2K | Code-enforced risk overrides, decision logging, AI competition |
| **pmxt** (pmxt-dev) | 1.2K | Clean unified API design pattern |

---

## Current State (V1 — Done ✅)
- ✅ NSE/BSE live data (nse-api.ts)
- ✅ Portfolio CSV import (Zerodha + Groww + XLSX statement)
- ✅ Web dashboard (holdings, charts, news, market indices)
- ✅ Rule-based insights (score -100 to +100, health score)
- ✅ 160+ company-to-NSE-symbol mapping
- ✅ RSS news from 6 Indian sources
- ✅ Mutual fund NAV tools
- ✅ Registered in Dexter agent tool registry

### What's Missing
- ❌ No technical indicators (RSI, MACD, moving averages)
- ❌ No fundamental data (PE, ROE, debt ratios)
- ❌ No LLM-powered reasoning ("why should I sell this?")
- ❌ No multi-agent debate (bull vs bear)
- ❌ No Indian investor personas
- ❌ No risk controls that override AI
- ❌ No backtesting
- ❌ No sector auto-mapping
- ❌ No tax-aware recommendations (STCG vs LTCG)

---

## V2 Architecture

```
                    ┌─────────────────────────┐
                    │     USER PORTFOLIO      │
                    │  CSV / Kite API / Groww  │
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │    ORCHESTRATOR          │
                    │  (LangGraph state graph) │
                    └───────────┬─────────────┘
                                │
       ┌────────────────────────┼────────────────────────┐
       │                        │                        │
┌──────▼───────────┐  ┌────────▼─────────┐  ┌───────────▼──────────┐
│  ANALYST TEAM    │  │  INVESTOR PANEL  │  │  RISK TEAM           │
│                  │  │                  │  │                       │
│ Technical Agent  │  │ Jhunjhunwala     │  │ Risk Manager          │
│  RSI, MACD,     │  │  (growth, high   │  │  concentration,       │
│  Bollinger, MA,  │  │   conviction,    │  │  volatility,          │
│  volume analysis │  │   cyclicals)     │  │  correlation,         │
│                  │  │                  │  │  drawdown limits      │
│ Fundamental Agent│  │ Damani           │  │                       │
│  PE, ROE, ROCE, │  │  (value, long    │  │ Tax Agent             │
│  debt, margins,  │  │   term, quality  │  │  STCG vs LTCG,       │
│  growth trends   │  │   compounders)   │  │  holding period,      │
│                  │  │                  │  │  harvest losses,      │
│ Sentiment Agent  │  │ Contrarian       │  │  ₹1L LTCG exemption  │
│  news RSS,       │  │  (beaten down    │  │                       │
│  FII/DII flows,  │  │   stocks, mean   │  └───────────┬──────────┘
│  social mood     │  │   reversion)     │              │
│                  │  │                  │              │
│ Sector Agent     │  │ Momentum Rider   │              │
│  peer comparison,│  │  (52w high,      │              │
│  sector rotation,│  │   breakouts,     │              │
│  industry trends │  │   trend follow)  │              │
└──────┬───────────┘  └────────┬─────────┘              │
       │                       │                        │
       │              ┌────────▼─────────┐              │
       │              │  BULL vs BEAR    │              │
       │              │  DEBATE          │              │
       │              │                  │              │
       │              │ Bull argues FOR  │              │
       │              │ Bear argues FOR  │              │
       │              │ selling — 2-3    │              │
       │              │ rounds each      │              │
       │              │                  │              │
       │              │ Moderator picks  │              │
       │              │ winner + reasons │              │
       │              └────────┬─────────┘              │
       │                       │                        │
       └───────────────────────┼────────────────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │   DECISION AGENT (CIO)  │
                    │                         │
                    │  Inputs:                │
                    │  • 4 analyst reports     │
                    │  • 4 investor opinions   │
                    │  • Debate outcome        │
                    │  • Risk constraints      │
                    │  • Tax implications      │
                    │                         │
                    │  Output per stock:       │
                    │  → STRONG BUY / BUY /   │
                    │    HOLD / SELL / EXIT    │
                    │  → Target price          │
                    │  → Stop loss             │
                    │  → Position size         │
                    │  → Confidence (0-100)    │
                    │  → Full reasoning chain  │
                    └──────────┬──────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │   HARD RISK OVERRIDES   │
                    │   (Code-enforced, not AI)│
                    │                         │
                    │  These CANNOT be ignored:│
                    │  • Max 10% in one stock  │
                    │  • Max 25% in one sector │
                    │  • Loss > 50% = auto-flag│
                    │  • Position < ₹1K = exit │
                    │  • 163 stocks → force    │
                    │    consolidation plan    │
                    └──────────┬──────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │   PORTFOLIO MANAGER     │
                    │                         │
                    │  • Weekly action plan    │
                    │  • Priority ranked       │
                    │  • "Do today" list       │
                    │  • Rebalancing moves     │
                    │  • Capital allocation    │
                    └──────────┬──────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   ┌────────────┐      ┌────────────┐      ┌────────────┐
   │ Dashboard  │      │ Telegram   │      │ Dexter CLI │
   │ Web UI     │      │ Daily Rpt  │      │ "Analyze   │
   │            │      │            │      │  my stocks"│
   └────────────┘      └────────────┘      └────────────┘
```

---

## Phase 1: Technical Indicators Engine
**Effort: 1 day | No LLM cost | High impact**

Pure math — compute indicators from NSE historical data we already fetch.

### New: `src/tools/india/technical-indicators.ts`

| Indicator | Formula | Signal |
|-----------|---------|--------|
| RSI (14) | Relative Strength Index | >70 overbought, <30 oversold |
| MACD (12,26,9) | Moving Average Convergence Divergence | Signal line crossover |
| Bollinger Bands (20,2) | Price vs 2σ bands | Touch upper = overbought |
| SMA 20/50/200 | Simple Moving Averages | Golden cross / Death cross |
| EMA 12/26 | Exponential Moving Averages | Trend direction |
| Volume Ratio | Today vol / 20-day avg vol | Unusual activity detection |
| ATR (14) | Average True Range | Volatility measure |

### Data Flow
```
NSE Historical API (already built)
  → Fetch 200 days OHLCV per stock
  → Compute all indicators in TypeScript (no TA-Lib needed)
  → Cache in SQLite (refresh daily)
  → Expose via /api/technicals/:symbol
```

### Dashboard Integration
- New column in holdings table: "Technical" (🟢/🔴/🟡)
- Hover tooltip: RSI=45, MACD=Bullish, MA=Above 200 SMA
- New card: "Technical Signals Summary" — how many stocks bullish/bearish

---

## Phase 2: Fundamental Data
**Effort: 1 day | No LLM cost | High impact**

### New: `src/tools/india/fundamentals.ts`

Scrape from Screener.in (free, best Indian fundamental data):

| Metric | Source | Use |
|--------|--------|-----|
| PE Ratio | Screener | Valuation vs sector |
| PB Ratio | Screener | Book value comparison |
| ROE | Screener | Quality of business |
| ROCE | Screener | Capital efficiency |
| Debt/Equity | Screener | Financial risk |
| Revenue Growth (3Y) | Screener | Growth trend |
| Profit Growth (3Y) | Screener | Earnings momentum |
| Promoter Holding % | Screener | Skin in game |
| Promoter Pledge % | Screener | Red flag if high |
| Sector | NSE/Screener | Peer comparison |

### Scoring Rules (No LLM)
```
PE < Sector PE           → +10 (undervalued)
PE > 2x Sector PE        → -10 (expensive)
ROE > 15%                → +10 (quality)
Debt/Equity > 1.5        → -10 (risky)
Promoter Pledge > 20%    → -15 (red flag)
Revenue growth > 15% 3Y  → +10 (growing)
Profit declining 3 Qtrs  → -10 (deteriorating)
```

### Dashboard: Fundamental Score card per stock

---

## Phase 3: Indian Investor Personas
**Effort: 1 day | LLM cost: ~$0.10 per stock | Unique feature**

Each stock gets evaluated by 4 Indian investor personas. These are LLM agents
with carefully crafted system prompts.

### Persona 1: The Jhunjhunwala Agent 🐂
*"India's Big Bull" — Growth at any price, high conviction, cyclicals*
```
System prompt: You are Rakesh Jhunjhunwala, India's legendary bull investor.
You believe in India's long-term growth story. You look for:
- Companies riding India's consumption boom
- Cyclical stocks at the bottom (metals, real estate, banking)
- High promoter conviction (buying their own stock)
- You're willing to hold through 50% drawdowns if the thesis is intact
- You HATE: over-diversification, frequent trading, companies without moats
Evaluate {SYMBOL} with data: {fundamentals + technicals}
Give your verdict: BUY / HOLD / SELL with conviction (1-10) and reasoning.
```

### Persona 2: The Damani Agent 🧘
*Radhakishan Damani — Patient value investor, quality compounders*
```
System prompt: You are Radhakishan Damani, founder of DMart.
You are extremely patient. You look for:
- Businesses with consistent 15%+ ROE for 10 years
- Low debt, high free cash flow
- Simple business models you can understand
- Willing to wait years for the right price
- You HATE: high debt, aggressive management, businesses you don't understand
```

### Persona 3: The Contrarian Agent 🔄
*Inspired by Michael Burry + Indian deep value investors*
```
System prompt: You are a contrarian deep value investor focused on Indian markets.
You look for:
- Stocks beaten down >40% from highs with intact fundamentals
- Mean reversion plays — sectors out of favor
- Companies where bad news is already priced in
- Special situations: demergers, buybacks, promoter buying
- You HATE: momentum chasing, FOMO, crowded trades
```

### Persona 4: The Momentum Rider Agent 🚀
*Inspired by Mark Minervini + Indian momentum traders*
```
System prompt: You are a momentum-based trader in Indian markets.
You look for:
- Stocks near 52-week highs with increasing volume
- Breakout from consolidation patterns
- Relative strength vs Nifty 50
- Stocks with FII buying (institutional momentum)
- You HATE: catching falling knives, averaging down, bottom fishing
```

### Output Format (per persona per stock)
```json
{
  "persona": "Jhunjhunwala",
  "verdict": "BUY",
  "conviction": 8,
  "reasoning": "HDFC Bank at ₹750 is like buying India's future at 2x book...",
  "targetPrice": 1200,
  "timeHorizon": "2-3 years"
}
```

### Dashboard: "Investor Panel" showing 4 persona cards per stock with verdicts

---

## Phase 4: Bull vs Bear Debate
**Effort: 1 day | LLM cost: ~$0.05 per stock | From TradingAgents**

For each stock, two agents argue:

### Bull Agent
```
Input: All analyst reports + investor opinions that are positive
Task: Make the strongest case for HOLDING/BUYING this stock.
Must address the bear's concerns.
```

### Bear Agent
```
Input: All analyst reports + investor opinions that are negative
Task: Make the strongest case for SELLING this stock.
Must address the bull's points.
```

### Debate Flow (2-3 rounds)
```
Round 1: Bull presents case → Bear rebuts
Round 2: Bear presents case → Bull rebuts
Round 3: Both give final argument

Moderator summarizes:
- Winner (Bull or Bear)
- Key unresolved risks
- Consensus confidence level
```

### Dashboard: Expandable "Debate" section per stock showing the full argument

---

## Phase 5: Risk Overrides + Tax Agent
**Effort: 1 day | No LLM cost | From NOFX pattern**

### Hard Risk Overrides (Code-enforced, AI CANNOT override)

These run AFTER the AI makes recommendations:

```typescript
// These rules are enforced in code, not by LLM
const HARD_RULES = {
  maxSingleStockWeight: 10,      // % — force trim if exceeded
  maxSectorWeight: 25,           // % — force diversify
  maxTotalStocks: 50,            // — flag for consolidation if exceeded
  minPositionValue: 2000,        // ₹ — flag tiny positions for exit
  severeDrawdown: -50,           // % — auto-flag as EXIT regardless of AI
  maxDrawdownIgnore: -70,        // % — FORCE EXIT, no debate allowed
  forceReviewIfNewLow: true,     // stock hits new 52w low → mandatory review
};
```

### Tax Agent (India-Specific)
```
For each stock, compute:
- Holding period (days since buy date)
- STCG zone (<12 months) — taxed at 20%
- LTCG zone (>12 months) — taxed at 12.5%, ₹1.25L exemption
- Days until LTCG threshold (if close to 12 months, flag "wait X days")
- Tax-loss harvesting candidates (sell loss + rebuy after 30 days)
- Net tax impact of selling now vs waiting
```

### Dashboard: Tax column showing "⏳ 23 days to LTCG" or "🟢 LTCG eligible"

---

## Phase 6: Decision Agent + Portfolio Manager
**Effort: 1 day | LLM cost: ~$0.20 per full portfolio run**

### Decision Agent (CIO)
```
Input per stock:
- Technical report (Phase 1)
- Fundamental score (Phase 2)
- 4 investor persona opinions (Phase 3)
- Bull vs Bear debate outcome (Phase 4)
- Risk override flags (Phase 5)
- Tax implications (Phase 5)
- Current position size + portfolio weight

Task: Synthesize everything into a final decision.
```

### Portfolio Manager
```
Input: All stock decisions + full portfolio context

Output:
{
  weeklyPlan: [
    { priority: 1, action: "EXIT POLYPLEX", reason: "-68% loss, bear won debate unanimously, all personas say sell", freeCapital: "₹7.8K" },
    { priority: 2, action: "TRIM ITC to 5%", reason: "Over-concentrated at 8.7%, Jhunjhunwala says hold but reduce", freeCapital: "₹20K" },
    { priority: 3, action: "HOLD TATA MOTORS", reason: "Bull won debate, momentum + Jhunjhunwala high conviction, near 52w high" },
    { priority: 4, action: "ADD SIEMENS ENERGY", reason: "All 4 personas bullish, technical breakout, use freed capital" },
  ],
  capitalToRedeploy: "₹48K from exits",
  rebalanceNotes: "Portfolio concentrated in financials (35%). Move ₹50K to IT/Pharma.",
  riskScore: 62,
  nextReviewDate: "2026-04-05"
}
```

---

## Phase 7: Dashboard V2 UI
**Effort: 2 days**

### New Sections

1. **Agent Analysis Panel** (per stock — click to expand)
   ```
   ┌─────────────────────────────────────────────────┐
   │ RELIANCE INDUSTRIES                    HOLD 🟡  │
   ├─────────────────────────────────────────────────┤
   │ Technical: 🟢 Bullish (RSI:45, MACD:↑)         │
   │ Fundamental: 🟡 Fair (PE:25 vs Sector:22)       │
   │ Sentiment: 🔴 Negative (3 bearish headlines)     │
   │                                                   │
   │ 🐂 Jhunjhunwala: BUY (8/10) "India story..."    │
   │ 🧘 Damani: HOLD (6/10) "Margins pressured..."    │
   │ 🔄 Contrarian: HOLD (5/10) "Not cheap enough..." │
   │ 🚀 Momentum: SELL (3/10) "Below all MAs..."      │
   │                                                   │
   │ ⚔️ Debate: Bull won (7-3) — "Despite short..."   │
   │ 📊 Tax: LTCG eligible, ₹700 tax if sold now     │
   │                                                   │
   │ 🎯 CIO Decision: HOLD — Wait for ₹1,400 or...  │
   └─────────────────────────────────────────────────┘
   ```

2. **Weekly Action Plan** — top of dashboard
   - Cards with priority actions
   - "Capital freed" tracker
   - One-click "Why?" for each recommendation

3. **Investor Panel** — 4 persona cards with aggregate stats
   - "Jhunjhunwala likes 45 of your stocks"
   - "Contrarian found 12 deep value opportunities"

4. **Portfolio Radar Chart**
   - 5 axes: Diversification, Quality, Momentum, Value, Risk
   - Scored by respective agents

5. **Decision Log** (from NOFX pattern)
   - Full chain-of-thought for every recommendation
   - Historical decisions with outcomes
   - "Were we right?" tracking

---

## Phase 8: Automation + Notifications
**Effort: 1 day**

### Daily Cron Job
```
Schedule: 7:00 AM IST (before market opens)
1. Fetch fresh prices for all holdings
2. Update technical indicators
3. Run quick analysis (rule-based, no LLM)
4. Send Telegram summary: "3 stocks to watch today"

Schedule: 8:00 PM IST Saturday (weekly deep analysis)
1. Run full multi-agent analysis (all phases)
2. Generate weekly action plan
3. Send detailed Telegram report
4. Update dashboard
```

### Telegram Reports
```
📊 Weekly Portfolio Report — 29 Mar 2026

Health: 68/100 (Good)
Value: ₹51.5L | P&L: +₹18.3L (+55%)

🔴 EXIT THIS WEEK:
1. POLYPLEX — All agents agree: value trap
2. LA OPALA — Contrarian + Bear won

🟢 TOP CONVICTION HOLDS:
1. TATA MOTORS — Jhunjhunwala 9/10
2. SIEMENS ENERGY — All 4 personas bullish

⏳ TAX ALERTS:
3 stocks reach LTCG in next 30 days — don't sell yet!

Full analysis: localhost:3000/insights
```

---

## Implementation Roadmap

| Phase | What | Effort | LLM Cost | Priority |
|-------|------|--------|----------|----------|
| **1** | Technical Indicators | 1 day | Free | 🔴 Do first |
| **2** | Fundamental Data (Screener) | 1 day | Free | 🔴 Do first |
| **3** | Investor Personas (4 agents) | 1 day | ~$0.10/stock | 🟠 High |
| **4** | Bull vs Bear Debate | 1 day | ~$0.05/stock | 🟠 High |
| **5** | Risk Overrides + Tax Agent | 1 day | Free | 🟠 High |
| **6** | Decision Agent + PM | 1 day | ~$0.20/run | 🟡 Medium |
| **7** | Dashboard V2 UI | 2 days | Free | 🟡 Medium |
| **8** | Automation + Telegram | 1 day | Free | 🟢 Nice to have |

**Total: ~10 days of work**

### Cost Estimate (Phase 3-6 with LLM)
- 20 stocks deep analysis: ~$2-4 per run (GPT-4o-mini)
- 50 stocks deep analysis: ~$5-10 per run
- 163 stocks: ~$15-25 per run
- Weekly runs: ~$60-100/month
- **Recommendation:** Analyze top 30 stocks by value daily, full portfolio weekly

---

## Tech Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Agent orchestration | LangGraph | Already in Dexter, built for multi-agent |
| LLM (agents) | Claude Haiku / GPT-4o-mini | Cheapest, fast, good enough |
| LLM (debate/CIO) | Claude Sonnet / GPT-4o | Need stronger reasoning |
| Technical indicators | Custom TypeScript | No deps, runs in Bun |
| Fundamental data | Screener.in scraping | Free, best Indian coverage |
| Sector data | NSE industry classification | Auto-map from ISIN |
| State storage | SQLite (existing) | Cache agent reports |
| Agent prompts | Markdown files | Easy to iterate, version control |
| Risk overrides | Hard-coded TypeScript | MUST NOT be AI-controlled |

---

## New File Structure

```
src/
├── agents/                           # NEW — Multi-agent system
│   ├── orchestrator.ts               # LangGraph state graph
│   ├── analysts/
│   │   ├── technical-agent.ts        # Uses computed indicators
│   │   ├── fundamental-agent.ts      # Uses Screener data
│   │   ├── sentiment-agent.ts        # Uses RSS news + FII data
│   │   └── sector-agent.ts           # Peer comparison
│   ├── personas/
│   │   ├── jhunjhunwala-agent.ts     # Growth + cyclicals
│   │   ├── damani-agent.ts           # Value + quality
│   │   ├── contrarian-agent.ts       # Deep value + mean reversion
│   │   └── momentum-agent.ts         # Trend following
│   ├── debate/
│   │   ├── bull-agent.ts             # Argues for holding
│   │   ├── bear-agent.ts             # Argues for selling
│   │   └── moderator.ts             # Picks winner
│   ├── decision/
│   │   ├── cio-agent.ts              # Final stock decision
│   │   └── portfolio-manager.ts      # Weekly plan
│   ├── risk/
│   │   ├── hard-overrides.ts         # Code-enforced rules (NOT AI)
│   │   └── tax-agent.ts             # STCG/LTCG calculator
│   ├── prompts/                      # System prompts (markdown)
│   │   ├── technical.md
│   │   ├── fundamental.md
│   │   ├── sentiment.md
│   │   ├── jhunjhunwala.md
│   │   ├── damani.md
│   │   ├── contrarian.md
│   │   ├── momentum.md
│   │   ├── bull.md
│   │   ├── bear.md
│   │   ├── cio.md
│   │   └── portfolio-manager.md
│   └── store.ts                      # Save/load agent reports in SQLite
│
├── tools/india/
│   ├── technical-indicators.ts       # NEW — RSI, MACD, Bollinger, etc.
│   ├── fundamentals.ts               # NEW — Screener.in scraper
│   ├── fii-dii.ts                    # NEW — FII/DII flow data
│   └── ...existing files
│
├── dashboard/
│   ├── insights.ts                   # UPDATED — use agent results
│   ├── public/
│   │   ├── index.html                # UPDATED — agent panels, debate UI
│   │   ├── app.js                    # UPDATED — render agent analysis
│   │   └── style.css                 # UPDATED — persona cards, debate UI
│   └── routes.ts                     # UPDATED — /api/agent-analysis
│
└── ...existing dexter files
```
