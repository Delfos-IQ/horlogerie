/* ─────────────────── HISTORY ─────────────────── */

let _historyMode   = 'ranking';  // 'ranking' | 'detail'
let _rankingMetric = 'days';     // 'days' | 'sessions'

/* ── Category inference from brand/model name ── */
const CATEGORY_RULES = [
  { cat: 'Diver',     icon: 'ti-ripple', color: '#4FC3F7',
    kw: ['sub','dive','diver','submariner','tuna','sea','aqua','ocean','batiscafo','fathom','tudor','steeldive','prospex','marinemaster','seamaster'] },
  { cat: 'Pilot',     icon: 'ti-plane',  color: '#FFB74D',
    kw: ['pilot','aviation','flieger','nav','navigator','air','flyback','field','campo','military','militaire','explorer'] },
  { cat: 'Skeleton',  icon: 'ti-eye',    color: '#CE93D8',
    kw: ['skeleton','skel','tourbillon','open heart','openwork','squelette','transparent','fly-wheel'] },
  { cat: 'Chrono',    icon: 'ti-stopwatch', color: '#EF9A9A',
    kw: ['chrono','cronografo','chronograph','racing','daytona','speedmaster','valjoux','vk63','meca-quartz'] },
  { cat: 'GMT',       icon: 'ti-world', color: '#80CBC4',
    kw: ['gmt','dual time','worldtimer','world time','pepsi','batman'] },
  { cat: 'Dress',     icon: 'ti-tie', color: '#F48FB1',
    kw: ['dress','classic','clásico','elegant','elegante','slim','ultra thin','calatrava','patrimony','portugieser'] },
  { cat: 'Sport',     icon: 'ti-run', color: '#A5D6A7',
    kw: ['sport','speedmaster','navitimer','carrera','daytona','racing','quartz','solar','eco'] },
];

