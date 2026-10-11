/* ─────────────────── HISTORY ─────────────────── */

let _historyMode   = 'calendar'; // 'calendar' | 'ranking' | 'detail'
let _calMonth      = null;       // Date set to the 1st of the month shown
let _histYear      = 'all';      // year filter shared by ranking and "por reloj": 'all' | 2026…

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
  return { cat: 'Otros', icon: 'ti-device-watch', color: '#C9BFAE' };
}

/* ── Mode toggle ── */
function setHistoryMode(mode, fromUser = false) {
  // Tapping a mode while a watch panel is open leaves the panel
  if (fromUser && history.state?.hw) navReplace({ view: 'history' });
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

/* ── Main renderHistory entry point ── */
function renderHistory() {
  // Coming back (gesture) from a watch panel: restore the mode we left
  const hm = history.state?.hmode;
  if (hm && !history.state?.hw) _historyMode = hm;
  setHistoryMode(_historyMode);
}

/* ── Shared year filter (ranking and "por reloj") ── */
function histYears() {
  const ys = new Set([new Date().getFullYear()]);
  getWatches().forEach(w => wornDayKeys(w).forEach(k => ys.add(Number(k.slice(0, 4)))));
  return [...ys].sort((a, b) => b - a);
}
/** Distinct worn days of a watch in the selected period ('all' or a year) */
function daysIn(w, year = _histYear) {
  const keys = [...wornDayKeys(w)];
  return year === 'all' ? keys.length : keys.filter(k => k.startsWith(year + '-')).length;
}
function periodLabel(year = _histYear) { return year === 'all' ? 'desde el principio' : `en ${year}`; }
function yearChipsHTML() {
  const ys = histYears();
  if (_histYear !== 'all' && !ys.includes(_histYear)) _histYear = 'all';
  const chip = (v, txt) => `<button class="year-chip${_histYear === v ? ' active' : ''}" data-year="${v}" aria-pressed="${_histYear === v}">${txt}</button>`;
  return `<div class="year-chips" role="group" aria-label="Filtrar por año">${chip('all', 'Todo')}${ys.map(y => chip(y, y)).join('')}</div>`;
}
function bindYearChips(root, rerender) {
  root.querySelectorAll('.year-chip').forEach(b => b.addEventListener('click', () => {
    _histYear = b.dataset.year === 'all' ? 'all' : Number(b.dataset.year);
    rerender();
  }));
}
const EMPTY_HISTORY = `<div class="history-empty"><i class="ti ti-clock" style="font-size:40px;color:var(--mid);"></i><br><br>No hay relojes</div>`;

/* ══════════════════════════════════════════════
   RANKING VIEW — top 10 by days worn + the 3 least used
══════════════════════════════════════════════ */
function renderRanking() {
  const body = document.getElementById('ranking-body');
  if (!body) return;
  const ws = getWatches();
  if (!ws.length) { body.innerHTML = EMPTY_HISTORY; return; }

  const data = ws.map(w => ({ w, days: daysIn(w) }))
    .sort((a, b) => b.days - a.days || `${a.w.brand} ${a.w.model}`.localeCompare(`${b.w.brand} ${b.w.model}`));
  const used = data.filter(d => d.days > 0);
  const top  = used.slice(0, 10);
  const max  = top[0]?.days || 1;
  const dayset = new Set();   // distinct days with any watch (two watches the same day count once)
  ws.forEach(w => wornDayKeys(w).forEach(k => { if (_histYear === 'all' || k.startsWith(_histYear + '-')) dayset.add(k); }));
  const total = dayset.size;

  const rows = top.map((d, i) => {
    const pct = Math.max(4, Math.round(d.days / max * 100));
    return `<button class="rk-row" data-wid="${escHtml(d.w.id)}" aria-label="${i + 1}. ${escHtml(d.w.brand)} ${escHtml(d.w.model)}: ${d.days} ${d.days === 1 ? 'día' : 'días'}">
      <span class="rk-pos${i < 3 ? ' podium' : ''}">${i + 1}</span>
      ${watchChip(d.w, 40)}
      <span class="rk-main">
        <span class="rk-name"><b>${escHtml(d.w.brand)}</b> ${escHtml(d.w.model)}${d.w.wearStart ? ' <span class="cal-live">●</span>' : ''}</span>
        <span class="rk-bar"><span style="width:${pct}%"></span></span>
      </span>
      <span class="rk-val"><b>${d.days}</b>${d.days === 1 ? 'día' : 'días'}</span>
    </button>`;
  }).join('');

  // Least used: watches in rotation outside the top 10, fewest days first
  const topIds = new Set(top.map(d => d.w.id));
  const least = data.filter(d => d.w.rotation !== false && !topIds.has(d.w.id))
    .sort((a, b) => a.days - b.days).slice(0, 3);
  const leastHTML = least.length ? `
    <div class="rk-least">
      <div class="rk-least-title">Menos usados ${periodLabel()}</div>
      ${least.map(d => `<button class="rk-least-item" data-wid="${escHtml(d.w.id)}">${watchChip(d.w, 26)}
        <span>${escHtml(d.w.brand)} ${escHtml(d.w.model)}</span><em>${d.days ? `${d.days} d` : 'sin uso'}</em></button>`).join('')}
    </div>` : '';

  body.innerHTML = yearChipsHTML() + (top.length
    ? `<div class="rk-head">${total} ${total === 1 ? 'día' : 'días'} con reloj ${periodLabel()} · top ${top.length}</div>${rows}`
    : `<div class="history-empty" style="padding:32px 8px;">Sin usos apuntados ${periodLabel()}.</div>`) + leastHTML;
  bindYearChips(body, renderRanking);
  body.querySelectorAll('[data-wid]').forEach(b => b.addEventListener('click', () => openHistWatch(b.dataset.wid)));
}

/* ══════════════════════════════════════════════
   POR RELOJ — grid of 4 per row → watch panel
══════════════════════════════════════════════ */
function openHistWatch(id) {
  // Remember the mode we come from, so "back" returns there
  navReplace({ ...(history.state || {}), view: 'history', hmode: _historyMode });
  navPush({ view: 'history', hw: id });
  setHistoryMode('detail');
}
window.openHistWatch = openHistWatch;

function renderHistoryDetail() {
  const body = document.getElementById('history-body');
  if (!body) return;
  const hw = history.state?.hw;
  if (hw && getWatch(hw)) { historySelectedWatch = hw; renderHistoryBody(); return; }
  const ws = getWatches();
  if (!ws.length) { body.innerHTML = EMPTY_HISTORY; return; }
  const data = ws.map(w => ({ w, days: daysIn(w) }))
    .sort((a, b) => b.days - a.days || `${a.w.brand} ${a.w.model}`.localeCompare(`${b.w.brand} ${b.w.model}`));
  body.innerHTML = yearChipsHTML() + `<div class="hw-grid">${data.map(({ w, days }) => {
    const cat = inferCategory(w);
    const img = isSafePhoto(w.photo)
      ? `<img src="${w.photo}" alt="" loading="lazy">`
      : `<span class="hw-ini" style="--chip:${cat.color}">${escHtml(watchInitials(w))}</span>`;
    return `<button class="hw-card${days ? '' : ' unused'}" data-wid="${escHtml(w.id)}" aria-label="${escHtml(w.brand)} ${escHtml(w.model)}: ${days} ${days === 1 ? 'día' : 'días'}">
      <span class="hw-photo">${img}<span class="hw-badge">${days}</span></span>
      <span class="hw-brand">${escHtml(w.brand)}</span>
      <span class="hw-model">${escHtml(w.model)}</span>
    </button>`;
  }).join('')}</div>`;
  bindYearChips(body, renderHistoryDetail);
  body.querySelectorAll('.hw-card').forEach(c => c.addEventListener('click', () => openHistWatch(c.dataset.wid)));
}

function renderHistoryBody() {
  const w    = getWatch(historySelectedWatch);
  const body = document.getElementById('history-body');
  if (!body || !w) return;
  const year = _histYear;
  const inPeriod = k => year === 'all' || k.startsWith(year + '-');
  const allKeys = [...wornDayKeys(w)];
  const keys = allKeys.filter(inPeriod);
  const st = wearStats(w);

  // Share of the days with any watch logged in the period
  const anyDays = new Set();
  getWatches().forEach(x => wornDayKeys(x).forEach(k => { if (inPeriod(k)) anyDays.add(k); }));
  const share = anyDays.size ? Math.round(keys.length / anyDays.size * 100) : 0;
  const last = st.daysSinceLast === null ? 'Nunca' : st.active ? 'Ahora' : st.daysSinceLast === 0 ? 'Hoy'
             : st.daysSinceLast === 1 ? 'Ayer' : st.daysSinceLast < 60 ? `Hace ${st.daysSinceLast} d`
             : st.daysSinceLast < 730 ? `Hace ${Math.round(st.daysSinceLast / 30.4)} meses` : `Hace ${Math.floor(st.daysSinceLast / 365)} años`;

  // Bars: months of the year, or one bar per year for "Todo"
  let bars;
  if (year === 'all') {
    const ys = [...new Set(allKeys.map(k => Number(k.slice(0, 4))))].sort();
    bars = ys.map(y => ({ label: String(y), n: allKeys.filter(k => k.startsWith(y + '-')).length }));
  } else {
    bars = MONTHS_ES.map((m, i) => ({ label: m.slice(0, 1).toUpperCase(),
      n: keys.filter(k => k.slice(5, 7) === String(i + 1).padStart(2, '0')).length, title: m }));
  }
  const bmax = Math.max(1, ...bars.map(b => b.n));
  const barsHTML = bars.length ? `<div class="hw-bars" role="img" aria-label="Días de uso por ${year === 'all' ? 'año' : 'mes'}">${bars.map(b =>
    `<div class="hw-bar" title="${escHtml(b.title || b.label)}: ${b.n}"><span class="hw-bar-n">${b.n || ''}</span>
      <span class="hw-bar-fill" style="height:${b.n ? Math.max(6, Math.round(b.n / bmax * 100)) : 0}%"></span>
      <span class="hw-bar-l">${b.label}</span></div>`).join('')}</div>` : '';

  // Intervals in the period, grouped by month (newest first)
  const all = wearIntervals(w).filter(i => year === 'all' || new Date(i.start).getFullYear() === year).reverse();
  const byMonth = new Map();
  all.forEach(i => {
    const d = new Date(i.start);
    const m = `${MONTHS_ES[d.getMonth()]}${year === 'all' ? ' ' + d.getFullYear() : ''}`;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(i);
  });
  const monthsHTML = all.length ? [...byMonth.entries()].map(([month, intervals]) => `
    <div class="month-group">
      <div class="month-label">${month}</div>
      ${intervals.map(i => {
        const days = calendarDaysBetween(i.start, i.end) + 1;
        const dates = days === 1 ? formatDate(i.start) : `${formatDate(i.start)} → ${i.active ? 'ahora' : formatDate(i.end)}`;
        const dur = i.active ? elapsedSince(i.start) : `${days} ${days === 1 ? 'día' : 'días'}`;
        return `<div class="interval-row">
          <div class="interval-dates">${dates}</div>
          <div class="interval-duration">${dur}${i.active ? ' <span style="color:var(--ok)">●</span>' : ''}</div>
          ${i.active ? '' : `<button class="interval-edit" data-idx="${i.idx}" aria-label="Editar o borrar este uso"><i class="ti ti-pencil" aria-hidden="true"></i></button>`}
        </div>`;
      }).join('')}
    </div>`).join('')
    : `<div class="history-empty" style="padding:24px 8px;"><i class="ti ti-calendar-x" style="font-size:32px;color:var(--mid);"></i><br><br>Sin usos ${periodLabel()}</div>`;

  body.innerHTML = `
    <button class="hw-back" id="hw-back"><i class="ti ti-chevron-left" aria-hidden="true"></i> Todos los relojes</button>
    <div class="hw-head">
      ${watchChip(w, 56)}
      <div><div class="hw-head-brand">${escHtml(w.brand)}</div><div class="hw-head-model">${escHtml(w.model)}</div></div>
      <button class="hw-open" id="hw-open" aria-label="Abrir la ficha del reloj"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>
    </div>
    ${yearChipsHTML()}
    <div class="hw-stats">
      <div class="spec-card"><div class="spec-label">Días de uso</div><div class="spec-value">${keys.length}</div></div>
      <div class="spec-card"><div class="spec-label">De tus días</div><div class="spec-value">${share}%</div></div>
      <div class="spec-card"><div class="spec-label">Última vez</div><div class="spec-value">${last}</div></div>
    </div>
    ${barsHTML}
    <button class="chip-btn" id="hist-add" style="margin:4px 0 14px;"><i class="ti ti-calendar-plus" aria-hidden="true"></i> Apuntar un uso</button>
    ${monthsHTML}`;
  bindYearChips(body, renderHistoryBody);
  body.querySelector('#hw-back').addEventListener('click', () => history.back());
  body.querySelector('#hw-open').addEventListener('click', () => openDetail(w.id));
  body.querySelector('#hist-add').addEventListener('click', () => openWearSheet(w.id));
  body.querySelectorAll('.interval-edit').forEach(b =>
    b.addEventListener('click', () => openWearSheet(w.id, Number(b.dataset.idx))));
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
    ? `<img class="cal-chip" src="${w.photo}" alt="" width="${size}" height="${size}" style="--s:${size}px">`
    : `<span class="cal-chip cal-chip-txt" style="--chip:${cat.color};--s:${size}px">${escHtml(watchInitials(w))}</span>`;
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
  overlay._close = close;
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
      const w = getWatch(b.dataset.remove);
      if (w?.wearStart && startOfDay(w.wearStart) <= startOfDay(dt.getTime())) {
        showToast('Es la sesión en curso: quítate el reloj desde su ficha'); return;
      }
      showConfirm('¿Quitar de este día?', `El ${w.brand} ${w.model} dejará de contar como usado el ${raw}.`, () => {
        const r = removeWearDay(w.id, dt.getTime());
        if (r === 'active') showToast('Es la sesión en curso: quítate el reloj desde su ficha');
        else { showToast('Quitado de este día'); paint(); }
      }, { okLabel: 'Quitar' });
    }));
  }
  paint();
}
window.openDaySheet = openDaySheet;
