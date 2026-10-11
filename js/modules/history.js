/* ─────────────────── HISTORY ─────────────────── */

let _historyMode   = 'calendar'; // 'calendar' | 'ranking' | 'detail'
let _calMonth      = null;       // Date set to the 1st of the month shown
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
  return { cat: 'Otros', icon: 'ti-device-watch', color: 'var(--mid)' };
}

function watchStats(w) {
  const st = wearStats(w);
  return { totalDays: st.daysWorn, sessions: st.sessions, lastEnd: st.lastWorn,
           daysSinceLast: st.daysSinceLast, active: st.active };
}

/* ── Mode toggle ── */
function setHistoryMode(mode) {
  _historyMode = mode;
  document.getElementById('history-calendar-view').style.display = mode === 'calendar' ? 'block' : 'none';
  document.getElementById('history-ranking-view').style.display  = mode === 'ranking'  ? 'block' : 'none';
  document.getElementById('history-detail-view').style.display   = mode === 'detail'   ? 'block' : 'none';
  ['calendar', 'ranking', 'detail'].forEach(m =>
    document.getElementById('btn-mode-' + m)?.classList.toggle('active', m === mode));
  if (mode === 'calendar') renderCalendar();
  if (mode === 'ranking')  renderRanking();
  if (mode === 'detail')   renderHistoryDetail();
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
  const all = wearIntervals(w);
  const addBtn = `<button class="chip-btn" id="hist-add" style="margin-bottom:14px;">
      <i class="ti ti-calendar-plus" aria-hidden="true"></i> Apuntar un uso</button>`;
  if (!all.length) {
    body.innerHTML = addBtn + `<div class="history-empty"><i class="ti ti-calendar-x" style="font-size:36px;color:var(--mid);"></i><br><br>Aún no has usado este reloj</div>`;
    body.querySelector('#hist-add').addEventListener('click', () => openWearSheet(w.id));
    return;
  }
  const st = wearStats(w);
  const years = [...new Set(all.map(i => new Date(i.start).getFullYear()))].sort((a, b) => b - a);
  if (!historySelectedYear || !years.includes(historySelectedYear)) historySelectedYear = years[0];
  const yearTabs = `<div class="year-tabs">${years.map(y =>
    `<button class="year-tab${y === historySelectedYear ? ' active' : ''}" data-year="${y}">${y}</button>`
  ).join('')}</div>`;
  const summary = `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
    <div class="spec-card"><div class="spec-label">Días de uso</div><div class="spec-value">${st.daysWorn}</div></div>
    <div class="spec-card"><div class="spec-label">Sesiones</div><div class="spec-value">${st.sessions}</div></div>
    <div class="spec-card"><div class="spec-label">90 días</div><div class="spec-value">${st.daysWorn90}</div></div>
  </div>`;
  const filtered = all.filter(i => new Date(i.start).getFullYear() === historySelectedYear).reverse();
  const byMonth  = new Map();
  filtered.forEach(i => {
    const m = new Date(i.start).toLocaleDateString('es-ES', { month: 'long' });
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(i);
  });
  const monthsHTML = [...byMonth.entries()].map(([month, intervals]) => `
    <div class="month-group">
      <div class="month-label">${month}</div>
      ${intervals.map(i => {
        const days = calendarDaysBetween(i.start, i.end) + 1;
        const dates = days === 1 ? formatDate(i.start) : `${formatDate(i.start)} → ${i.active ? 'ahora' : formatDate(i.end)}`;
        const dur = i.active ? elapsedSince(i.start) : `${days} ${days === 1 ? 'día' : 'días'}`;
        return `<div class="interval-row">
          <div class="interval-dates">${dates}</div>
          <div class="interval-duration">${dur}${i.active ? ' <span style="color:#4CAF50">●</span>' : ''}</div>
          ${i.active ? '' : `<button class="interval-edit" data-idx="${i.idx}" aria-label="Editar o borrar este uso"><i class="ti ti-pencil" aria-hidden="true"></i></button>`}
        </div>`;
      }).join('')}
    </div>`).join('');
  body.innerHTML = addBtn + summary + yearTabs + monthsHTML;
  body.querySelector('#hist-add').addEventListener('click', () => openWearSheet(w.id));
  body.querySelectorAll('.interval-edit').forEach(b =>
    b.addEventListener('click', () => openWearSheet(w.id, Number(b.dataset.idx))));
  body.querySelectorAll('.year-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      historySelectedYear = parseInt(tab.dataset.year);
      renderHistoryBody();
    });
  });
}

