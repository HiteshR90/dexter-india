/* === Dexter India — Portfolio Dashboard JS === */

const API = '';
let autoRefreshTimer = null;
let autoRefreshOn = false;
let holdingsData = [];
let sortCol = 'value';
let sortDir = -1; // -1 = desc
let sectorChart = null;

// === INIT ===
document.addEventListener('DOMContentLoaded', () => {
  setupUpload();
  setupTableSort();
  refreshAll();
});

// === NUMBER FORMATTING (Indian) ===
function formatINR(n, decimals = 0) {
  if (n == null || isNaN(n)) return '--';
  const neg = n < 0;
  const abs = Math.abs(n);
  const fixed = abs.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');

  // Indian grouping: last 3, then groups of 2
  let result = '';
  const len = intPart.length;
  if (len <= 3) {
    result = intPart;
  } else {
    result = intPart.slice(-3);
    let remaining = intPart.slice(0, -3);
    while (remaining.length > 2) {
      result = remaining.slice(-2) + ',' + result;
      remaining = remaining.slice(0, -2);
    }
    if (remaining) result = remaining + ',' + result;
  }

  const formatted = decPart ? result + '.' + decPart : result;
  return (neg ? '-' : '') + '₹' + formatted;
}

function formatPct(n) {
  if (n == null || isNaN(n)) return '--';
  const sign = n >= 0 ? '+' : '';
  return sign + n.toFixed(2) + '%';
}

function formatNum(n) {
  if (n == null || isNaN(n)) return '--';
  return n.toLocaleString('en-IN');
}

function colorClass(n) {
  if (n > 0) return 'text-green';
  if (n < 0) return 'text-red';
  return 'text-muted';
}

