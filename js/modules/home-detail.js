/* ─── HOME ─── */
import { addWearDays, calendarDaysBetween, dayKey, deleteHistoryEntry, deleteWatch, getActiveWatch, getWatch, getWatches, isSafePhoto, maintenanceAlerts, markWornToday, setWatchFlag, startWearing, stopWearing, switchToWatch, updateHistoryEntry, updateWatch, wearStats, wornDayKeys } from '../storage.js';
import { elapsedShort, elapsedSince, escHtml, formatDate, showToast, showView, typeLabel, ui, watchEmoji } from './core.js';
import { openEditModal } from './modals.js';
import { renderHistory } from './history.js';
import { renderBackupReminder } from './settings.js';
import { importEnabled, importIntoWatch } from './url-import.js';

export function renderHome() {
  const grid  = document.getElementById('watches-grid');
  const empty = document.getElementById('empty-state');
  if (!grid || !empty) return;   // DOM not ready yet
  const ws    = getWatches();
  const activeW = getActiveWatch();

  // Header: how many watches and how much they cost (only those with a price)
  const sub = document.getElementById('home-subtitle');
  if (sub) {
    const spent = ws.reduce((t, w) => t + (Number(w.purchasePrice) > 0 ? Number(w.purchasePrice) : 0), 0);
    sub.textContent = !ws.length ? 'Tu colección de relojes'
      : `${ws.length} ${ws.length === 1 ? 'reloj' : 'relojes'}${spent ? ` · ${Math.round(spent).toLocaleString('es-ES')} € invertidos` : ''}`;
  }
  if (typeof renderBackupReminder === 'function') renderBackupReminder();

  const dot = document.getElementById('status-dot');
  dot.className = 'status-dot ' + (activeW ? 'dot-active' : 'dot-none');
  document.getElementById('status-text').textContent = activeW ? 'Reloj activo' : 'Ningún reloj activo';
  document.getElementById('status-watch-name').textContent = activeW ? `${activeW.brand} ${activeW.model}` : '';

  if (!ws.length) {
    grid.style.display = 'none';
    empty.style.display = 'flex';
    const _rb = document.getElementById('recommendation-banner'); if (_rb) _rb.innerHTML = '';
    return;
  }
  grid.style.display = 'grid';
  empty.style.display = 'none';

  renderRecommendation(ws, activeW);

  grid.innerHTML = ws.map(w => {
    const isActive = !!w.wearStart;
    const locked   = false;   // any watch can be opened and switched to
    return `
      <div class="watch-card${locked ? ' locked' : ''}${isActive ? ' active-card' : ''}" data-id="${escHtml(w.id)}" role="button" tabindex="0" aria-label="${escHtml(w.brand)} ${escHtml(w.model)}${isActive ? ' — actualmente puesto' : ''}">
        <div class="watch-img-wrap">
          ${isSafePhoto(w.photo)
            ? `<img src="${w.photo}" alt=""${escHtml(w.brand)} ${escHtml(w.model)}" loading="lazy">`
            : `<div class="watch-img-placeholder">${watchEmoji(w.type)}</div>`}
          <div class="watch-type-badge">${typeLabel(w.type)}</div>
          ${isActive ? `<div class="active-badge">Puesto</div>` : ''}
          ${w.favorite ? `<div class="fav-badge" aria-label="Favorito"><i class="ti ti-star" aria-hidden="true"></i></div>` : ''}
          ${maintenanceAlerts(w).length ? `<div class="alert-badge" aria-label="Necesita mantenimiento"><i class="ti ti-tool" aria-hidden="true"></i></div>` : ''}
        </div>
        <div class="watch-info">
          <div class="watch-brand">${escHtml(w.brand)}</div>
          <div class="watch-model">${escHtml(w.model)}</div>
          ${isActive ? `<div class="days-badge">${elapsedShort(w.wearStart)}</div>` : `<div class="last-worn">${shortLastWorn(w)}</div>`}
        </div>
      </div>`;
  }).join('');

  // All cards clickable — locked ones open read-only
  // keyboard + click support for accessibility
  grid.querySelectorAll('.watch-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(card.dataset.id); }
    });
  });
}

/* ─── Recommendation banner ───
   Rotation, not urgency: suggest the watch that has gone longest without
   wrist time, among those "en rotación". Favourites win ties.
   No alarmist claims: a mechanical watch resting a few weeks is fine. */
export function renderRecommendation(ws, activeW) {
  const banner = document.getElementById('recommendation-banner');
  if (!banner) return;
  if (activeW) { banner.innerHTML = ''; return; }

  // Watches already worn today are not "due": suggest from the rest
  const ranked = rankWatchesForRotation(ws).filter(r => r.stats.daysSinceLast !== 0);
  if (!ranked.length) { banner.innerHTML = ''; return; }

  const [top, ...rest] = ranked;
  const w = top.watch;
  const others = rest.slice(0, 2).map(r => `${escHtml(r.watch.brand)} ${escHtml(r.watch.model)}`);
  banner.innerHTML = `
    <div class="recommendation-card" role="button" tabindex="0" aria-label="Recomendación: ${escHtml(w.brand)} ${escHtml(w.model)}">
      <div class="rec-icon"><i class="ti ti-refresh" style="color:var(--gold-light);font-size:20px;" aria-hidden="true"></i></div>
      <div class="rec-body">
        <div class="rec-label">Toca ponerse</div>
        <div class="rec-watch">${escHtml(w.brand)} ${escHtml(w.model)}${w.favorite ? ' <i class="ti ti-star" aria-label="favorito"></i>' : ''}</div>
        <div class="rec-reason">${formatLastWorn(top.stats)}</div>
        ${others.length ? `<div class="rec-others">Después: ${others.join(' · ')}</div>` : ''}
      </div>
      <i class="ti ti-chevron-right" style="color:var(--mid);font-size:18px;flex-shrink:0;" aria-hidden="true"></i>
    </div>`;
  const card = banner.querySelector('.recommendation-card');
  card.addEventListener('click', () => openDetail(w.id));
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(w.id); } });
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
  if (st.lastWorn === null) return 'Todavía no lo has llevado';
  if (st.daysSinceLast === 0) return 'Lo llevaste hoy';
  if (st.daysSinceLast === 1) return 'Lo llevaste ayer';
  return `${st.daysSinceLast} días sin salir de la caja`;
}

export function shortLastWorn(w) {
  const st = wearStats(w);
  if (w.rotation === false) return 'Fuera de rotación';
  if (st.lastWorn === null) return 'Sin estrenar';
  if (st.daysSinceLast === 0) return 'Hoy';
  if (st.daysSinceLast === 1) return 'Ayer';
  return `Hace ${st.daysSinceLast} días`;
}

/* ─── DETAIL ─── */
export function openDetail(id) {
  ui.currentWatchId = id;
  const w = getWatch(id);
  if (!w) return;

  document.getElementById('d-brand').textContent = w.brand;
  document.getElementById('d-name').textContent  = w.model + (w.ref ? ` · ${w.ref}` : '');

  const img = document.getElementById('d-img');
  const ph  = document.getElementById('d-img-placeholder');
  if (isSafePhoto(w.photo)) {
    img.src = w.photo; img.style.display = 'block'; ph.style.display = 'none';
  } else {
    img.style.display = 'none'; ph.style.display = 'flex'; ph.textContent = watchEmoji(w.type);
  }

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

  const notesEl = document.getElementById('d-notes-val');
  if (notesEl) notesEl.textContent = w.notes || '—';

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

export function updateDayCounter(w) {
  const elapsed = elapsedSince(w.wearStart);
  const el = document.getElementById('d-days');
  const se = document.getElementById('d-since');
  if (el) el.textContent = elapsed;
  if (se) {
    const started = formatDate(w.wearStart);
    const startTime = new Date(w.wearStart).toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
    se.textContent = `Desde el ${started} a las ${startTime}`;
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
    // Also refresh the grid badge if visible
    const badge = document.querySelector(`.watch-card[data-id="${id}"] .days-badge`);
    if (badge) badge.textContent = elapsedShort(c.wearStart);
  }, 60000);
}
export function stopActiveTimer() {
  if (ui.activeTimer) { clearInterval(ui.activeTimer); ui.activeTimer = null; }
}

export function renderDetailActions(w) {
  const div = document.getElementById('d-actions');
  const activeW = getActiveWatch();
  const todayDone = wornDayKeys(w).has(dayKey(Date.now()));
  let main;
  if (w.wearStart) {
    main = `<button class="action-btn btn-stop" data-act="stop"><i class="ti ti-player-stop" aria-hidden="true"></i> Quitarme este reloj</button>`;
  } else if (activeW) {
    main = `<button class="action-btn btn-wear" data-act="switch"><i class="ti ti-switch-horizontal" aria-hidden="true"></i> Cambiar a este reloj</button>
            <div class="action-hint">Ahora llevas el ${escHtml(activeW.brand)} ${escHtml(activeW.model)}: se cerrará su sesión.</div>`;
  } else {
    main = `<button class="action-btn btn-wear" data-act="start"><i class="ti ti-player-play" aria-hidden="true"></i> Ponerme este reloj</button>`;
  }
  div.innerHTML = `
    ${main}
    <div class="wear-quick">
      ${w.wearStart ? '' : `<button class="chip-btn" data-act="today" ${todayDone ? 'disabled' : ''}>
        <i class="ti ti-check" aria-hidden="true"></i> ${todayDone ? 'Hoy ya cuenta' : 'Lo llevé hoy'}</button>`}
      <button class="chip-btn" data-act="past"><i class="ti ti-calendar-plus" aria-hidden="true"></i> Otro día</button>
      <button class="chip-btn${w.favorite ? ' on' : ''}" data-act="fav" aria-pressed="${!!w.favorite}">
        <i class="ti ti-star" aria-hidden="true"></i> Favorito</button>
      <button class="chip-btn${w.rotation === false ? ' on' : ''}" data-act="rotation" aria-pressed="${w.rotation === false}">
        <i class="ti ti-ban" aria-hidden="true"></i> Fuera de rotación</button>
    </div>`;
  div.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
    const act = btn.dataset.act;
    if (act === 'stop')   return handleStopWearing(w.id);
    if (act === 'start')  return handleStartWearing(w.id);
    if (act === 'switch') return handleSwitchWearing(w.id);
    if (act === 'today') {
      const r = markWornToday(w.id);
      showToast(r === 'already' ? 'Hoy ya estaba apuntado' : 'Apuntado: lo llevaste hoy');
      return openDetail(w.id);
    }
    if (act === 'past') return openWearSheet(w.id);
    if (act === 'fav') { setWatchFlag(w.id, 'favorite', !w.favorite); return openDetail(w.id); }
    if (act === 'rotation') {
      const out = w.rotation !== false;
      setWatchFlag(w.id, 'rotation', !out);
      showToast(out ? 'Fuera de rotación: no se te recomendará' : 'De vuelta en la rotación');
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
  const eur = v => v.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: v < 10 ? 2 : 0 });
  const cells = [
    { l: 'Días de uso', v: st.daysWorn },
    { l: 'Últimos 90 días', v: st.daysWorn90 },
    { l: 'Última vez', v: st.lastWorn === null ? 'Nunca' : st.daysSinceLast === 0 ? 'Hoy' : st.daysSinceLast === 1 ? 'Ayer' : `Hace ${st.daysSinceLast} d` },
    { l: 'Coste por uso', v: st.costPerWear !== null ? eur(st.costPerWear) : (w.purchasePrice ? '—' : 'Sin precio'), small: st.costPerWear === null && !w.purchasePrice },
  ];
  el.innerHTML = `
    <div class="usage-grid">${cells.map(c => `
      <div class="usage-cell"><div class="usage-val${c.small ? ' is-text' : ''}">${escHtml(String(c.v))}</div><div class="usage-label">${c.l}</div></div>`).join('')}
    </div>
    ${alerts.map(a => `<div class="maint-alert"><i class="ti ti-tool" aria-hidden="true"></i><span>${escHtml(a.text)}</span></div>`).join('')}`;
}

export function renderSpecs(w) {
  const specs = w.specs || {};
  const defs = [
    {k:'calibre',l:'Calibre'},{k:'movimiento',l:'Movimiento'},{k:'cristal',l:'Cristal'},
    {k:'brazalete',l:'Brazalete'},{k:'esfera',l:'Esfera'},{k:'caja',l:'Caja'},
    {k:'resistencia',l:'Agua'},{k:'reserva',l:'Reserva'},{k:'diametro',l:'Diámetro'},{k:'grosor',l:'Grosor'},
    {k:'asas',l:'Entre asas'},
  ];

  document.getElementById('d-specs').innerHTML = `
    <div class="specs-edit-hint" id="specs-edit-hint">
      <i class="ti ti-pencil" style="font-size:11px;" aria-hidden="true"></i>
      Toca cualquier campo para editar
    </div>
    ${defs.map(s => {
      const val = specs[s.k] || '';
      const isEmpty = !val;
      return `
      <div class="spec-card${isEmpty ? ' spec-empty' : ''}"
           data-key="${s.k}"
           role="button" tabindex="0"
           aria-label="Editar ${s.l}: ${val || 'vacío'}"
           title="Toca para editar">
        <div class="spec-label">${s.l}</div>
        <div class="spec-value" id="spec-val-${s.k}">${isEmpty ? '<span class="spec-placeholder">Añadir…</span>' : escHtml(val)}</div>
      </div>`;
    }).join('')}`;

  document.getElementById('d-specs').querySelectorAll('.spec-card').forEach(card => {
    const activate = () => editSpecInline(card.dataset.key, getWatch(ui.currentWatchId));
    card.addEventListener('click', activate);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }});
  });

  // Also show URL import button in detail view
  renderSpecsImportBtn(w);
}

export function editSpecInline(key, w) {
  const valEl = document.getElementById('spec-val-' + key);
  if (!valEl) return;
  const current = (w?.specs || {})[key] || '';
  const input = document.createElement('input');
  input.className = 'spec-input-inline';
  input.value = current === '—' ? '' : current;
  input.placeholder = 'Añadir valor...';
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
    if (newVal && newVal !== prevVal) showToast('Guardado');
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
    ${canImport ? `<button type="button" class="chip-btn" id="d-import-btn"><i class="ti ti-link" aria-hidden="true"></i> Rellenar desde un enlace</button>` : ''}
    ${host ? `<a class="source-link" href="${escHtml(w.sourceUrl)}" target="_blank" rel="noopener noreferrer"><i class="ti ti-external-link" aria-hidden="true"></i> Fuente: ${escHtml(host)}</a>` : ''}`;
  specsEl.insertAdjacentElement('afterend', div);
  div.querySelector('#d-import-btn')?.addEventListener('click', () => importIntoWatch(w.id));
}

export function renderPrice(w) {
  const box = document.getElementById('d-price-box');
  if (w.price?.value) {
    box.style.display = 'block';
    document.getElementById('d-price').textContent = w.price.value;
    let note = w.price.note || '';
    if (w._warning) note = `${note ? note + ' · ' : ''}estimado por la IA de una versión antigua`;
    document.getElementById('d-price-note').textContent = note;
  } else {
    box.style.display = 'none';
  }
  // Where the specs come from
  const old = document.getElementById('d-source-badge');
  if (old) old.remove();
  let html = '';
  if (w._source === 'local_db') html = `<i class="ti ti-database" aria-hidden="true"></i> Ficha de la base de datos de Rotor`;
  else if (w._warning) html = `<i class="ti ti-info-circle" aria-hidden="true"></i> Esta ficha la rellenó la IA de una versión antigua y puede tener errores. Compruébala, o usa «Rellenar desde un enlace» con la página del reloj.`;
  if (!html) return;
  const badge = document.createElement('div');
  badge.id = 'd-source-badge';
  badge.className = 'source-badge' + (w._warning ? ' legacy' : '');
  badge.innerHTML = html;
  document.getElementById('d-specs')?.insertAdjacentElement('afterend', badge);
}

/* ─── Wear actions ─── */
export function handleStartWearing(id) {
  const w = getWatch(id);
  if (startWearing(id)) { showToast(`¡Disfruta del ${w.brand} ${w.model}!`); openDetail(id); }
}
export function handleStopWearing(id) {
  if (stopWearing(id)) { showToast('Sesión guardada en el historial'); stopActiveTimer(); showView('home'); }
}
export function handleSwitchWearing(id) {
  const prev = getActiveWatch();
  const w = getWatch(id);
  if (switchToWatch(id)) {
    showToast(`Guardado el ${prev ? prev.brand : ''} · ahora llevas el ${w.brand} ${w.model}`);
    openDetail(id);
  }
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
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'display:flex;z-index:400;';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="modal-sheet" style="padding-bottom:max(20px,env(safe-area-inset-bottom));">
      <div class="modal-handle"></div>
      <div class="modal-title">${entry ? 'Editar uso' : 'Apuntar un uso'}</div>
      <div style="font-size:13px;color:var(--mid);margin-bottom:14px;line-height:1.6;">
        ${escHtml(w.brand)} ${escHtml(w.model)}. Cuenta cada día del rango como un día de uso.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="form-field"><label class="form-label" for="ws-from">Desde</label>
          <input class="form-input" type="date" id="ws-from" value="${from}" max="${today}"></div>
        <div class="form-field"><label class="form-label" for="ws-to">Hasta</label>
          <input class="form-input" type="date" id="ws-to" value="${to}" max="${today}"></div>
      </div>
      <div class="modal-actions">
        ${entry ? '<button class="modal-btn" id="ws-del" style="background:var(--danger-fill);color:#fff;">Borrar</button>' : ''}
        <button class="modal-btn modal-btn-cancel" id="ws-cancel">Cancelar</button>
        <button class="modal-btn modal-btn-save" id="ws-save">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#ws-cancel').addEventListener('click', close);
  overlay.querySelector('#ws-save').addEventListener('click', () => {
    const a = fromDateInput(overlay.querySelector('#ws-from').value);
    const b = fromDateInput(overlay.querySelector('#ws-to').value) ?? a;
    if (!a) { showToast('Elige una fecha'); return; }
    const ok = entry ? updateHistoryEntry(watchId, idx, a, b) : addWearDays(watchId, a, b);
    if (!ok) { showToast('No se pueden apuntar días futuros'); return; }
    close();
    showToast(entry ? 'Uso actualizado' : 'Uso apuntado');
    refreshAfterWearChange(watchId);
  });
  overlay.querySelector('#ws-del')?.addEventListener('click', () => {
    const days = calendarDaysBetween(entry.start, entry.end) + 1;
    const when = days === 1 ? `del ${formatDate(entry.start)}` : `del ${formatDate(entry.start)} al ${formatDate(entry.end)} (${days} días)`;
    showConfirm('¿Borrar este uso?', `Se quitará el uso ${when} del ${w.brand} ${w.model}.`, () => {
      deleteHistoryEntry(watchId, idx);
      close();
      showToast('Uso borrado');
      refreshAfterWearChange(watchId);
    }, { okLabel: 'Borrar' });
  });
  overlay.querySelector('#ws-from').focus();
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
  const name = w ? `${w.brand} ${w.model}` : 'este reloj';
  showConfirm('¿Eliminar reloj?', `Se borrará ${name} y todo su historial. Esta acción no se puede deshacer.`, () => {
    deleteWatch(id); showView('home'); showToast('Reloj eliminado');
  });
}
export function showConfirm(title, msg, onConfirm, { okLabel = 'Eliminar', danger = true } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  // Above the day and wear sheets (z-index 400), which can open it
  overlay.style.cssText = 'display:flex;z-index:500;';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="modal-sheet" style="padding-bottom:max(20px,env(safe-area-inset-bottom));">
      <div class="modal-handle"></div>
      <div style="font-family:var(--font-display);font-size:20px;color:var(--light);margin-bottom:8px;">${escHtml(title)}</div>
      <div style="font-size:13px;color:var(--mid);line-height:1.6;margin-bottom:20px;">${escHtml(msg)}</div>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-cancel" id="cc">Cancelar</button>
        <button class="modal-btn${danger ? '' : ' modal-btn-save'}" id="co" style="${danger ? 'background:var(--danger-fill);color:#fff;' : ''}flex:1;">${escHtml(okLabel)}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#cc').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#co').addEventListener('click', () => { overlay.remove(); onConfirm(); });
}