/* ══════════════════════════════════════════════
   CALENDAR VIEW — one month, what was worn each day
══════════════════════════════════════════════ */
const MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

/** Map dayKey → [watch, …] for every worn day */
function wornByDay(ws = getWatches()) {
  const map = new Map();
  ws.forEach(w => wornDayKeys(w).forEach(k => {
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(w);
  }));
  return map;
}
window.wornByDay = wornByDay;

function watchInitials(w) {
  return (w.brand || '?').trim().slice(0, 1).toUpperCase() + (w.model || '').trim().slice(0, 1).toUpperCase();
}
function watchChip(w, size = 26) {
  const cat = inferCategory(w);
  return isSafePhoto(w.photo)
    ? `<img class="cal-chip" src="${w.photo}" alt="" width="${size}" height="${size}">`
    : `<span class="cal-chip cal-chip-txt" style="--chip:${cat.color}">${escHtml(watchInitials(w))}</span>`;
}

function renderCalendar() {
  const grid = document.getElementById('cal-grid');
  if (!grid) return;
  const now = new Date();
  if (!_calMonth) _calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const y = _calMonth.getFullYear(), m = _calMonth.getMonth();
  const prefix = `${y}-${String(m + 1).padStart(2, '0')}-`;
  const byDay = wornByDay();
  const todayKey = dayKey(Date.now());

  document.getElementById('cal-title').textContent = `${MONTHS_ES[m]} ${y}`;
  document.getElementById('cal-next').disabled = (y > now.getFullYear()) || (y === now.getFullYear() && m >= now.getMonth());

  // Summary of the month
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const elapsed = (y === now.getFullYear() && m === now.getMonth()) ? now.getDate() : daysInMonth;
  let logged = 0; const count = new Map();
  for (let d = 1; d <= daysInMonth; d++) {
    const list = byDay.get(prefix + String(d).padStart(2, '0'));
    if (!list) continue;
    logged++;
    list.forEach(w => count.set(w.id, (count.get(w.id) || 0) + 1));
  }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  const topW = top ? getWatch(top[0]) : null;
  document.getElementById('cal-summary').innerHTML = logged
    ? `<div><b>${logged}</b><span>de ${elapsed} días con reloj</span></div>
       <div><b>${count.size}</b><span>${count.size === 1 ? 'reloj distinto' : 'relojes distintos'}</span></div>
       <div><b>${topW ? escHtml(topW.brand) : '—'}</b><span>más usado${top ? ` · ${top[1]} d` : ''}</span></div>`
    : `<div class="cal-empty">Sin usos apuntados en ${MONTHS_ES[m]}. Toca un día para añadir el reloj que llevaste.</div>`;

  // Grid (weeks start on Monday)
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  let html = '';
  for (let i = 0; i < lead; i++) html += '<div class="cal-cell cal-pad" aria-hidden="true"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const key = prefix + String(d).padStart(2, '0');
    const list = byDay.get(key) || [];
    const future = key > todayKey;
    const label = `${d} de ${MONTHS_ES[m]}: ${list.length ? list.map(w => `${w.brand} ${w.model}`).join(', ') : 'sin reloj'}`;
    html += `<button class="cal-cell${list.length ? ' worn' : ''}${key === todayKey ? ' today' : ''}" data-day="${key}"
               ${future ? 'disabled' : ''} role="gridcell" aria-label="${escHtml(label)}">
      <span class="cal-num">${d}</span>
      ${list.length ? `<span class="cal-marks">${watchChip(list[0], 24)}${list.length > 1 ? `<span class="cal-more">+${list.length - 1}</span>` : ''}</span>` : ''}
    </button>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.cal-cell[data-day]').forEach(c => c.addEventListener('click', () => openDaySheet(c.dataset.day)));

  // Day-by-day list for the month (newest first)
  const days = [];
  for (let d = daysInMonth; d >= 1; d--) {
    const key = prefix + String(d).padStart(2, '0');
    if (byDay.has(key)) days.push([key, byDay.get(key)]);
  }
  document.getElementById('cal-days').innerHTML = days.map(([key, list]) => {
    const dt = new Date(key + 'T12:00');
    return `<button class="cal-day-row" data-day="${key}">
      <span class="cal-day-date"><b>${dt.getDate()}</b>${dt.toLocaleDateString('es-ES', { weekday: 'short' })}</span>
      <span class="cal-day-watches">${list.map(w => `<span class="cal-day-watch">${watchChip(w, 22)}${escHtml(w.brand)} ${escHtml(w.model)}${w.wearStart && key === todayKey ? ' <span class="cal-live">● ahora</span>' : ''}</span>`).join('')}</span>
    </button>`;
  }).join('');
  document.querySelectorAll('#cal-days .cal-day-row').forEach(r => r.addEventListener('click', () => openDaySheet(r.dataset.day)));
}
window.renderCalendar = renderCalendar;

function shiftCalendarMonth(delta) {
  const base = _calMonth || new Date();
  _calMonth = new Date(base.getFullYear(), base.getMonth() + delta, 1);
  renderCalendar();
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('cal-prev')?.addEventListener('click', () => shiftCalendarMonth(-1));
  document.getElementById('cal-next')?.addEventListener('click', () => shiftCalendarMonth(1));
  // Swipe left/right on the grid to change month
  const g = document.getElementById('cal-grid');
  let x0 = null;
  g?.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  g?.addEventListener('touchend', e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 60) shiftCalendarMonth(dx < 0 ? 1 : -1);
  });
});

/* ── Day sheet: what was worn that day; add or remove watches ── */
function openDaySheet(key) {
  const dt = new Date(key + 'T12:00');
  const raw = dt.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const title = raw.charAt(0).toUpperCase() + raw.slice(1);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'display:flex;z-index:400;';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', title);
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); renderCalendar(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  function paint() {
    const worn = (wornByDay().get(key) || []);
    const wornIds = new Set(worn.map(w => w.id));
    const others = getWatches().filter(w => !wornIds.has(w.id));
    overlay.innerHTML = `
      <div class="modal-sheet" style="padding-bottom:max(20px,env(safe-area-inset-bottom));">
        <div class="modal-handle"></div>
        <div class="modal-title">${escHtml(title)}</div>
        <div class="day-section">${worn.length ? 'Llevaste' : 'Ningún reloj apuntado este día'}</div>
        ${worn.map(w => `
          <div class="day-row">
            ${watchChip(w, 34)}
            <span class="day-name"><b>${escHtml(w.brand)}</b> ${escHtml(w.model)}</span>
            <button class="day-btn day-remove" data-remove="${escHtml(w.id)}" aria-label="Quitar ${escHtml(w.brand)} ${escHtml(w.model)} de este día">
              <i class="ti ti-x" aria-hidden="true"></i></button>
          </div>`).join('')}
        ${others.length ? `<div class="day-section">Añadir un reloj a este día</div>
        <div class="day-add">${others.map(w => `
          <button class="day-pick" data-add="${escHtml(w.id)}">${watchChip(w, 28)}<span>${escHtml(w.brand)} ${escHtml(w.model)}</span></button>`).join('')}</div>` : ''}
        <button class="modal-btn modal-btn-cancel" style="width:100%;margin-top:14px;" data-close>Hecho</button>
      </div>`;
    overlay.querySelector('[data-close]').addEventListener('click', close);
    overlay.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
      if (addWearDays(b.dataset.add, dt.getTime())) { showToast('Apuntado'); paint(); }
      else showToast('No se pueden apuntar días futuros');
    }));
    overlay.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
      const r = removeWearDay(b.dataset.remove, dt.getTime());
      if (r === 'active') showToast('Es la sesión en curso: quítate el reloj desde su ficha');
      else { showToast('Quitado de este día'); paint(); }
    }));
  }
  paint();
}
window.openDaySheet = openDaySheet;