function inferCategory(w) {
  const text = `${w.brand} ${w.model} ${w.specs?.calibre || ''}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.kw.some(k => text.includes(k))) return rule;
  }
  return { cat: 'Otros', icon: 'ti-watch', color: 'var(--mid)' };
}

function watchStats(w) {
  const all = [...(w.history || [])];
  if (w.wearStart) all.push({ start: w.wearStart, end: Date.now(), active: true });
  const totalDays = all.reduce((a, i) => a + durationDays(i.start, i.end || Date.now()), 0);
  const sessions  = all.length;
  const lastEnd   = all.length ? Math.max(...all.map(i => i.end || Date.now())) : null;
  const daysSinceLast = lastEnd ? Math.floor((Date.now() - lastEnd) / 86400000) : null;
  return { totalDays, sessions, lastEnd, daysSinceLast, active: !!w.wearStart };
}

/* ── Mode toggle ── */
function setHistoryMode(mode) {
  _historyMode = mode;
  document.getElementById('history-ranking-view').style.display = mode === 'ranking' ? 'block' : 'none';
  document.getElementById('history-detail-view').style.display  = mode === 'detail'  ? 'block' : 'none';
  document.getElementById('btn-mode-ranking').classList.toggle('active', mode === 'ranking');
  document.getElementById('btn-mode-detail').classList.toggle('active', mode === 'detail');
  if (mode === 'ranking') renderRanking();
  if (mode === 'detail')  renderHistoryDetail();
}
window.setHistoryMode = setHistoryMode;

function setRankingMetric(metric) {
  _rankingMetric = metric;
  document.getElementById('btn-metric-days').classList.toggle('active', metric === 'days');
  document.getElementById('btn-metric-sessions').classList.toggle('active', metric === 'sessions');
  renderRanking();
}
window.setRankingMetric = setRankingMetric;

/* ── Main renderHistory entry point ── */
function renderHistory() {
  setHistoryMode(_historyMode);
}

/* ══════════════════════════════════════════════
   RANKING VIEW
══════════════════════════════════════════════ */
function renderRanking() {
  const body = document.getElementById('ranking-body');
  if (!body) return;
  const ws = getWatches();

  if (!ws.length) {
    body.innerHTML = `<div class="history-empty"><i class="ti ti-clock" style="font-size:40px;color:var(--mid);"></i><br><br>No hay relojes</div>`;
    return;
  }

  // Build stats for each watch
  const data = ws.map(w => ({ w, stats: watchStats(w), cat: inferCategory(w) }));
  const metric = _rankingMetric; // 'days' | 'sessions'
  const maxVal = Math.max(...data.map(d => metric === 'days' ? d.stats.totalDays : d.stats.sessions), 1);

  // Group by category
  const byCategory = {};
  data.forEach(d => {
    const key = d.cat.cat;
    if (!byCategory[key]) byCategory[key] = { cat: d.cat, items: [] };
    byCategory[key].items.push(d);
  });

  // Sort categories by total use desc
  const sortedCats = Object.values(byCategory).sort((a, b) => {
    const sumA = a.items.reduce((s, d) => s + (metric === 'days' ? d.stats.totalDays : d.stats.sessions), 0);
    const sumB = b.items.reduce((s, d) => s + (metric === 'days' ? d.stats.totalDays : d.stats.sessions), 0);
    return sumB - sumA;
  });

  // Sort items within each category
  sortedCats.forEach(grp => {
    grp.items.sort((a, b) => {
      const va = metric === 'days' ? a.stats.totalDays : a.stats.sessions;
      const vb = metric === 'days' ? b.stats.totalDays : b.stats.sessions;
      return vb - va;
    });
  });

  // Global rank position across all watches
  const globalRanked = [...data].sort((a, b) => {
    const va = metric === 'days' ? a.stats.totalDays : a.stats.sessions;
    const vb = metric === 'days' ? b.stats.totalDays : b.stats.sessions;
    return vb - va;
  });
  const rankMap = {};
  globalRanked.forEach((d, i) => { rankMap[d.w.id] = i + 1; });

  // Render
  body.innerHTML = sortedCats.map(grp => {
    const { cat, items } = grp;
    const catTotal = items.reduce((s, d) => s + (metric === 'days' ? d.stats.totalDays : d.stats.sessions), 0);
    const rows = items.map(d => {
      const { w, stats } = d;
      const val      = metric === 'days' ? stats.totalDays : stats.sessions;
      const pct      = maxVal > 0 ? Math.round(val / maxVal * 100) : 0;
      const rank     = rankMap[w.id];
      const label    = metric === 'days'
        ? (val === 0 ? 'Sin uso' : `${val} días`)
        : (val === 0 ? 'Sin uso' : `${val} sesión${val !== 1 ? 'es' : ''}`);
      const lastLabel = stats.daysSinceLast === null ? 'Nunca' :
        stats.daysSinceLast === 0 ? 'Hoy' :
        `Hace ${stats.daysSinceLast}d`;
      const urgColor = stats.daysSinceLast === null || stats.daysSinceLast > 25 ? '#e57373'
        : stats.daysSinceLast > 14 ? '#D4AF6A' : '#4CAF50';
      const barColor = val === 0 ? 'var(--dark3)' : cat.color;

      return `
        <div class="ranking-row" data-wid="${escHtml(w.id)}">
          <div class="ranking-rank">#${rank}</div>
          <div class="ranking-info">
            <div class="ranking-name">
              <span class="ranking-brand">${escHtml(w.brand)}</span>
              <span class="ranking-model">${escHtml(w.model)}</span>
              ${stats.active ? '<span class="ranking-active-dot">●</span>' : ''}
            </div>
            <div class="ranking-bar-wrap">
              <div class="ranking-bar" style="width:${pct}%;background:${barColor};"></div>
            </div>
            <div class="ranking-meta">
              <span class="ranking-val">${label}</span>
              <span class="ranking-last" style="color:${urgColor};">${lastLabel}</span>
            </div>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="ranking-category">
        <div class="ranking-cat-header">
          <i class="ti ${cat.icon}" style="color:${cat.color};font-size:14px;"></i>
          <span class="ranking-cat-name">${cat.cat}</span>
          <span class="ranking-cat-total">${catTotal} ${metric === 'days' ? 'd' : 'ses.'}</span>
        </div>
        ${rows}
      </div>`;
  }).join('');

  // Click to open detail
  body.querySelectorAll('.ranking-row').forEach(row => {
    row.addEventListener('click', () => openDetail(row.dataset.wid));
  });
}

/* ══════════════════════════════════════════════
   DETAIL VIEW (individual watch sessions)
══════════════════════════════════════════════ */
function renderHistoryDetail() {
  const sel = document.getElementById('history-selector');
  const ws  = getWatches();
  if (!sel) return;
  if (!ws.length) {
    const body = document.getElementById('history-body');
    if (body) body.innerHTML = `<div class="history-empty"><i class="ti ti-clock" style="font-size:40px;color:var(--mid);"></i><br><br>No hay relojes</div>`;
    sel.innerHTML = ''; return;
  }
  if (!historySelectedWatch || !getWatch(historySelectedWatch)) historySelectedWatch = ws[0].id;
  sel.innerHTML = ws.map(w => `
    <div class="hw-chip${w.id === historySelectedWatch ? ' active' : ''}" data-wid="${escHtml(w.id)}">
      ${escHtml(w.brand)} ${escHtml(w.model)}
    </div>`).join('');
  sel.querySelectorAll('.hw-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      historySelectedWatch = chip.dataset.wid;
      historySelectedYear  = null;
      renderHistoryBody();
    });
  });
  renderHistoryBody();
}

function renderHistoryBody() {
  const w    = getWatch(historySelectedWatch);
  const body = document.getElementById('history-body');
  if (!body) return;
  if (!w) { body.innerHTML = ''; return; }
  const all = [...(w.history || [])];
  if (w.wearStart) all.push({ start: w.wearStart, end: Date.now(), active: true });
  if (!all.length) {
    body.innerHTML = `<div class="history-empty"><i class="ti ti-calendar-x" style="font-size:36px;color:var(--mid);"></i><br><br>Aún no has usado este reloj</div>`;
    return;
  }
  const totalDays = all.reduce((a, i) => a + durationDays(i.start, i.end || Date.now()), 0);
  const years = [...new Set(all.map(i => new Date(i.start).getFullYear()))].sort((a, b) => b - a);
  if (!historySelectedYear) historySelectedYear = years[0];
  const yearTabs = `<div class="year-tabs">${years.map(y =>
    `<div class="year-tab${y === historySelectedYear ? ' active' : ''}" data-year="${y}">${y}</div>`
  ).join('')}</div>`;
  const summary = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
    <div class="spec-card"><div class="spec-label">Total sesiones</div><div class="spec-value">${all.length}</div></div>
    <div class="spec-card"><div class="spec-label">Total días</div><div class="spec-value">${totalDays}</div></div>
  </div>`;
  const filtered = all.filter(i => new Date(i.start).getFullYear() === historySelectedYear);
  const byMonth  = {};
  filtered.forEach(i => {
    const m = new Date(i.start).toLocaleDateString('es-ES', { month: 'long' });
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(i);
  });
  const monthsHTML = Object.entries(byMonth).map(([month, intervals]) => `
    <div class="month-group">
      <div class="month-label">${month}</div>
      ${intervals.map(i => {
        const dur = i.active ? elapsedSince(i.start) : `${durationDays(i.start, i.end)} días`;
        return `<div class="interval-row">
          <div class="interval-dates">${formatDate(i.start)} → ${i.active ? 'ahora' : formatDate(i.end)}</div>
          <div class="interval-duration">${dur}${i.active ? ' <span style="color:#4CAF50">●</span>' : ''}</div>
        </div>`;
      }).join('')}
    </div>`).join('');
  body.innerHTML = summary + yearTabs + monthsHTML;
  body.querySelectorAll('.year-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      historySelectedYear = parseInt(tab.dataset.year);
      renderHistoryBody();
    });
  });
}