// === AUTO REFRESH ===
function toggleAutoRefresh() {
  autoRefreshOn = !autoRefreshOn;
  const el = document.getElementById('autoRefreshToggle');
  el.classList.toggle('active', autoRefreshOn);

  if (autoRefreshOn) {
    autoRefreshTimer = setInterval(refreshAll, 30000);
  } else {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

// === REFRESH ALL ===
async function refreshAll() {
  document.getElementById('lastUpdated').textContent = 'Updating...';
  await Promise.allSettled([
    fetchMarket(),
    fetchPortfolio(),
    fetchAnalysis(),
    fetchNews(),
  ]);
  // Load AI insights after data is fetched
  if (typeof loadInsights === 'function') loadInsights();
  if (typeof loadRiskTax === 'function') loadRiskTax();
  const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('lastUpdated').textContent = 'Updated ' + now;
}

// === MARKET INDICES ===
async function fetchMarket() {
  try {
    const res = await fetch(API + '/api/market');
    const data = await res.json();
    if (data.indices) renderMarket(data.indices);
  } catch (e) {
    console.warn('Market fetch failed:', e);
  }
}

function renderMarket(indices) {
  const ids = ['idx-nifty50', 'idx-niftybank', 'idx-niftyit'];
  indices.forEach((idx, i) => {
    const el = document.getElementById(ids[i]);
    if (!el) return;
    const valEl = el.querySelector('.value');
    const chgEl = el.querySelector('.change');
    valEl.textContent = idx.last ? idx.last.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '--';
    if (idx.last) {
      chgEl.textContent = (idx.change >= 0 ? '+' : '') + idx.change.toFixed(1) + ' (' + formatPct(idx.pChange) + ')';
      chgEl.className = 'change ' + colorClass(idx.change);
    }
  });
}

// === PORTFOLIO ===
async function fetchPortfolio() {
  try {
    const res = await fetch(API + '/api/portfolio');
    const data = await res.json();
    if (data.holdings) {
      holdingsData = data.holdings;
      renderSummary(data.summary);
      renderHoldings(holdingsData);
      // Collapse upload if we have data
      if (holdingsData.length > 0) {
        document.getElementById('uploadSection').style.display = 'none';
      }
    }
  } catch (e) {
    console.warn('Portfolio fetch failed:', e);
  }
}

function renderSummary(s) {
  if (!s) return;
  document.getElementById('totalValue').textContent = formatINR(s.totalValue);
  document.getElementById('totalInvested').textContent = 'Invested: ' + formatINR(s.totalInvested);
  
  const todayEl = document.getElementById('todayPnl');
  todayEl.textContent = formatINR(s.todayPnl);
  todayEl.className = 'value ' + colorClass(s.todayPnl);
  
  const todayPctEl = document.getElementById('todayPnlPct');
  todayPctEl.textContent = formatPct(s.todayPnlPct);
  todayPctEl.className = 'sub ' + colorClass(s.todayPnlPct);

  const totalPnlEl = document.getElementById('totalPnl');
  totalPnlEl.textContent = formatINR(s.totalPnl);
  totalPnlEl.className = 'value ' + colorClass(s.totalPnl);

  const totalPctEl = document.getElementById('totalPnlPct');
  totalPctEl.textContent = formatPct(s.totalPnlPct);
  totalPctEl.className = 'sub ' + colorClass(s.totalPnlPct);

  document.getElementById('stockCount').textContent = s.stockCount || '--';
}

function renderHoldings(data) {
  const tbody = document.getElementById('holdingsBody');
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="icon">📋</div><div class="title">No holdings yet</div><div class="subtitle">Upload a CSV file to get started</div></div></td></tr>`;
    return;
  }

  // Sort
  const sorted = [...data].sort((a, b) => {
    const aVal = a[sortCol];
    const bVal = b[sortCol];
    if (typeof aVal === 'string') return sortDir * aVal.localeCompare(bVal);
    return sortDir * ((aVal || 0) - (bVal || 0));
  });

  tbody.innerHTML = sorted.map(h => `
    <tr class="fade-in">
      <td class="symbol-cell">${esc(h.symbol)}</td>
      <td class="name-cell">${esc(h.name)}</td>
      <td class="text-right">${formatNum(h.quantity)}</td>
      <td class="text-right">${formatINR(h.avgPrice, 2)}</td>
      <td class="text-right">${formatINR(h.currentPrice, 2)}</td>
      <td class="text-right">${formatINR(h.value)}</td>
      <td class="text-right ${colorClass(h.pnl)}">${formatINR(h.pnl)}</td>
      <td class="text-right ${colorClass(h.pnlPct)}">${formatPct(h.pnlPct)}</td>
      <td class="text-right ${colorClass(h.dayChangePct)}">${formatPct(h.dayChangePct)}</td>
    </tr>
  `).join('');
}

// === TABLE SORT ===
function setupTableSort() {
  document.querySelectorAll('#holdingsTable th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortCol === col) {
        sortDir *= -1;
      } else {
        sortCol = col;
        sortDir = -1;
      }
      // Update sort arrows
      document.querySelectorAll('#holdingsTable th').forEach(t => t.classList.remove('sorted'));
      th.classList.add('sorted');
      th.querySelector('.sort-arrow').textContent = sortDir === 1 ? '▲' : '▼';
      renderHoldings(holdingsData);
    });
  });
}

// === ANALYSIS (Sectors + Movers) ===
async function fetchAnalysis() {
  try {
    const res = await fetch(API + '/api/portfolio/analysis');
    const data = await res.json();
    if (data.sectors) renderSectorChart(data.sectors);
    if (data.topGainers) renderMovers('topGainers', data.topGainers, true);
    if (data.topLosers) renderMovers('topLosers', data.topLosers, false);
  } catch (e) {
    console.warn('Analysis fetch failed:', e);
  }
}

function renderSectorChart(sectors) {
  const wrapper = document.getElementById('sectorChartWrapper');
  const empty = document.getElementById('sectorEmpty');

  if (!sectors || sectors.length === 0) {
    wrapper.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  wrapper.style.display = 'block';
  empty.style.display = 'none';

  const colors = [
    '#4a9eff', '#00c853', '#ff6d00', '#aa00ff', '#ff1744',
    '#00bfa5', '#ffc107', '#e040fb', '#76ff03', '#18ffff',
    '#ff9100', '#536dfe', '#69f0ae', '#ff80ab', '#b388ff',
  ];

  const labels = sectors.map(s => s.name);
  const values = sectors.map(s => s.pct);

  if (sectorChart) sectorChart.destroy();

  sectorChart = new Chart(document.getElementById('sectorChart'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 0,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#a0a0b8',
            font: { size: 11, family: 'Inter' },
            padding: 12,
            usePointStyle: true,
            pointStyleWidth: 8,
          },
        },
        tooltip: {
          callbacks: {
            label: ctx => ' ' + ctx.label + ': ' + ctx.parsed.toFixed(1) + '%',
          },
        },
      },
    },
  });
}

function renderMovers(containerId, movers, isGainer) {
  const el = document.getElementById(containerId);
  if (!movers || movers.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="subtitle">--</div></div>';
    return;
  }

  el.innerHTML = movers.map(m => `
    <div class="mover-item">
      <div>
        <div class="mover-symbol">${esc(m.symbol)}</div>
        <div class="mover-name">${esc(m.name || '')}</div>
      </div>
      <div class="mover-change ${isGainer ? 'text-green' : 'text-red'}">${formatPct(m.dayChangePct)}</div>
    </div>
  `).join('');
}

// === NEWS ===
async function fetchNews() {
  try {
    const res = await fetch(API + '/api/news');
    const data = await res.json();
    if (data.news) renderNews(data.news);
  } catch (e) {
    console.warn('News fetch failed:', e);
  }
}

function renderNews(news) {
  const el = document.getElementById('newsFeed');
  if (!news || news.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="subtitle">No news available</div></div>';
    return;
  }

  el.innerHTML = news.map(n => `
    <div class="news-item">
      <div class="sentiment-dot ${n.sentiment || 'neutral'}"></div>
      <div>
        <div class="news-title"><a href="${esc(n.link)}" target="_blank">${esc(n.title)}</a></div>
        <div class="news-meta">${esc(n.source || '')} · ${timeAgo(n.date)}</div>
      </div>
    </div>
  `).join('');
}

// === UPLOAD ===
function setupUpload() {
  const zone = document.getElementById('dropZone');
  const input = document.getElementById('fileInput');

  ['dragenter', 'dragover'].forEach(e => {
    zone.addEventListener(e, ev => { ev.preventDefault(); zone.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(e => {
    zone.addEventListener(e, ev => { ev.preventDefault(); zone.classList.remove('dragover'); });
  });

  zone.addEventListener('drop', ev => {
    const file = ev.dataTransfer.files[0];
    if (file) uploadFile(file);
  });

  input.addEventListener('change', () => {
    if (input.files[0]) uploadFile(input.files[0]);
  });
}

async function uploadFile(file) {
  const status = document.getElementById('uploadStatus');
  status.className = 'upload-status';
  status.style.display = 'block';
  status.textContent = 'Uploading...';

  try {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(API + '/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (data.error) {
      status.className = 'upload-status error';
      status.textContent = '✗ ' + data.error;
    } else {
      status.className = 'upload-status success';
      status.textContent = '✓ Uploaded ' + data.count + ' holdings successfully!';
      // Refresh data
      setTimeout(() => {
        refreshAll();
        status.style.display = 'none';
      }, 2000);
    }
  } catch (e) {
    status.className = 'upload-status error';
    status.textContent = '✗ Upload failed: ' + e.message;
  }
}

// === HELPERS ===
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  } catch {
    return '';
  }
}

// === AI INSIGHTS ===
async function loadInsights() {
  try {
    const res = await fetch('/api/insights');
    if (!res.ok) return;
    const data = await res.json();
    renderInsights(data);
  } catch (e) { console.error('Insights error:', e); }
}

function renderInsights(data) {
  const section = document.getElementById('insightsSection');
  section.style.display = 'block';

  const s = data.summary;

  // Health ring
  const ring = document.getElementById('healthRing');
  ring.style.setProperty('--pct', s.healthScore);
  const ringColor = s.healthScore >= 70 ? 'var(--green)' : s.healthScore >= 50 ? '#ffaa00' : 'var(--red)';
  ring.style.background = `conic-gradient(${ringColor} ${s.healthScore}%, var(--bg-card) 0)`;
  document.getElementById('healthScoreNum').textContent = s.healthScore;
  document.getElementById('healthLabel').textContent = `Portfolio Health: ${s.portfolioHealth}`;

  // Signal pills
  const pills = document.getElementById('signalPills');
  pills.innerHTML = [
    s.strongSell > 0 ? `<span class="signal-pill strong-sell">${s.strongSell} Strong Sell</span>` : '',
    s.sell > 0 ? `<span class="signal-pill sell">${s.sell} Sell</span>` : '',
    s.hold > 0 ? `<span class="signal-pill hold">${s.hold} Hold</span>` : '',
    s.buy > 0 ? `<span class="signal-pill buy">${s.buy} Buy</span>` : '',
    s.strongBuy > 0 ? `<span class="signal-pill strong-buy">${s.strongBuy} Strong Buy</span>` : '',
  ].join('');

  // Key actions
  const actions = document.getElementById('insightsActions');
  actions.innerHTML = s.keyActions.map(a => `<div class="action-chip">→ ${a}</div>`).join('');

  // Risk alerts
  document.getElementById('riskAlerts').innerHTML =
    data.riskAlerts.map(r => `<div class="alert-item">${r}</div>`).join('') || '<div class="alert-item">No major risks</div>';

  // Opportunities
  document.getElementById('opportunities').innerHTML =
    data.opportunities.map(o => `<div class="alert-item">${o}</div>`).join('') || '<div class="alert-item">--</div>';

  // Sell table
  const sells = data.insights.filter(i => i.signal === 'STRONG_SELL' || i.signal === 'SELL');
  const sellBody = document.getElementById('sellTableBody');
  sellBody.innerHTML = sells.map(i => {
    const m = i.metrics;
    const cls = i.signal === 'STRONG_SELL' ? 'strong-sell' : 'sell';
    return `<tr>
      <td><strong>${i.symbol}</strong><br><span class="text-muted" style="font-size:0.7rem">${i.name.substring(0,25)}</span></td>
      <td class="text-right text-red">${m.totalReturn.toFixed(0)}%</td>
      <td class="text-right">${formatINR(m.invested)}</td>
      <td class="text-right">${formatINR(m.currentValue)}</td>
      <td><span class="signal-badge ${cls}">${i.signal.replace('_',' ')}</span></td>
    </tr>`;
  }).join('');

  // Buy table
  const buys = data.insights
    .filter(i => i.signal === 'STRONG_BUY' || i.signal === 'BUY')
    .sort((a, b) => b.metrics.currentValue - a.metrics.currentValue);
  const buyBody = document.getElementById('buyTableBody');
  buyBody.innerHTML = buys.map(i => {
    const m = i.metrics;
    const cls = i.signal === 'STRONG_BUY' ? 'strong-buy' : 'buy';
    return `<tr>
      <td><strong>${i.symbol}</strong><br><span class="text-muted" style="font-size:0.7rem">${i.name.substring(0,25)}</span></td>
      <td class="text-right text-green">+${m.totalReturn.toFixed(0)}%</td>
      <td class="text-right">${formatINR(m.currentValue)}</td>
      <td class="text-right">${m.portfolioWeight.toFixed(1)}%</td>
      <td><span class="signal-badge ${cls}">${i.signal.replace('_',' ')}</span></td>
    </tr>`;
  }).join('');
}

// Insights auto-loaded via refreshAll() — no extra hooks needed.

// === AI AGENT ANALYSIS ===

function populateAgentStockSelect(holdings) {
  const select = document.getElementById('agentStockSelect');
  if (!select || !holdings) return;
  // Keep first option, remove rest
  while (select.options.length > 1) select.remove(1);
  holdings.forEach(h => {
    const opt = document.createElement('option');
    opt.value = h.symbol;
    opt.textContent = `${h.symbol} — ${h.name || h.symbol}`;
    select.appendChild(opt);
  });
  document.getElementById('agentSection').style.display = 'block';
}

async function loadStockAgent(symbol) {
  if (!symbol) {
    document.getElementById('agentResult').style.display = 'none';
    return;
  }
  const status = document.getElementById('agentStatus');
  status.textContent = `Analyzing ${symbol}... (4 personas + debate + CIO, ~15s)`;
  
  try {
    const res = await fetch(`/api/agent-analysis?symbol=${symbol}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    renderAgentResult(data);
    status.textContent = `Analysis complete for ${symbol}`;
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
    console.error('Agent analysis error:', e);
  }
}

async function runPortfolioAgents() {
  const btn = document.getElementById('runAllAgentsBtn');
  const status = document.getElementById('agentStatus');
  btn.disabled = true;
  btn.textContent = '⏳ Analyzing...';
  status.textContent = 'Running AI analysis on top holdings... (this may take 1-2 minutes)';
  
  try {
    const res = await fetch('/api/agent-analysis');
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    renderPortfolioAgentResults(data);
    status.textContent = `Analyzed ${data.totalStocks} stocks`;
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🧠 Analyze Top 10 (AI)';
  }
}

function renderAgentResult(data) {
  document.getElementById('agentResult').style.display = 'block';
  document.getElementById('portfolioAgentResults').style.display = 'none';
  
  // Persona verdicts
  const personaEl = document.getElementById('personaVerdicts');
  const emojis = { 'Jhunjhunwala': '🐂', 'Damani': '🧘', 'Contrarian': '🔄', 'Momentum': '🚀' };
  const verdictColors = {
    'STRONG_BUY': 'var(--green)', 'BUY': '#66bb6a',
    'HOLD': '#aaa', 'SELL': '#ffaa00', 'STRONG_SELL': 'var(--red)', 'EXIT': 'var(--red)'
  };
  
  personaEl.innerHTML = (data.personaVerdicts || []).map(p => {
    const color = verdictColors[p.verdict] || '#aaa';
    const conviction = p.conviction || 5;
    return `<div class="persona-card">
      <div class="persona-header">
        <div>
          <span class="persona-emoji">${emojis[p.persona] || '🤖'}</span>
          <span class="persona-name">${p.persona}</span>
        </div>
        <span class="verdict-badge" style="background:${color}22;color:${color}">${p.verdict}</span>
      </div>
      <div class="conviction-bar"><div class="conviction-fill" style="width:${conviction*10}%;background:${color}"></div></div>
      <div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px">Conviction: ${conviction}/10${p.timeHorizon ? ' • ' + p.timeHorizon : ''}${p.targetPrice ? ' • Target: ₹' + formatINR(p.targetPrice) : ''}</div>
      <div class="reasoning">${p.reasoning || ''}</div>
    </div>`;
  }).join('');
  
  // Debate
  const debateEl = document.getElementById('debateResult');
  const d = data.debateResult || {};
  const winnerClass = d.winner === 'bull' ? 'bull-won' : 'bear-won';
  const winnerText = d.winner === 'bull' ? '🐂 Bull Wins' : '🐻 Bear Wins';
  debateEl.innerHTML = `
    <div class="debate-round">
      <div class="debate-side bull">
        <div class="label" style="color:var(--green)">🐂 Bull Case</div>
        ${d.bullArgument || 'No argument'}
      </div>
      <div class="debate-side bear">
        <div class="label" style="color:var(--red)">🐻 Bear Case</div>
        ${d.bearArgument || 'No argument'}
      </div>
    </div>
    <div class="debate-winner ${winnerClass}">${winnerText} (Confidence: ${d.confidence || 0}/10)</div>
    <div class="debate-moderator"><strong>Moderator:</strong> ${d.moderatorSummary || ''}</div>
  `;
  
  // CIO Decision
  const cioEl = document.getElementById('cioDecision');
  const dec = data.decision || {};
  const decClass = (dec.decision || 'hold').toLowerCase().replace('_', '-');
  cioEl.innerHTML = `
    <div class="cio-card">
      <div class="cio-decision-badge ${decClass}">
        ${dec.decision || 'N/A'}
        <div style="font-size:0.7rem;font-weight:400;margin-top:4px">Confidence: ${dec.confidence || 0}%</div>
      </div>
      <div class="cio-details">
        <div class="reasoning">${dec.reasoning || ''}</div>
        <div class="key-factors">
          ${(dec.keyFactors || []).map(f => `<span class="factor-chip">${f}</span>`).join('')}
        </div>
        <div class="cio-metrics">
          ${dec.targetPrice ? `<div class="cio-metric">Target: <strong>₹${formatINR(dec.targetPrice)}</strong></div>` : ''}
          ${dec.stopLoss ? `<div class="cio-metric">Stop Loss: <strong>₹${formatINR(dec.stopLoss)}</strong></div>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderPortfolioAgentResults(data) {
  document.getElementById('agentResult').style.display = 'none';
  document.getElementById('portfolioAgentResults').style.display = 'block';
  
  // Weekly plan
  const planEl = document.getElementById('weeklyPlan');
  if (data.weeklyActionPlan) {
    const lines = data.weeklyActionPlan.split('\n').filter(l => l.trim());
    planEl.innerHTML = lines.map((line, i) => `
      <div class="plan-item">
        <div class="plan-priority">${i + 1}</div>
        <div class="plan-content">
          <div class="plan-action">${line}</div>
        </div>
      </div>
    `).join('');
  } else {
    planEl.innerHTML = '<div class="empty-state"><div class="subtitle">No action plan generated</div></div>';
  }
  
  // Stock cards
  const gridEl = document.getElementById('agentStocksGrid');
  const verdictColors = {
    'STRONG_BUY': 'var(--green)', 'BUY': '#66bb6a',
    'HOLD': '#aaa', 'SELL': '#ffaa00', 'STRONG_SELL': 'var(--red)', 'EXIT': 'var(--red)'
  };
  const emojis = { 'Jhunjhunwala': '🐂', 'Damani': '🧘', 'Contrarian': '🔄', 'Momentum': '🚀' };
  
  gridEl.innerHTML = (data.analyses || []).map(a => {
    const dec = a.decision || {};
    const decColor = verdictColors[dec.decision] || '#aaa';
    const dbWinner = a.debateResult?.winner === 'bull' ? '🐂 Bull won' : '🐻 Bear won';
    
    return `<div class="agent-stock-card">
      <div class="stock-header">
        <div class="stock-name">${a.symbol}</div>
        <span class="signal-badge" style="background:${decColor}22;color:${decColor}">${dec.decision || 'N/A'}</span>
      </div>
      <div class="personas-mini">
        ${(a.personaVerdicts || []).map(p => {
          const c = verdictColors[p.verdict] || '#aaa';
          return `<span class="persona-mini-chip" style="background:${c}22;color:${c}">${emojis[p.persona]||''} ${p.verdict}</span>`;
        }).join('')}
      </div>
      <div class="debate-mini">⚔️ ${dbWinner} (${a.debateResult?.confidence || 0}/10)</div>
      <div class="cio-mini" style="color:${decColor}">
        🎯 ${dec.decision} — Confidence ${dec.confidence || 0}%
        ${dec.targetPrice ? ` • Target ₹${formatINR(dec.targetPrice)}` : ''}
      </div>
      <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;max-height:60px;overflow:hidden">${dec.reasoning || ''}</div>
    </div>`;
  }).join('');
}

// Hook: populate stock dropdown when portfolio loads
const _origFetchPortfolio = window.fetchPortfolio;
if (typeof fetchPortfolio === 'function') {
  const origFn = fetchPortfolio;
  window.fetchPortfolio = async function() {
    await origFn();
    // After portfolio loads, populate the agent dropdown
    try {
      const res = await fetch('/api/portfolio');
      const data = await res.json();
      if (data.holdings) populateAgentStockSelect(data.holdings);
    } catch {}
  };
}
// Also try on initial load
setTimeout(async () => {
  try {
    const res = await fetch('/api/portfolio');
    const data = await res.json();
    if (data.holdings && data.holdings.length > 0) populateAgentStockSelect(data.holdings);
  } catch {}
}, 3000);
JSEOF; __hermes_rc=$?; printf '__HERMES_FENCE_a9f7b3__'; exit $__hermes_rc

// === RISK + TAX ===
async function loadRiskTax() {
  try {
    const [riskRes, taxRes] = await Promise.allSettled([
      fetch('/api/risk'),
      fetch('/api/tax'),
    ]);
    
    const section = document.getElementById('riskTaxSection');
    let hasData = false;
    
    if (riskRes.status === 'fulfilled' && riskRes.value.ok) {
      const risk = await riskRes.value.json();
      if (!risk.error) { renderRisk(risk); hasData = true; }
    }
    if (taxRes.status === 'fulfilled' && taxRes.value.ok) {
      const tax = await taxRes.value.json();
      if (!tax.error) { renderTax(tax); hasData = true; }
    }
    if (hasData) section.style.display = 'block';
  } catch (e) { console.warn('Risk/Tax load error:', e); }
}

function renderRisk(data) {
  const m = data.portfolioMetrics || {};
  document.getElementById('riskMetrics').innerHTML = `
    <div class="risk-metric-card">
      <div class="metric-value" style="color:${m.diversificationScore >= 60 ? 'var(--green)' : m.diversificationScore >= 40 ? '#ffaa00' : 'var(--red)'}">${m.diversificationScore || 0}</div>
      <div class="metric-label">Diversification Score</div>
    </div>
    <div class="risk-metric-card">
      <div class="metric-value">${m.totalStocks || 0}</div>
      <div class="metric-label">Total Stocks</div>
    </div>
    <div class="risk-metric-card">
      <div class="metric-value" style="color:${m.maxSingleWeight > 10 ? 'var(--red)' : 'var(--green)'}">${(m.maxSingleWeight || 0).toFixed(1)}%</div>
      <div class="metric-label">Max Stock Weight (${m.maxSingleStock || ''})</div>
    </div>
  `;
  
  const overrides = data.overrides || [];
  document.getElementById('riskOverrides').innerHTML = overrides.length === 0
    ? '<div style="color:var(--green);font-size:0.85rem;padding:8px">✅ No risk overrides needed</div>'
    : overrides.map(o => `
      <div class="override-item ${o.severity}">
        <span class="symbol">${o.symbol}</span>
        <span class="signal-badge ${o.overriddenTo.toLowerCase().replace('_','-')}" style="font-size:0.7rem">${o.overriddenTo}</span>
        <span class="rule">${o.reason}</span>
      </div>
    `).join('');
  
  const warnings = [...(data.warnings || []), ...(data.criticalAlerts || [])];
  document.getElementById('riskWarnings').innerHTML = warnings.map(w =>
    `<div style="font-size:0.8rem;color:var(--text-secondary);padding:4px 0">${w}</div>`
  ).join('');
}

function renderTax(data) {
  const s = data.summary || {};
  document.getElementById('taxSummary').innerHTML = `
    <div class="tax-card">
      <div class="tax-value">${s.stcgCount || 0} stocks</div>
      <div class="tax-label">STCG (20% tax)</div>
    </div>
    <div class="tax-card">
      <div class="tax-value">${s.ltcgCount || 0} stocks</div>
      <div class="tax-label">LTCG (12.5% tax)</div>
    </div>
    <div class="tax-card">
      <div class="tax-value text-green">₹${formatINR(s.ltcgExemptionRemaining || 0)}</div>
      <div class="tax-label">LTCG Exemption Left (of ₹1.25L)</div>
    </div>
    <div class="tax-card">
      <div class="tax-value" style="color:${(s.potentialTaxSaving || 0) > 0 ? 'var(--green)' : '#aaa'}">₹${formatINR(s.potentialTaxSaving || 0)}</div>
      <div class="tax-label">Tax-Loss Harvest Saving</div>
    </div>
  `;
  
  document.getElementById('taxAlerts').innerHTML = (data.alerts || []).map(a =>
    `<div class="tax-alert">${a}</div>`
  ).join('');
  
  // Show near-LTCG and harvest candidates
  const interesting = (data.holdings || []).filter(h => h.daysToLTCG > 0 && h.daysToLTCG <= 30 || h.isHarvestCandidate);
  document.getElementById('taxHoldings').innerHTML = interesting.map(h => {
    const badge = h.daysToLTCG > 0 && h.daysToLTCG <= 30
      ? `<span class="tax-badge near-ltcg">⏳ ${h.daysToLTCG}d to LTCG</span>`
      : h.isHarvestCandidate
        ? `<span class="tax-badge stcg">🌾 Harvest ₹${formatINR(h.harvestSaving)}</span>`
        : `<span class="tax-badge ${h.taxCategory.toLowerCase()}">${h.taxCategory}</span>`;
    return `<div class="tax-holding-row">
      <span><strong>${h.symbol}</strong></span>
      <span>${h.recommendation}</span>
      ${badge}
    </div>`;
  }).join('');
}
JSEOF; __hermes_rc=$?; printf '__HERMES_FENCE_a9f7b3__'; exit $__hermes_rc
