/* ─── HOME ─── */
import { FAMILIES, MOMENTS, currentSeason, familyById, guessFamily, momentById, addWearDays, calendarDaysBetween, dayKey, deleteHistoryEntry, deleteWatch, getActiveWatch, getWatch, getWatches, photoSrc, maintenanceAlerts, setWatchFlag, startWearing, stopWearing, switchToWatch, updateHistoryEntry, updateWatch, wearStats, wornDayKeys } from '../storage.js';
import { openSheet, showConfirm } from './sheet.js';
import { dialArt, elapsedShort, elapsedSince, escHtml, formatDate, showToast, showView, typeLabel, ui } from './core.js';
import { openEditModal } from './modals.js';
import { intervalsHTML, renderHistory, watchChip } from './history.js';
import { renderBackupReminder } from './settings.js';
import { importEnabled, importIntoWatch } from './url-import.js';
import { lang, locale, money, t } from '../i18n.js';
import { INSPIRATION } from '../data/inspiration.js';
import { renderCare, renderStraps } from './care.js';

const name = w => `${escHtml(w.brand)} ${escHtml(w.model)}`;
const daysTxt = n => n === 1 ? t('1 día') : t('{n} días', { n });

export function renderHome() {
  const grid  = document.getElementById('watches-grid');
  const empty = document.getElementById('empty-state');
  if (!grid || !empty) return;   // DOM not ready yet
  const ws    = getWatches();
  const activeW = getActiveWatch();

  // Header: how many watches and how much they cost (only those with a price)
  const sub = document.getElementById('home-subtitle');
  if (sub) {
    const spent = ws.reduce((s, w) => s + (Number(w.purchasePrice) > 0 ? Number(w.purchasePrice) : 0), 0);
    sub.textContent = !ws.length ? t('Tu colección de relojes')
      : (ws.length === 1 ? t('1 reloj') : t('{n} relojes', { n: ws.length }))
        + (spent ? ' · ' + t('{v} invertidos', { v: money(spent, { decimals: 0 }) }) : '');
  }
  renderInspiration();
  if (typeof renderBackupReminder === 'function') renderBackupReminder();

  renderToday(ws, activeW);

  if (!ws.length) {
    const ff = document.getElementById('family-filter'); if (ff) ff.innerHTML = '';
    grid.style.display = 'none';
    empty.style.display = 'flex';
    const rb = document.getElementById('recommendation-banner'); if (rb) rb.innerHTML = '';
    return;
  }
  grid.style.display = 'grid';
  empty.style.display = 'none';

  renderRecommendation(ws, activeW);

  const shown = renderFamilyFilter(ws);
  grid.innerHTML = shown.map(w => {
    const isActive = !!w.wearStart;
    return `
      <div class="watch-card${isActive ? ' active-card' : ''}" data-id="${escHtml(w.id)}" role="button" tabindex="0" aria-label="${name(w)}${isActive ? ' — ' + t('puesto ahora') : ''}">
        <div class="watch-img-wrap">
          ${photoSrc(w.id)
            ? `<img src="${photoSrc(w.id)}" alt="" loading="lazy">`
            : `<div class="watch-img-placeholder">${dialArt()}</div>`}
          <div class="watch-type-badge">${typeLabel(w.type)}</div>
          ${isActive ? `<div class="active-badge">${t('Puesto')}</div>` : ''}
          ${w.favorite ? `<div class="fav-badge" aria-label="${t('Favorito')}"><i class="ti ti-star" aria-hidden="true"></i></div>` : ''}
          ${maintenanceAlerts(w).length ? `<div class="alert-badge" aria-label="${t('Necesita mantenimiento')}"><i class="ti ti-tool" aria-hidden="true"></i></div>` : ''}
        </div>
        <div class="watch-info">
          <div class="watch-brand">${escHtml(w.brand)}</div>
          <div class="watch-model">${escHtml(w.model)}</div>
          ${isActive ? `<div class="days-badge">${elapsedShort(w.wearStart)}</div>` : `<div class="last-worn">${shortLastWorn(w)}</div>`}
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.watch-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(card.dataset.id); }
    });
  });
}

/* ─── «Hoy llevo…»: the main action of the app is one tap ─── */
export function wornTodayList(ws = getWatches()) {
  const k = dayKey(Date.now());
  return ws.filter(w => wornDayKeys(w).has(k));
}
export function renderToday(ws, activeW) {
  const box = document.getElementById('today-card');
  if (!box) return;
  if (!ws.length) { box.innerHTML = ''; return; }
  const today = wornTodayList(ws);
  if (activeW) {
    box.innerHTML = `<div class="today-card is-live">
      <div class="today-main" role="button" tabindex="0" data-open="${escHtml(activeW.id)}">
        <span class="today-label"><span class="live-dot" aria-hidden="true"></span>${t('Llevas ahora')}</span>
        <span class="today-name">${name(activeW)}</span>
        <span class="today-sub">${elapsedSince(activeW.wearStart)}</span>
      </div>
      <button class="today-btn ghost" id="today-change">${t('Cambiar')}</button>
    </div>`;
  } else if (today.length) {
    box.innerHTML = `<div class="today-card is-done">
      <div class="today-main">
        <span class="today-label"><i class="ti ti-circle-check" aria-hidden="true"></i>${t('Hoy has llevado')}</span>
        <span class="today-name">${today.map(name).join(' · ')}</span>
      </div>
      <button class="today-btn" id="today-change"><i class="ti ti-hand-finger" aria-hidden="true"></i>${t('Me pongo…')}</button>
    </div>`;
  } else {
    box.innerHTML = `<div class="today-card">
      <div class="today-main">
        <span class="today-label">${t('Hoy')}</span>
        <span class="today-name muted">${t('¿Qué reloj llevas?')}</span>
      </div>
      <button class="today-btn" id="today-change"><i class="ti ti-hand-finger" aria-hidden="true"></i>${t('Me pongo…')}</button>
    </div>`;
  }
  box.querySelector('#today-change')?.addEventListener('click', openTodaySheet);
  const open = box.querySelector('[data-open]');
  if (open) {
    open.addEventListener('click', () => openDetail(open.dataset.open));
    open.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(open.dataset.open); } });
  }
}

/** Sheet «¿Qué reloj llevas?»: one watch on the wrist at a time. Picking one puts it on (the
    previous one goes to the history); rotation order first, the one that is due on top. */
export function openTodaySheet() {
  const sh = openSheet({ label: t('¿Qué reloj llevas?'), html: '', onClose: () => renderHome() });
  const ws = getWatches();
  const active = getActiveWatch();
  const ranked = rankWatchesForRotation(ws).map(r => r.watch);
  const rest = ws.filter(w => !ranked.includes(w))
    .sort((a, b) => `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`));
  const todayIds = new Set(wornTodayList(ws).map(w => w.id));
  const dueId = ranked.find(w => !todayIds.has(w.id))?.id;
  const row = w => {
    const on = active?.id === w.id;
    const sub = on ? `<em>${t('Puesto ahora')}</em> · ${escHtml(elapsedShort(w.wearStart))}`
      : `${w.id === dueId ? `<em>${t('Más tiempo en la caja')}</em> · ` : ''}${escHtml(shortLastWorn(w))}`;
    return `<button class="today-pick${on ? ' on' : ''}" data-id="${escHtml(w.id)}" role="radio" aria-checked="${on}">
      ${watchChip(w, 40)}
      <span class="today-pick-txt"><b>${name(w)}</b><small>${sub}</small></span>
      <i class="ti ${on ? 'ti-circle-check' : 'ti-circle'}" aria-hidden="true"></i>
    </button>`;
  };
  sh.setContent(`<div class="modal-title">${t('¿Qué reloj llevas?')}</div>
    <div class="sheet-text">${t('Toca el que llevas ahora. Si cambias de reloj, el anterior se guarda en el historial.')}</div>
    <div class="today-list" role="radiogroup">${[active, ...[...ranked, ...rest].filter(w => w !== active)].filter(Boolean).map(row).join('')}</div>
    <div class="modal-actions">
      ${active ? `<button class="modal-btn modal-btn-cancel" id="today-off"><i class="ti ti-player-stop" aria-hidden="true"></i> ${t('Me lo he quitado')}</button>` : ''}
      <button class="modal-btn modal-btn-save" data-close>${t('Hecho')}</button>
    </div>`);
  sh.$$('.today-pick').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.id !== active?.id) handleSwitchWearing(b.dataset.id, { reopen: false });
    sh.close();
  }));
  sh.$('#today-off')?.addEventListener('click', () => {
    if (stopWearing(active.id)) showToast(t('Guardado en el historial'));
    stopActiveTimer();
    sh.close();
  });
}

/* ─── Welcome: a different watch-history fact (or idea) every time the app opens ───
   Chosen once per opening, never the same as the previous one; × hides it until next time. */
const INSP_KEY = 'rotor_inspiration_last';
let _insp = null, _inspClosed = false;
function pickInspiration() {
  let last = -1;
  try { last = Number(localStorage.getItem(INSP_KEY) ?? -1); } catch {}
  let i = Math.floor(Math.random() * INSPIRATION.length);
  if (i === last) i = (i + 1) % INSPIRATION.length;
  try { localStorage.setItem(INSP_KEY, String(i)); } catch {}
  return INSPIRATION[i];
}
export function renderInspiration() {
  const el = document.getElementById('inspiration-card');
  if (!el) return;
  if (_inspClosed) { el.innerHTML = ''; return; }
  if (location.hostname === 'delfos-iq.github.io') {   // the old address: point to the new one instead
    el.innerHTML = `<aside class="insp-card moved-card" aria-label="${t('Rotor tiene una dirección nueva')}">
      <div class="insp-year" aria-hidden="true"><i class="ti ti-world"></i></div>
      <div><p class="insp-text"><b>${t('Rotor tiene una dirección nueva.')}</b> ${t('Esta dirección antigua ya no se usa: con un toque llevamos tus relojes a la nueva.')}</p>
      <button type="button" class="moved-link" data-action="openMoveSheet">${t('Llevar mis relojes')} <i class="ti ti-chevron-right" aria-hidden="true"></i></button></div>
      <button type="button" class="insp-close" aria-label="${t('Cerrar')}"><i class="ti ti-x" aria-hidden="true"></i></button>
    </aside>`;
    el.querySelector('.insp-close').addEventListener('click', () => { _inspClosed = true; el.innerHTML = ''; });
    return;
  }
  _insp ||= pickInspiration();
  const text = _insp[lang()] || _insp.es;
  el.innerHTML = `<aside class="insp-card" aria-label="${t('Historia de la relojería')}">
    <div class="insp-year" aria-hidden="true">${_insp.y ? escHtml(_insp.y) : '<i class="ti ti-sparkles"></i>'}</div>
    <p class="insp-text">${escHtml(text)}</p>
    <button type="button" class="insp-close" aria-label="${t('Cerrar')}"><i class="ti ti-x" aria-hidden="true"></i></button>
  </aside>`;
  el.querySelector('.insp-close').addEventListener('click', () => { _inspClosed = true; el.innerHTML = ''; });
}

/* ─── Recommendation banner ───
   No «el que toca»: the collector wears what inspires them today. Rotor proposes
   watches for the chosen moment (occasion, mood, season), puts the ones that suit
   the current season first and reminds which one has been in the box the longest.
   Hidden once something is logged for today. */
let _moment = null;   // chip chosen in this session (not kept: every opening starts fresh)
let _surprise = null; // «Sorpréndeme»: a watch picked at random from the rotation

export function renderRecommendation(ws, activeW) {
  const banner = document.getElementById('recommendation-banner');
  if (!banner) return;
  if (activeW || wornTodayList(ws).length) { banner.innerHTML = ''; return; }

  const pool = rankWatchesForRotation(ws).filter(r => r.stats.daysSinceLast !== 0);
  if (!pool.length) { banner.innerHTML = ''; return; }

  const used = MOMENTS.filter(m => pool.some(r => r.watch.moments?.includes(m.id)));
  if (_moment && !used.some(m => m.id === _moment)) _moment = null;
  const season = currentSeason();
  const fitsSeason = r => (r.watch.moments?.includes(season) ? 1 : 0);

  let list, label;
  if (_surprise && !pool.some(r => r.watch.id === _surprise)) _surprise = null;
  if (_surprise) {
    list = [pool.find(r => r.watch.id === _surprise)];
    label = t('Al azar');
  } else if (_moment) {
    list = pool.filter(r => r.watch.moments?.includes(_moment));
    label = t('Para «{m}»', { m: t(momentById(_moment).label) });
  } else {
    list = [...pool].sort((a, b) => fitsSeason(b) - fitsSeason(a));   // stable: idle order kept inside
    label = list.some(fitsSeason) ? t('Para hoy · {s}', { s: t(momentById(season).label).toLowerCase() }) : t('Para hoy');
  }
  const idlest = pool[0];

  const chips = used.length
    ? `<div class="rec-moods" role="group" aria-label="${t('¿Qué te apetece hoy?')}">
        <span class="rec-moods-q">${t('¿Qué te apetece hoy?')}</span>
        <div class="rec-chips">${used.map(m => `<button type="button" class="rec-chip" data-moment="${m.id}" aria-pressed="${m.id === _moment}">
          <i class="ti ${m.icon}" aria-hidden="true"></i>${t(m.label)}</button>`).join('')}</div>
      </div>`
    : (ws.length >= 2 ? `<div class="rec-hint"><i class="ti ti-sparkles" aria-hidden="true"></i>${t('Marca en cada reloj sus momentos (ocasión, ánimo, estación) y Rotor te propondrá opciones según tu día.')}</div>` : '');

  if (!list.length) {
    banner.innerHTML = chips;
    bindChips(banner, ws, activeW);
    return;
  }
  const [top, ...rest] = list;
  const w = top.watch;
  const others = rest.slice(0, 2).map(r => name(r.watch));
  const showIdle = idlest && idlest.watch.id !== w.id;
  banner.innerHTML = `${chips}
    <div class="recommendation-card" role="button" tabindex="0" aria-label="${t('Recomendación')}: ${name(w)}">
      <div class="rec-icon"><i class="ti ${_surprise ? 'ti-sparkles' : _moment ? momentById(_moment).icon : 'ti-sparkles'}" aria-hidden="true"></i></div>
      <div class="rec-body">
        <div class="rec-label">${label}</div>
        <div class="rec-watch">${name(w)}${w.favorite ? ` <i class="ti ti-star" aria-label="${t('Favorito')}"></i>` : ''}</div>
        <div class="rec-reason">${formatLastWorn(top.stats)}</div>
        ${others.length ? `<div class="rec-others">${t('También')}: ${others.join(' · ')}</div>` : ''}
      </div>
      <button class="rec-wear" id="rec-wear" aria-label="${t('Ponérmelo')}: ${name(w)}"><i class="ti ti-hand-finger" aria-hidden="true"></i><span>${t('Ponérmelo')}</span></button>
    </div>
    ${pool.length > 1 ? `<button type="button" class="rec-idle rec-dice" id="rec-dice"><i class="ti ti-sparkles" aria-hidden="true"></i>
      <span>${_surprise ? t('Otro al azar') : t('Sorpréndeme: uno al azar')}</span></button>` : ''}
    ${showIdle && !_surprise ? `<button type="button" class="rec-idle" id="rec-idle"><i class="ti ti-hourglass" aria-hidden="true"></i>
      <span>${t('Más tiempo en la caja')}: <b>${name(idlest.watch)}</b> · ${formatLastWorn(idlest.stats).toLowerCase()}</span></button>` : ''}`;
  const card = banner.querySelector('.recommendation-card');
  card.addEventListener('click', () => openDetail(w.id));
  card.addEventListener('keydown', e => { if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(w.id); } });
  banner.querySelector('#rec-wear').addEventListener('click', e => {
    e.stopPropagation();
    handleSwitchWearing(w.id, { reopen: false });
    renderHome();
  });
  banner.querySelector('#rec-idle')?.addEventListener('click', () => openDetail(idlest.watch.id));
  banner.querySelector('#rec-dice')?.addEventListener('click', () => {
    const choices = pool.filter(r => r.watch.id !== w.id);
    _surprise = choices[Math.floor(Math.random() * choices.length)].watch.id;
    _moment = null;
    renderRecommendation(ws, activeW);
    banner.querySelector('#rec-dice')?.focus();
  });
  bindChips(banner, ws, activeW);
}
function bindChips(banner, ws, activeW) {
  banner.querySelectorAll('.rec-chip').forEach(b => b.addEventListener('click', () => {
    _moment = _moment === b.dataset.moment ? null : b.dataset.moment;
    _surprise = null;
    renderRecommendation(ws, activeW);
    banner.querySelector(`.rec-chip[data-moment="${b.dataset.moment}"]`)?.focus();
  }));
}

/**
 * Order: never worn first, then most days since last worn, then fewer days
 * worn in the last 90 days, then favourites. Watches out of rotation and the
 * one on the wrist are excluded.
 */
export function rankWatchesForRotation(ws, now = Date.now()) {
  return ws
    .filter(w => !w.wearStart && w.rotation !== false)
    .map(w => ({ watch: w, stats: wearStats(w, now) }))
    .sort((a, b) => {
      const da = a.stats.daysSinceLast === null ? Infinity : a.stats.daysSinceLast;
      const db = b.stats.daysSinceLast === null ? Infinity : b.stats.daysSinceLast;
      if (da !== db) return db - da;
      if (a.stats.daysWorn90 !== b.stats.daysWorn90) return a.stats.daysWorn90 - b.stats.daysWorn90;
      return (b.watch.favorite ? 1 : 0) - (a.watch.favorite ? 1 : 0);
    });
}
export function formatLastWorn(st) {
  if (st.lastWorn === null) return t('Todavía no lo has llevado');
  if (st.daysSinceLast === 0) return t('Lo llevaste hoy');
  if (st.daysSinceLast === 1) return t('Lo llevaste ayer');
  return t('{n} días sin salir de la caja', { n: st.daysSinceLast });
}

export function shortLastWorn(w) {
  const st = wearStats(w);
  if (w.rotation === false) return t('Fuera de rotación');
  if (st.lastWorn === null) return t('Sin estrenar');
  if (st.daysSinceLast === 0) return t('Hoy');
  if (st.daysSinceLast === 1) return t('Ayer');
  return t('Hace {n} días', { n: st.daysSinceLast });
}

/** Maintenance alert text (the data layer only gives kind and age) */
export function alertText(a) {
  if (a.kind === 'battery') return t('Pila cambiada hace {n} meses: revísala antes de que se agote y pierda líquido', { n: a.months });
  return a.from === 'purchase'
    ? t('Comprado hace {n} años: toca revisión (cada 5 años aprox.)', { n: a.years })
    : t('Última revisión hace {n} años: toca revisión (cada 5 años aprox.)', { n: a.years });
}

/* ─── DETAIL ─── */
export const DETAIL_TABS = ['summary', 'specs', 'history', 'maint'];
let _detailTab = 'summary';

export function setDetailTab(tab) {
  if (!DETAIL_TABS.includes(tab)) tab = 'summary';
  _detailTab = tab;
  for (const k of DETAIL_TABS) {
    const on = k === tab;
    const b = document.getElementById('dtab-' + k);
    if (b) { b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
    const p = document.getElementById('dt-' + k);
    if (p) p.hidden = !on;
  }
}

export function openDetail(id, tab) {
  const w = getWatch(id);
  if (!w) return;
  // Same watch re-rendered: keep the tab; a different watch starts on Resumen
  if (tab) _detailTab = tab;
  else if (ui.currentWatchId !== id) _detailTab = 'summary';
  ui.currentWatchId = id;

  document.getElementById('d-brand').textContent = w.brand;
  document.getElementById('d-name').textContent  = w.model + (w.ref ? ` · ${w.ref}` : '');

  const img = document.getElementById('d-img');
  const ph  = document.getElementById('d-img-placeholder');
  const src = photoSrc(w.id);
  if (src) {
    img.src = src; img.style.display = 'block'; ph.style.display = 'none';
  } else {
    img.style.display = 'none'; ph.style.display = 'flex'; ph.innerHTML = dialArt();
  }
  ph.parentElement?.classList.toggle('no-photo', !src);

  const wearBox = document.getElementById('d-wear-info');
  if (w.wearStart) {
    wearBox.style.display = 'block';
    updateDayCounter(w);
  } else {
    wearBox.style.display = 'none';
  }

  renderDetailActions(w);
  renderUsage(w);
  renderSpecs(w);
  renderPrice(w);
  renderDetailHistory(w);
  renderMaintenance(w);
  const refresh = () => openDetail(w.id);
  renderCare(w, document.getElementById('d-care'), refresh);
  renderStraps(w, document.getElementById('d-straps'), refresh);

  const notesEl = document.getElementById('d-notes-val');
  if (notesEl) notesEl.textContent = w.notes || '—';

  setDetailTab(_detailTab);
  showView('detail');
  startActiveTimer(id);

  // Wire static buttons AFTER showView so they're in the visible DOM
  // Clone to remove any previous listeners, then re-attach
  const deleteBtn = document.querySelector('.btn-delete');
  if (deleteBtn) {
    const fresh = deleteBtn.cloneNode(true);
    deleteBtn.replaceWith(fresh);
    fresh.addEventListener('click', () => handleDeleteWatch(w.id));
  }
  const editBtn = document.querySelector('.btn-edit');
  if (editBtn) {
    const fresh = editBtn.cloneNode(true);
    editBtn.replaceWith(fresh);
    fresh.addEventListener('click', () => openEditModal(w.id));
  }
}

/* Arrow keys move between the detail tabs (ARIA tabs pattern) */
document.addEventListener('keydown', e => {
  const tab = e.target?.closest?.('.detail-tab');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const i = DETAIL_TABS.indexOf(_detailTab);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? DETAIL_TABS.length - 1
    : (i + (e.key === 'ArrowRight' ? 1 : -1) + DETAIL_TABS.length) % DETAIL_TABS.length;
  setDetailTab(DETAIL_TABS[next]);
  document.getElementById('dtab-' + DETAIL_TABS[next])?.focus();
});

export function updateDayCounter(w) {
  const el = document.getElementById('d-days');
  const se = document.getElementById('d-since');
  if (el) el.textContent = elapsedSince(w.wearStart);
  if (se) {
    const startTime = new Date(w.wearStart).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    se.textContent = t('Desde el {d} a las {h}', { d: formatDate(w.wearStart), h: startTime });
  }
}
export function startActiveTimer(id) {
  stopActiveTimer();
  const w = getWatch(id);
  if (!w?.wearStart) return;
  // Update every 60 seconds — fine enough for h/min display
  ui.activeTimer = setInterval(() => {
    const c = getWatch(id);
    if (!c?.wearStart) { stopActiveTimer(); return; }
    updateDayCounter(c);
    const badge = document.querySelector(`.watch-card[data-id="${id}"] .days-badge`);
    if (badge) badge.textContent = elapsedShort(c.wearStart);
  }, 60000);
}
export function stopActiveTimer() {
  if (ui.activeTimer) { clearInterval(ui.activeTimer); ui.activeTimer = null; }
}

/* Main action: «Ponérmelo». Only one watch is on the wrist at a time: putting one on takes the
   previous one off (its time goes to the history) and starts counting for this one. */
export function renderDetailActions(w) {
  const div = document.getElementById('d-actions');
  const activeW = getActiveWatch();
  const todayDone = wornDayKeys(w).has(dayKey(Date.now()));
  let main;
  if (w.wearStart) {
    const since = new Date(w.wearStart).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
    main = `<div class="wearing-now"><span class="live-dot" aria-hidden="true"></span>${calendarDaysBetween(w.wearStart, Date.now()) === 0
              ? t('Lo llevas puesto desde las {h}', { h: since }) : t('Lo llevas puesto desde el {d}', { d: formatDate(w.wearStart) })}</div>
            <button class="action-btn btn-stop" data-act="stop"><i class="ti ti-player-stop" aria-hidden="true"></i> ${t('Quitármelo')}</button>
            <div class="action-hint">${t('El tiempo puesto se guarda en el historial.')}</div>`;
  } else {
    const hint = activeW ? t('Te quitas el {w}: su tiempo se guarda en el historial.', { w: `${activeW.brand} ${activeW.model}` })
      : todayDone ? t('Hoy ya lo llevaste: puedes volver a ponértelo.') : t('Rotor cuenta el tiempo hasta que te lo quites o te pongas otro.');
    main = `<button class="action-btn btn-wear" data-act="wear"><i class="ti ti-hand-finger" aria-hidden="true"></i> ${t('Ponérmelo')}</button>
            <div class="action-hint">${hint}</div>`;
  }
  div.innerHTML = `
    ${main}
    <div class="wear-quick">
      <button class="chip-btn" data-act="past"><i class="ti ti-calendar-plus" aria-hidden="true"></i> ${t('Otro día')}</button>
      <button class="chip-btn${w.favorite ? ' on' : ''}" data-act="fav" aria-pressed="${!!w.favorite}">
        <i class="ti ti-star" aria-hidden="true"></i> ${t('Favorito')}</button>
      <button class="chip-btn${w.rotation === false ? ' on' : ''}" data-act="rotation" aria-pressed="${w.rotation === false}">
        <i class="ti ti-ban" aria-hidden="true"></i> ${t('Fuera de rotación')}</button>
    </div>`;
  div.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
    const act = btn.dataset.act;
    if (act === 'stop')   return handleStopWearing(w.id);
    if (act === 'wear')   return handleSwitchWearing(w.id);
    if (act === 'past') return openWearSheet(w.id);
    if (act === 'fav') { setWatchFlag(w.id, 'favorite', !w.favorite); return openDetail(w.id); }
    if (act === 'rotation') {
      const out = w.rotation !== false;
      setWatchFlag(w.id, 'rotation', !out);
      showToast(out ? t('Fuera de rotación: no se te recomendará') : t('De vuelta en la rotación'));
      return openDetail(w.id);
    }
  }));
}

/* Usage box: days worn, last time, cost per wear, maintenance alerts */
export function renderUsage(w) {
  const el = document.getElementById('d-usage');
  if (!el) return;
  const st = wearStats(w);
  const alerts = maintenanceAlerts(w);
  const cells = [
    { l: t('Días de uso'), v: st.daysWorn },
    { l: t('Últimos 90 días'), v: st.daysWorn90 },
    { l: t('Última vez'), v: st.lastWorn === null ? t('Nunca') : st.daysSinceLast === 0 ? t('Hoy') : st.daysSinceLast === 1 ? t('Ayer') : t('Hace {n} d', { n: st.daysSinceLast }) },
    { l: t('Coste por uso'), v: st.costPerWear !== null ? money(st.costPerWear) : (w.purchasePrice ? '—' : t('Sin precio')), small: st.costPerWear === null && !w.purchasePrice },
  ];
  el.innerHTML = `
    <div class="usage-grid">${cells.map(c => `
      <div class="usage-cell"><div class="usage-val${c.small ? ' is-text' : typeof c.v === 'string' && !/\d/.test(c.v) ? ' is-word' : ''}">${escHtml(String(c.v))}</div><div class="usage-label">${c.l}</div></div>`).join('')}
    </div>
    ${alerts.map(a => `<button class="maint-alert" data-goto="maint"><i class="ti ti-tool" aria-hidden="true"></i><span>${escHtml(alertText(a))}</span></button>`).join('')}`;
  el.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => setDetailTab('maint')));
}

export const SPEC_DEFS = [
  { k: 'calibre', l: 'Calibre' }, { k: 'movimiento', l: 'Movimiento' }, { k: 'cristal', l: 'Cristal' },
  { k: 'brazalete', l: 'Brazalete' }, { k: 'esfera', l: 'Esfera' }, { k: 'caja', l: 'Caja' },
  { k: 'resistencia', l: 'Agua' }, { k: 'reserva', l: 'Reserva' }, { k: 'diametro', l: 'Diámetro' },
  { k: 'grosor', l: 'Grosor' }, { k: 'asas', l: 'Entre asas' },
];

export function renderSpecs(w) {
  const specs = w.specs || {};
  document.getElementById('d-specs').innerHTML = `
    <div class="specs-edit-hint" id="specs-edit-hint">
      <i class="ti ti-pencil" aria-hidden="true"></i>
      ${t('Toca cualquier campo para editarlo')}
    </div>
    ${familyCardHTML(w)}
    ${SPEC_DEFS.map(s => {
      const val = specs[s.k] || '';
      const l = t(s.l);
      return `
      <div class="spec-card${val ? '' : ' spec-empty'}" data-key="${s.k}" role="button" tabindex="0"
           aria-label="${escHtml(t('Editar {campo}: {valor}', { campo: l, valor: val || t('vacío') }))}">
        <div class="spec-label">${l}</div>
        <div class="spec-value" id="spec-val-${s.k}">${val ? escHtml(val) : `<span class="spec-placeholder">${t('Añadir…')}</span>`}</div>
      </div>`;
    }).join('')}`;

  const famCard = document.getElementById('spec-family');
  famCard?.addEventListener('click', () => openFamilySheet(w.id));
  famCard?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFamilySheet(w.id); } });
  document.getElementById('d-specs').querySelectorAll('.spec-card[data-key]').forEach(card => {
    const activate = () => editSpecInline(card.dataset.key, getWatch(ui.currentWatchId));
    card.addEventListener('click', activate);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
  });
  renderSpecsImportBtn(w);
}

export function editSpecInline(key, w) {
  const valEl = document.getElementById('spec-val-' + key);
  if (!valEl) return;
  const current = (w?.specs || {})[key] || '';
  const input = document.createElement('input');
  input.className = 'spec-input-inline';
  input.value = current === '—' ? '' : current;
  input.placeholder = t('Añadir valor…');
  input.setAttribute('aria-label', t(SPEC_DEFS.find(s => s.k === key)?.l || key));
  valEl.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  function commit() {
    if (done) return;          // Enter and the following blur both call commit
    done = true;
    const newVal = input.value.trim();
    const prevVal = (getWatch(w.id)?.specs || {})[key] || '';
    if (newVal !== prevVal) {
      const newSpecs = { ...(getWatch(w.id)?.specs || {}), [key]: newVal };
      updateWatch(w.id, { specs: newSpecs });
    }
    const newEl = document.createElement('div');
    newEl.className = 'spec-value'; newEl.id = 'spec-val-' + key;
    newEl.textContent = newVal || '—';
    input.replaceWith(newEl);
    if (newVal && newVal !== prevVal) showToast(t('Guardado'));
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') {
      done = true;
      const rv = document.createElement('div');
      rv.className = 'spec-value'; rv.id = 'spec-val-' + key;
      rv.textContent = current || '—'; input.replaceWith(rv);
    }
  });
}

export function renderSpecsImportBtn(w) {
  // "Rellenar desde un enlace" + link to where the specs came from
  const specsEl = document.getElementById('d-specs');
  if (!specsEl) return;
  document.getElementById('d-specs-import')?.remove();
  const canImport = typeof importEnabled === 'function' && importEnabled();
  let host = '';
  if (w.sourceUrl) { try { host = new URL(w.sourceUrl).hostname.replace(/^www\./, ''); } catch {} }
  if (!canImport && !host) return;
  const div = document.createElement('div');
  div.id = 'd-specs-import';
  div.className = 'specs-import-row';
  div.innerHTML = `
    ${canImport ? `<button type="button" class="chip-btn" id="d-import-btn"><i class="ti ti-link" aria-hidden="true"></i> ${t('Rellenar desde un enlace')}</button>` : ''}
    ${host ? `<a class="source-link" href="${escHtml(w.sourceUrl)}" target="_blank" rel="noopener noreferrer"><i class="ti ti-external-link" aria-hidden="true"></i> ${t('Fuente')}: ${escHtml(host)}</a>` : ''}`;
  specsEl.insertAdjacentElement('afterend', div);
  div.querySelector('#d-import-btn')?.addEventListener('click', () => importIntoWatch(w.id));
}

export function renderPrice(w) {
  const box = document.getElementById('d-price-box');
  if (w.price?.value) {
    box.style.display = 'block';
    document.getElementById('d-price').textContent = w.price.value;
    let note = w.price.note || '';
    if (w._warning) note = `${note ? note + ' · ' : ''}${t('estimado por la IA de una versión antigua')}`;
    document.getElementById('d-price-note').textContent = note;
  } else {
    box.style.display = 'none';
  }
  // Where the specs come from
  document.getElementById('d-source-badge')?.remove();
  let html = '';
  if (w._source === 'local_db') html = `<i class="ti ti-database" aria-hidden="true"></i> ${t('Ficha de la base de datos de Rotor')}`;
  else if (w._warning) html = `<i class="ti ti-info-circle" aria-hidden="true"></i> ${t('Esta ficha la rellenó la IA de una versión antigua y puede tener errores. Compruébala, o usa «Rellenar desde un enlace» con la página del reloj.')}`;
  if (!html) return;
  const badge = document.createElement('div');
  badge.id = 'd-source-badge';
  badge.className = 'source-badge' + (w._warning ? ' legacy' : '');
  badge.innerHTML = html;
  document.getElementById('d-specs')?.insertAdjacentElement('afterend', badge);
}

/* Historial tab: every use of this watch, editable */
export function renderDetailHistory(w) {
  const el = document.getElementById('d-history');
  if (!el) return;
  const st = wearStats(w);
  const keys = [...wornDayKeys(w)].sort();
  el.innerHTML = `
    <div class="hw-stats">
      <div class="spec-card"><div class="spec-label">${t('Días de uso')}</div><div class="spec-value">${st.daysWorn}</div></div>
      <div class="spec-card"><div class="spec-label">${t('Últimos 90 días')}</div><div class="spec-value">${st.daysWorn90}</div></div>
      <div class="spec-card"><div class="spec-label">${t('Primera vez')}</div><div class="spec-value">${keys.length ? formatDate(new Date(keys[0] + 'T12:00').getTime()) : '—'}</div></div>
    </div>
    <button class="chip-btn" id="dh-add"><i class="ti ti-calendar-plus" aria-hidden="true"></i> ${t('Apuntar un uso')}</button>
    <div class="dh-list">${intervalsHTML(w, 'all')}</div>`;
  el.querySelector('#dh-add').addEventListener('click', () => openWearSheet(w.id));
  el.querySelectorAll('.interval-edit').forEach(b =>
    b.addEventListener('click', () => openWearSheet(w.id, Number(b.dataset.idx))));
}

/* Mantenimiento tab: purchase, service and battery, with the alerts */
export function renderMaintenance(w) {
  const el = document.getElementById('d-maint');
  if (!el) return;
  const st = wearStats(w);
  const rows = [
    { l: t('Precio pagado'), v: w.purchasePrice ? money(w.purchasePrice, { decimals: 2 }) : null },
    { l: t('Fecha de compra'), v: w.purchaseDate ? formatDate(w.purchaseDate) : null },
    w.type === 'quartz'
      ? { l: t('Cambio de pila'), v: w.batteryChanged ? formatDate(w.batteryChanged) : null }
      : { l: t('Última revisión'), v: w.lastService ? formatDate(w.lastService) : null },
    { l: t('Coste por uso'), v: st.costPerWear !== null ? money(st.costPerWear) : null },
  ];
  const alerts = maintenanceAlerts(w);
  el.innerHTML = `
    ${alerts.map(a => `<div class="maint-alert"><i class="ti ti-tool" aria-hidden="true"></i><span>${escHtml(alertText(a))}</span></div>`).join('')}
    <div class="maint-rows">${rows.map(r => `
      <div class="maint-row"><span>${r.l}</span><b class="${r.v ? '' : 'muted'}">${r.v ? escHtml(r.v) : t('Sin apuntar')}</b></div>`).join('')}
    </div>
    <div class="sheet-text">${w.type === 'quartz'
      ? t('Una pila dura unos 2 o 3 años. Cambiarla a tiempo evita que se derrame dentro del reloj.')
      : t('Un mecánico agradece una revisión cada 5 años más o menos: limpieza, aceites y juntas.')}</div>
    <button class="chip-btn" id="dm-edit"><i class="ti ti-pencil" aria-hidden="true"></i> ${t('Editar compra y mantenimiento')}</button>`;
  el.querySelector('#dm-edit').addEventListener('click', () => openEditModal(w.id, { maintenance: true }));
}

/* ─── Wear actions ─── */
export function handleStartWearing(id) {
  const w = getWatch(id);
  if (startWearing(id)) { showToast(t('Contando el tiempo con el {w}', { w: `${w.brand} ${w.model}` })); openDetail(id); }
}
export function handleStopWearing(id) {
  if (stopWearing(id)) { showToast(t('Guardado en el historial')); stopActiveTimer(); showView('home'); }
}
export function handleSwitchWearing(id, { reopen = true } = {}) {
  const w = getWatch(id);
  if (!switchToWatch(id)) return false;
  showToast(t('Ahora llevas el {w}', { w: `${w.brand} ${w.model}` }));
  if (reopen) openDetail(id);
  return true;
}

/* ─── Date sheet: log a past wear or edit/delete a history entry ─── */
export function toDateInput(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function fromDateInput(v) {
  const [y, m, d] = (v || '').split('-').map(Number);
  return y ? new Date(y, m - 1, d, 12, 0, 0).getTime() : null;
}

/**
 * openWearSheet(watchId)              → add a past wear (one day or a range)
 * openWearSheet(watchId, historyIdx)  → edit or delete that entry
 */
export function openWearSheet(watchId, idx = null) {
  const w = getWatch(watchId);
  if (!w) return;
  const entry = idx !== null ? w.history?.[idx] : null;
  const today = toDateInput(Date.now());
  const from  = entry ? toDateInput(entry.start) : today;
  const to    = entry ? toDateInput(entry.end)   : today;
  const title = entry ? t('Editar uso') : t('Apuntar un uso');
  const { $, close } = openSheet({
    label: title,
    html: `<div class="modal-title">${title}</div>
      <div class="sheet-text">${name(w)}. ${t('Cuenta cada día del rango como un día de uso.')}</div>
      <div class="form-grid-2">
        <div class="form-field"><label class="form-label" for="ws-from">${t('Desde')}</label>
          <input class="form-input" type="date" id="ws-from" value="${from}" max="${today}"></div>
        <div class="form-field"><label class="form-label" for="ws-to">${t('Hasta')}</label>
          <input class="form-input" type="date" id="ws-to" value="${to}" max="${today}"></div>
      </div>
      <div class="modal-actions">
        ${entry ? `<button class="modal-btn modal-btn-danger" id="ws-del">${t('Borrar')}</button>` : ''}
        <button class="modal-btn modal-btn-cancel" id="ws-cancel" data-close>${t('Cancelar')}</button>
        <button class="modal-btn modal-btn-save" id="ws-save">${t('Guardar')}</button>
      </div>`,
  });
  $('#ws-save').addEventListener('click', () => {
    const a = fromDateInput($('#ws-from').value);
    const b = fromDateInput($('#ws-to').value) ?? a;
    if (!a) { showToast(t('Elige una fecha')); return; }
    const ok = entry ? updateHistoryEntry(watchId, idx, a, b) : addWearDays(watchId, a, b);
    if (!ok) { showToast(t('No se pueden apuntar días futuros')); return; }
    close();
    showToast(entry ? t('Uso actualizado') : t('Uso apuntado'));
    refreshAfterWearChange(watchId);
  });
  $('#ws-del')?.addEventListener('click', () => {
    const days = calendarDaysBetween(entry.start, entry.end) + 1;
    const when = days === 1 ? t('del {d}', { d: formatDate(entry.start) })
      : t('del {a} al {b} ({n})', { a: formatDate(entry.start), b: formatDate(entry.end), n: daysTxt(days) });
    showConfirm(t('¿Borrar este uso?'), t('Se quitará el uso {when} del {w}.', { when, w: `${w.brand} ${w.model}` }), () => {
      deleteHistoryEntry(watchId, idx);
      close();
      showToast(t('Uso borrado'));
      refreshAfterWearChange(watchId);
    }, { okLabel: t('Borrar') });
  });
}
export function refreshAfterWearChange(watchId) {
  const active = document.querySelector('.view.active')?.id;
  if (active === 'view-detail' && ui.currentWatchId === watchId) openDetail(watchId);
  else if (active === 'view-history') renderHistory();
  else renderHome();
}

/* ─── Delete (custom confirm) ─── */
export function handleDeleteWatch(id) {
  const w = getWatch(id);
  const nm = w ? `${w.brand} ${w.model}` : t('este reloj');
  showConfirm(t('¿Eliminar reloj?'), t('Se borrará {w} y todo su historial. Esta acción no se puede deshacer.', { w: nm }), () => {
    deleteWatch(id); showView('home'); showToast(t('Reloj eliminado'));
  });
}

/* ══ Familias (v2.23): filtro de la colección y campo editable en la ficha ══ */
const FAM_KEY = 'rotor_family_filter';
const FAMILY_MIN = 6;          // below this the whole collection fits on one screen
const famLabel = id => { const f = familyById(id); return f ? t(f.label) : t('Sin familia'); };
function readFamFilter() { try { return localStorage.getItem(FAM_KEY) || 'all'; } catch { return 'all'; } }
function writeFamFilter(v) { try { localStorage.setItem(FAM_KEY, v); } catch { /* private mode */ } }

/** Draws the chips above the grid and returns the watches to show */
export function renderFamilyFilter(ws) {
  const box = document.getElementById('family-filter');
  if (!box) return ws;
  const counts = new Map();
  ws.forEach(w => { const k = familyById(w.family) ? w.family : 'none'; counts.set(k, (counts.get(k) || 0) + 1); });
  const used = FAMILIES.filter(f => counts.has(f.id));
  const unclassified = counts.get('none') || 0;
  if (ws.length < FAMILY_MIN) { box.innerHTML = ''; return ws; }
  if (used.length < 2) {
    // Not enough families yet: one quiet invitation to classify instead of useless chips
    box.innerHTML = `<button class="fam-setup" id="fam-setup"><i class="ti ti-category" aria-hidden="true"></i>
      <span>${t('Ordena tu colección por familias')}<small>${t('Buceo, cronógrafo, vestir… y filtra con un toque')}</small></span>
      <i class="ti ti-chevron-right" aria-hidden="true"></i></button>`;
    box.querySelector('#fam-setup').addEventListener('click', openClassifySheet);
    return ws;
  }
  let cur = readFamFilter();
  if (cur !== 'all' && !counts.has(cur)) cur = 'all';
  const chip = (id, label, n, icon) => `<button class="fam-chip" data-fam="${id}" aria-pressed="${cur === id}">
    ${icon ? `<i class="ti ${icon}" aria-hidden="true"></i>` : ''}${escHtml(label)} <span class="fam-n">${n}</span></button>`;
  box.innerHTML = `<div class="fam-chips" role="group" aria-label="${escHtml(t('Filtrar por familia'))}">
    ${chip('all', t('Todos'), ws.length)}
    ${used.map(f => chip(f.id, t(f.label), counts.get(f.id), f.icon)).join('')}
    ${unclassified ? chip('none', t('Sin familia'), unclassified, 'ti-help-circle') : ''}
    ${unclassified ? `<button class="fam-chip fam-classify" id="fam-classify"><i class="ti ti-pencil" aria-hidden="true"></i>${t('Clasificar')}</button>` : ''}
  </div>`;
  box.querySelectorAll('.fam-chip[data-fam]').forEach(b => b.addEventListener('click', () => {
    writeFamFilter(b.dataset.fam === cur ? 'all' : b.dataset.fam);
    renderHome();
  }));
  box.querySelector('#fam-classify')?.addEventListener('click', openClassifySheet);
  // Keep the chosen chip visible when the row scrolls
  box.querySelector('.fam-chip[aria-pressed="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  if (cur === 'all') return ws;
  return ws.filter(w => (familyById(w.family) ? w.family : 'none') === cur);
}

function familyCardHTML(w) {
  const f = familyById(w.family);
  return `<div class="spec-card spec-family${f ? '' : ' spec-empty'}" id="spec-family" role="button" tabindex="0"
      aria-label="${escHtml(t('Editar {campo}: {valor}', { campo: t('Familia'), valor: f ? t(f.label) : t('vacío') }))}">
    <div class="spec-label">${t('Familia')}</div>
    <div class="spec-value">${f ? `<i class="ti ${f.icon}" aria-hidden="true" style="color:${f.color}"></i> ${t(f.label)}`
      : `<span class="spec-placeholder">${t('Elegir…')}</span>`}</div>
  </div>`;
}

/** Choose the family of one watch */
export function openFamilySheet(id) {
  const w = getWatch(id);
  if (!w) return;
  const guess = w.family ? null : guessFamily(w);
  const opt = (fid, label, icon, color) => {
    const on = (w.family || '') === fid;
    return `<button class="today-pick fam-pick${on ? ' on' : ''}" data-fam="${fid}" role="radio" aria-checked="${on}">
      <i class="ti ${icon} fam-ico" aria-hidden="true"${color ? ` style="color:${color}"` : ''}></i>
      <span class="today-pick-txt"><b>${escHtml(label)}</b>${fid && fid === guess ? `<small><em>${t('Propuesta de Rotor')}</em></small>` : ''}</span>
      <i class="ti ${on ? 'ti-circle-check' : 'ti-circle'}" aria-hidden="true"></i></button>`;
  };
  const sh = openSheet({ label: t('Familia'), html: `<div class="modal-title">${t('Familia')}</div>
    <div class="sheet-text">${name(w)}</div>
    <div class="today-list" role="radiogroup">
      ${FAMILIES.map(f => opt(f.id, t(f.label), f.icon, f.color)).join('')}
      ${opt('', t('Sin familia'), 'ti-help-circle')}
    </div>
    <div class="modal-actions"><button class="modal-btn modal-btn-cancel" data-close>${t('Cancelar')}</button></div>` });
  sh.$$('.fam-pick').forEach(b => b.addEventListener('click', async () => {
    await updateWatch(id, { family: b.dataset.fam || null });
    sh.close();
    if (ui.currentWatchId === id) renderSpecs(getWatch(id));
    renderHome();
    showToast(t('Familia: {f}', { f: famLabel(b.dataset.fam) }));
  }));
}

/** Classify every watch without a family at once, starting from Rotor's proposals */
export function openClassifySheet() {
  const todo = getWatches().filter(w => !familyById(w.family))
    .sort((a, b) => `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`));
  if (!todo.length) return;
  const options = sel => `<option value="">${t('Sin familia')}</option>` +
    FAMILIES.map(f => `<option value="${f.id}"${f.id === sel ? ' selected' : ''}>${t(f.label)}</option>`).join('');
  const proposed = todo.filter(w => guessFamily(w)).length;
  const sh = openSheet({ label: t('Clasificar por familias'), html: `<div class="modal-title">${t('Clasificar por familias')}</div>
    <div class="sheet-text">${proposed
      ? t('Rotor propone una familia para {n} de {total} relojes según la marca y el modelo. Revísalas antes de guardar.', { n: proposed, total: todo.length })
      : t('Elige la familia de cada reloj. Puedes dejar los que no tengas claros.')}</div>
    <div class="fam-list">${todo.map(w => `<label class="fam-row">${watchChip(w, 36)}
      <span class="fam-row-txt"><b>${name(w)}</b></span>
      <select class="form-input form-select fam-select" data-id="${escHtml(w.id)}" aria-label="${escHtml(t('Familia de {w}', { w: `${w.brand} ${w.model}` }))}">${options(guessFamily(w))}</select>
    </label>`).join('')}</div>
    <div class="modal-actions">
      <button class="modal-btn modal-btn-cancel" data-close>${t('Cancelar')}</button>
      <button class="modal-btn modal-btn-save" id="fam-save">${t('Guardar')}</button>
    </div>` });
  sh.$('#fam-save').addEventListener('click', async () => {
    let n = 0;
    for (const s of sh.$$('.fam-select')) {
      if (s.value) { await updateWatch(s.dataset.id, { family: s.value }); n++; }
    }
    sh.close();
    renderHome();
    showToast(n === 1 ? t('1 reloj clasificado') : t('{n} relojes clasificados', { n }));
  });
}
