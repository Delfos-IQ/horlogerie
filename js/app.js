/**
 * app.js — Horlogerie UI
 * Depends on: db.js, storage.js, api.js, sync.js, export.js
 *
 * Features:
 * - Watch collection grid with wear tracking
 * - Locked cards navigable in read-only mode
 * - DB search autocomplete (Chinese brands + any brand)
 * - Wear recommendation based on least-recently-used
 * - History view with year/month filters
 * - Settings: stats, sync, PDF export, JSON backup
 */

/* ─── State ─── */
let currentWatchId   = null;
let editingPhotoData = null;
let editingWatchId   = null;
let historySelectedWatch = null;
let historySelectedYear  = null;
let _activeTimer = null;

/* ─── Utilities ─── */
function showToast(msg, dur = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), dur);
}

function durationDays(startTs, endTs) {
  return Math.max(1, Math.ceil((endTs - startTs) / 86400000));
}
function daysSince(ts) {
  return Math.floor((Date.now() - ts) / 86400000);
}

/**
 * Format elapsed time since a timestamp with smart granularity:
 *   < 1h   → "23 min"
 *   < 24h  → "5h 12min"
 *   < 48h  → "1 día 3h"
 *   ≥ 48h  → "3 días 4h"
 */
function elapsedSince(ts) {
  const totalMs  = Date.now() - ts;
  const totalMin = Math.floor(totalMs / 60000);
  const hours    = Math.floor(totalMin / 60);
  const minutes  = totalMin % 60;
  const days     = Math.floor(hours / 24);
  const remHours = hours % 24;

  if (totalMin < 60) {
    return `${totalMin} min`;
  } else if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
  } else if (days === 1) {
    return remHours > 0 ? `1 día ${remHours}h` : `1 día`;
  } else {
    return remHours > 0 ? `${days} días ${remHours}h` : `${days} días`;
  }
}

/** Short version for the grid card badge */
function elapsedShort(ts) {
  const totalMs  = Date.now() - ts;
  const totalMin = Math.floor(totalMs / 60000);
  const hours    = Math.floor(totalMin / 60);
  const days     = Math.floor(hours / 24);
  if (totalMin < 60)  return `${totalMin}min`;
  if (hours < 24)     return `${hours}h`;
  if (days === 1)     return `1 día`;
  return `${days} días`;
}
function formatDate(ts) {
  return new Date(ts).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' });
}
function watchEmoji(type) {
  return type === 'automatic' ? '⚙️' : type === 'quartz' ? '🔋' : '🕰️';
}
function typeLabel(type) {
  return type === 'automatic' ? 'Auto' : type === 'quartz' ? 'Quartz' : 'Manual';
}
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ─── Navigation ─── */
function showView(v) {
  document.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
  document.getElementById('view-' + v).classList.add('active');
  const navEl = document.getElementById('nav-' + v);
  if (navEl) navEl.classList.add('active');
  if (v !== 'detail') stopActiveTimer();
  if (v === 'home')     renderHome();
  if (v === 'history')  renderHistory();
  if (v === 'settings') renderSettings();
  if (v === 'wishlist') renderWishlist();
  document.getElementById('view-' + v).scrollTop = 0;
}

/* ─── HOME ─── */
function renderHome() {
  const grid  = document.getElementById('watches-grid');
  const empty = document.getElementById('empty-state');
  const ws    = getWatches();
  const activeW = getActiveWatch();

  const dot = document.getElementById('status-dot');
  dot.className = 'status-dot ' + (activeW ? 'dot-active' : 'dot-none');
  document.getElementById('status-text').textContent = activeW ? 'Reloj activo' : 'Ningún reloj activo';
  document.getElementById('status-watch-name').textContent = activeW ? `${activeW.brand} ${activeW.model}` : '';

  if (!ws.length) {
    grid.style.display = 'none';
    empty.style.display = 'flex';
    document.getElementById('recommendation-banner').innerHTML = '';
    return;
  }
  grid.style.display = 'grid';
  empty.style.display = 'none';

  renderRecommendation(ws, activeW);

  grid.innerHTML = ws.map(w => {
    const isActive = !!w.wearStart;
    const locked   = !!(activeW && !isActive);
    return `
      <div class="watch-card${locked ? ' locked' : ''}${isActive ? ' active-card' : ''}" data-id="${escHtml(w.id)}">
        <div class="watch-img-wrap">
          ${w.photo
            ? `<img src="${w.photo}" alt="${escHtml(w.brand)} ${escHtml(w.model)}" loading="lazy">`
            : `<div class="watch-img-placeholder">${watchEmoji(w.type)}</div>`}
          <div class="watch-type-badge">${typeLabel(w.type)}</div>
          ${isActive ? `<div class="active-badge">Puesto</div>` : ''}
          ${locked   ? `<div class="locked-badge"><i class="ti ti-eye"></i></div>` : ''}
        </div>
        <div class="watch-info">
          <div class="watch-brand">${escHtml(w.brand)}</div>
          <div class="watch-model">${escHtml(w.model)}</div>
          ${isActive ? `<div class="days-badge">${elapsedShort(w.wearStart)}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  // All cards clickable — locked ones open read-only
  grid.querySelectorAll('.watch-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

/* ─── Recommendation banner ─── */
function renderRecommendation(ws, activeW) {
  const banner = document.getElementById('recommendation-banner');
  if (!banner) return;
  if (activeW) { banner.innerHTML = ''; return; }

  const ranked = rankWatchesByNeed(ws);
  if (!ranked.length) { banner.innerHTML = ''; return; }

  const { watch: w, daysSinceLastWorn, msSince } = ranked[0];
  const color = daysSinceLastWorn === null || daysSinceLastWorn > 25 ? '#e57373'
    : daysSinceLastWorn > 14 ? '#D4AF6A' : '#4CAF50';
  const text = formatLastWorn(daysSinceLastWorn, msSince);

  banner.innerHTML = `
    <div class="recommendation-card" data-rec-id="${escHtml(w.id)}">
      <div class="rec-icon"><i class="ti ti-alarm" style="color:${color};font-size:20px;"></i></div>
      <div class="rec-body">
        <div class="rec-label">Recomendación</div>
        <div class="rec-watch">${escHtml(w.brand)} ${escHtml(w.model)}</div>
        <div class="rec-reason" style="color:${color};">${text}</div>
      </div>
      <i class="ti ti-chevron-right" style="color:var(--mid);font-size:18px;flex-shrink:0;"></i>
    </div>`;
  banner.querySelector('.recommendation-card').addEventListener('click', () => openDetail(w.id));
}

function rankWatchesByNeed(ws) {
  return ws.filter(w => !w.wearStart).map(w => {
    const all = [...(w.history || [])];
    const lastEnd = all.length ? Math.max(...all.map(i => i.end || i.start)) : null;
    const msSince = lastEnd ? Date.now() - lastEnd : null;
    const daysSinceLastWorn = msSince ? Math.floor(msSince / 86400000) : null;
    const base = daysSinceLastWorn === null ? 9999 : daysSinceLastWorn;
    const score = (w.type === 'automatic' || w.type === 'manual') ? base * 1.3 : base;
    return { watch: w, daysSinceLastWorn, msSince, score };
  }).sort((a, b) => b.score - a.score);
}

function formatLastWorn(daysSince, msSince) {
  if (msSince === null) return 'Nunca usado — ¡el aceite se seca!';
  if (daysSince === 0) {
    const h = Math.floor(msSince / 3600000);
    return h < 1 ? 'Hace menos de 1h' : `Hace ${h}h`;
  }
  if (daysSince > 25) return `Hace ${daysSince} días — necesita movimiento`;
  if (daysSince > 14) return `Hace ${daysSince} días — ponértelo pronto`;
  return `Hace ${daysSince} días — al día`;
}

/* ─── DETAIL ─── */
function openDetail(id) {
  currentWatchId = id;
  const w = getWatch(id);
  if (!w) return;

  document.getElementById('d-brand').textContent = w.brand;
  document.getElementById('d-name').textContent  = w.model + (w.ref ? ` · ${w.ref}` : '');

  const img = document.getElementById('d-img');
  const ph  = document.getElementById('d-img-placeholder');
  if (w.photo) {
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
  renderSpecs(w);
  renderPrice(w);

  const notesEl = document.getElementById('d-notes-val');
  if (notesEl) notesEl.textContent = w.notes || '—';

  showView('detail');
  startActiveTimer(id);
}

function updateDayCounter(w) {
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
function startActiveTimer(id) {
  stopActiveTimer();
  const w = getWatch(id);
  if (!w?.wearStart) return;
  // Update every 60 seconds — fine enough for h/min display
  _activeTimer = setInterval(() => {
    const c = getWatch(id);
    if (!c?.wearStart) { stopActiveTimer(); return; }
    updateDayCounter(c);
    // Also refresh the grid badge if visible
    const badge = document.querySelector(`.watch-card[data-id="${id}"] .days-badge`);
    if (badge) badge.textContent = elapsedShort(c.wearStart);
  }, 60000);
}
function stopActiveTimer() {
  if (_activeTimer) { clearInterval(_activeTimer); _activeTimer = null; }
}

function renderDetailActions(w) {
  const div = document.getElementById('d-actions');
  const activeW = getActiveWatch();
  if (w.wearStart) {
    div.innerHTML = `<button class="action-btn btn-stop" id="btn-stop-wear"><i class="ti ti-player-stop"></i> Quitarme este reloj</button>`;
    document.getElementById('btn-stop-wear').addEventListener('click', () => handleStopWearing(w.id));
  } else if (!activeW) {
    div.innerHTML = `<button class="action-btn btn-wear" id="btn-start-wear"><i class="ti ti-wrist-watch"></i> Ponerme este reloj</button>`;
    document.getElementById('btn-start-wear').addEventListener('click', () => handleStartWearing(w.id));
  } else {
    div.innerHTML = `
      <div class="readonly-banner">
        <i class="ti ti-eye" style="color:var(--gold-light);font-size:16px;"></i>
        <div>
          <div style="font-size:13px;color:var(--light);font-weight:500;">Modo consulta</div>
          <div style="font-size:11px;color:var(--mid);margin-top:2px;">
            Llevas el <strong>${escHtml(activeW.brand)} ${escHtml(activeW.model)}</strong>.
            Quítatelo para poder ponerte este.
          </div>
        </div>
      </div>`;
  }
}

function renderSpecs(w) {
  const specs = w.specs || {};
  const defs = [
    {k:'calibre',l:'Calibre'},{k:'movimiento',l:'Movimiento'},{k:'cristal',l:'Cristal'},
    {k:'brazalete',l:'Brazalete'},{k:'esfera',l:'Esfera'},{k:'caja',l:'Caja'},
    {k:'resistencia',l:'Agua'},{k:'reserva',l:'Reserva'},{k:'diametro',l:'Diámetro'},{k:'grosor',l:'Grosor'},
  ];
  document.getElementById('d-specs').innerHTML = defs.map(s => `
    <div class="spec-card" data-key="${s.k}" title="Toca para editar">
      <div class="spec-label">${s.l}</div>
      <div class="spec-value" id="spec-val-${s.k}">${escHtml(specs[s.k] || '—')}</div>
    </div>`).join('');

  document.getElementById('d-specs').querySelectorAll('.spec-card').forEach(card => {
    card.addEventListener('click', () => editSpecInline(card.dataset.key, getWatch(currentWatchId)));
  });
}

function editSpecInline(key, w) {
  const valEl = document.getElementById('spec-val-' + key);
  if (!valEl) return;
  const current = (w?.specs || {})[key] || '';
  const input = document.createElement('input');
  input.className = 'spec-input-inline';
  input.value = current === '—' ? '' : current;
  input.placeholder = 'Añadir valor...';
  valEl.replaceWith(input);
  input.focus(); input.select();
  function commit() {
    const newVal = input.value.trim();
    const newSpecs = { ...(getWatch(w.id)?.specs || {}), [key]: newVal };
    updateWatch(w.id, { specs: newSpecs });
    const newEl = document.createElement('div');
    newEl.className = 'spec-value'; newEl.id = 'spec-val-' + key;
    newEl.textContent = newVal || '—';
    input.replaceWith(newEl);
    if (newVal) showToast('Guardado');
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') {
      const rv = document.createElement('div');
      rv.className = 'spec-value'; rv.id = 'spec-val-' + key;
      rv.textContent = current || '—'; input.replaceWith(rv);
    }
  });
}

function renderPrice(w) {
  const box = document.getElementById('d-price-box');
  if (w.price?.value) {
    box.style.display = 'block';
    document.getElementById('d-price').textContent = w.price.value;
    let note = w.price.note || '';
    document.getElementById('d-price-note').textContent = note;
  } else {
    box.style.display = 'none';
  }
  // Source badge
  const old = document.getElementById('d-source-badge');
  if (old) old.remove();
  if (!w._source) return;
  const badge = document.createElement('div');
  badge.id = 'd-source-badge';
  const isReal = w._source === 'local_db' || w._source?.includes('watchbase') || w._source?.includes('ebay');
  badge.style.cssText = `font-size:11px;color:${isReal ? '#4CAF50' : 'var(--gold)'};display:flex;align-items:center;gap:5px;padding:4px 0 10px;`;
  badge.innerHTML = isReal
    ? `<i class="ti ti-database-check"></i> ${w._source === 'local_db' ? 'Base de datos local' : 'Datos verificados'}`
    : `<i class="ti ti-alert-triangle"></i> ${w._warning || 'Revisa los datos'}`;
  document.getElementById('d-specs')?.insertAdjacentElement('afterend', badge);
}

/* ─── Wear actions ─── */
function handleStartWearing(id) {
  const w = getWatch(id);
  if (startWearing(id)) { showToast(`¡Disfruta del ${w.brand} ${w.model}!`); openDetail(id); }
}
function handleStopWearing(id) {
  if (stopWearing(id)) { showToast('Intervalo registrado'); stopActiveTimer(); showView('home'); }
}

/* ─── Delete (custom confirm) ─── */
function handleDeleteWatch(id) {
  showConfirm('¿Eliminar reloj?', 'Se borrará el reloj y todo su historial. Esta acción no se puede deshacer.', () => {
    deleteWatch(id); showView('home'); showToast('Reloj eliminado');
  });
}
window.deleteWatch = handleDeleteWatch;

function showConfirm(title, msg, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'display:flex;z-index:400;';
  overlay.innerHTML = `
    <div class="modal-sheet" style="padding-bottom:max(20px,env(safe-area-inset-bottom));">
      <div class="modal-handle"></div>
      <div style="font-family:var(--font-display);font-size:20px;color:var(--light);margin-bottom:8px;">${escHtml(title)}</div>
      <div style="font-size:13px;color:var(--mid);line-height:1.6;margin-bottom:20px;">${escHtml(msg)}</div>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-cancel" id="cc">Cancelar</button>
        <button class="modal-btn" id="co" style="background:rgba(220,80,80,0.85);color:#fff;flex:1;">Eliminar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#cc').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#co').addEventListener('click', () => { overlay.remove(); onConfirm(); });
}

/* ─── ADD / EDIT MODAL ─── */
function openAddModal() {
  editingWatchId = null;
  editingPhotoData = null;
  window._pendingDbSpecs = null;
  window._pendingDbPrice = null;
  document.getElementById('modal-title-text').textContent = 'Añadir Reloj';
  document.getElementById('modal-save-btn').textContent   = 'Guardar';
  document.getElementById('f-brand').value  = '';
  document.getElementById('f-model').value  = '';
  document.getElementById('f-ref').value    = '';
  document.getElementById('f-type').value   = 'automatic';
  document.getElementById('f-notes').value  = '';
  document.getElementById('photo-preview').style.display = 'none';
  const dbSec = document.getElementById('db-search-section');
  if (dbSec) dbSec.style.display = 'block';
  const dbInput = document.getElementById('db-search-input');
  if (dbInput) dbInput.value = '';
  const dbRes = document.getElementById('db-search-results');
  if (dbRes) dbRes.style.display = 'none';
  resetDbHint();
  document.getElementById('add-modal').style.display = 'flex';
  dbLoad(); // preload the database
}

function resetDbHint() {
  const hint = document.getElementById('db-hint');
  if (hint) hint.innerHTML = '<i class="ti ti-database" style="color:var(--gold);"></i> Berny · Pagani Design · San Martin · Cadisen · OBLVLO · Seagull · CIGA Design · Carnival · Reef Tiger · Steeldive';
}

function openEditModal(id) {
  const w = getWatch(id);
  if (!w) return;
  editingWatchId   = id;
  editingPhotoData = w.photo || null;
  window._pendingDbSpecs = null;
  window._pendingDbPrice = null;
  document.getElementById('modal-title-text').textContent = 'Editar Reloj';
  document.getElementById('modal-save-btn').textContent   = 'Actualizar';
  document.getElementById('f-brand').value  = w.brand;
  document.getElementById('f-model').value  = w.model;
  document.getElementById('f-ref').value    = w.ref || '';
  document.getElementById('f-type').value   = w.type;
  document.getElementById('f-notes').value  = w.notes || '';
  const prev = document.getElementById('photo-preview');
  if (w.photo) { prev.src = w.photo; prev.style.display = 'block'; }
  else { prev.style.display = 'none'; }
  const dbSec = document.getElementById('db-search-section');
  if (dbSec) dbSec.style.display = 'none'; // hide DB search when editing
  document.getElementById('add-modal').style.display = 'flex';
}

function closeAddModal() {
  document.getElementById('add-modal').style.display = 'none';
}
function closeModalIfOutside(e) {
  if (e.target.id === 'add-modal') closeAddModal();
}

/* ─── Photo upload ─── */
function openPhotoSheet() {
  document.getElementById('photo-sheet').style.display = 'flex';
}
function closePhotoSheet() {
  document.getElementById('photo-sheet').style.display = 'none';
}
function closePhotoSheetIfOutside(e) {
  if (e.target.id === 'photo-sheet') closePhotoSheet();
}
function choosePhotoSource(source) {
  closePhotoSheet();
  document.getElementById(source === 'camera' ? 'photo-input-camera' : 'photo-input-library').click();
}

function handlePhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  // Reset input so same file can be re-selected
  e.target.value = '';
  const reader = new FileReader();
  reader.onload = ev => {
    compressPhoto(ev.target.result, 900).then(resized => {
      editingPhotoData = resized;
      const prev = document.getElementById('photo-preview');
      prev.src = resized; prev.style.display = 'block';
    });
  };
  reader.readAsDataURL(file);
}

/* ─── DB Search ─── */
function handleDbSearch(query) {
  const resultsEl = document.getElementById('db-search-results');
  if (!query || query.length < 2) { resultsEl.style.display = 'none'; return; }
  const results = dbSearch(query, 6);
  if (!results.length) { resultsEl.style.display = 'none'; return; }

  resultsEl.innerHTML = results.map((w, i) => `
    <div class="db-result-item" data-idx="${i}">
      <div class="db-result-main">
        <span class="db-result-brand">${escHtml(w.brand)}</span>
        <span class="db-result-model">${escHtml(w.model)}</span>
      </div>
      <div class="db-result-sub">${w.ref ? escHtml(w.ref)+' · ' : ''}${escHtml(w.specs?.calibre || '')}${w.price?.value ? ' · '+escHtml(w.price.value) : ''}</div>
    </div>`).join('');
  resultsEl.style.display = 'block';

  resultsEl.querySelectorAll('.db-result-item').forEach((el, i) => {
    el.addEventListener('click', () => applyDbResult(results[i]));
  });
}

function applyDbResult(w) {
  document.getElementById('f-brand').value = w.brand;
  document.getElementById('f-model').value = w.model;
  document.getElementById('f-ref').value   = w.ref || '';
  document.getElementById('f-type').value  = w.type;
  document.getElementById('db-search-results').style.display = 'none';
  document.getElementById('db-search-input').value = `${w.brand} ${w.model}`;
  const hint = document.getElementById('db-hint');
  if (hint) hint.innerHTML = `<i class="ti ti-check" style="color:#4CAF50;"></i> <strong>${escHtml(w.brand)} ${escHtml(w.model)}</strong> — specs encontradas`;
  window._pendingDbSpecs = w.specs;
  window._pendingDbPrice = w.price;
  showToast(`${w.brand} ${w.model} seleccionado`);
}

/* ─── Save watch ─── */
async function saveWatch() {
  const brand = document.getElementById('f-brand').value.trim();
  const model = document.getElementById('f-model').value.trim();
  const ref   = document.getElementById('f-ref').value.trim();
  const type  = document.getElementById('f-type').value;
  const notes = document.getElementById('f-notes').value.trim();
  if (!brand) { showToast('Introduce la marca'); return; }
  if (!model) { showToast('Introduce el modelo'); return; }

  const btn = document.getElementById('modal-save-btn');
  btn.disabled = true; btn.textContent = 'Guardando…';

  try {
    if (editingWatchId) {
      await updateWatch(editingWatchId, { brand, model, ref, type, notes, photo: editingPhotoData });
      if (window._pendingDbSpecs) {
        await updateWatch(editingWatchId, { specs: window._pendingDbSpecs, price: window._pendingDbPrice || {value:'',note:''}, _source:'local_db' });
      }
      closeAddModal();
      showToast('Reloj actualizado');
      openDetail(editingWatchId);
    } else {
      const newW = await addWatch({ brand, model, ref, type, notes, photo: editingPhotoData });
      if (window._pendingDbSpecs && newW) {
        await updateWatch(newW.id, { specs: window._pendingDbSpecs, price: window._pendingDbPrice || {value:'',note:''}, _source:'local_db' });
      }
      window._pendingDbSpecs = null;
      window._pendingDbPrice = null;
      closeAddModal();
      showToast(`${brand} ${model} añadido`);
      renderHome();
    }
  } finally {
    btn.disabled = false;
    btn.textContent = editingWatchId ? 'Actualizar' : 'Guardar';
  }
}

/* ─── HISTORY ─── */
function renderHistory() {
  const sel = document.getElementById('history-selector');
  const ws  = getWatches();
  if (!ws.length) {
    document.getElementById('history-body').innerHTML = `<div class="history-empty"><i class="ti ti-clock" style="font-size:40px;color:var(--mid);"></i><br><br>No hay relojes</div>`;
    sel.innerHTML = ''; return;
  }
  if (!historySelectedWatch || !getWatch(historySelectedWatch)) historySelectedWatch = ws[0].id;
  sel.innerHTML = ws.map(w => `
    <div class="hw-chip${w.id === historySelectedWatch ? ' active' : ''}" data-wid="${escHtml(w.id)}">
      ${escHtml(w.brand)} ${escHtml(w.model)}
    </div>`).join('');
  sel.querySelectorAll('.hw-chip').forEach(chip => {
    chip.addEventListener('click', () => { historySelectedWatch = chip.dataset.wid; historySelectedYear = null; renderHistory(); });
  });
  renderHistoryBody();
}

function renderHistoryBody() {
  const w    = getWatch(historySelectedWatch);
  const body = document.getElementById('history-body');
  if (!w) { body.innerHTML = ''; return; }
  const all = [...(w.history || [])];
  if (w.wearStart) all.push({ start: w.wearStart, end: Date.now(), active: true });
  if (!all.length) {
    body.innerHTML = `<div class="history-empty"><i class="ti ti-calendar-x" style="font-size:36px;color:var(--mid);"></i><br><br>Aún no has usado este reloj</div>`;
    return;
  }
  const totalDays = all.reduce((a,i) => a + durationDays(i.start, i.end || Date.now()), 0);
  const years = [...new Set(all.map(i => new Date(i.start).getFullYear()))].sort((a,b)=>b-a);
  if (!historySelectedYear) historySelectedYear = years[0];
  const yearTabs = `<div class="year-tabs">${years.map(y=>`<div class="year-tab${y===historySelectedYear?' active':''}" data-year="${y}">${y}</div>`).join('')}</div>`;
  const summary = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
    <div class="spec-card"><div class="spec-label">Total sesiones</div><div class="spec-value">${all.length}</div></div>
    <div class="spec-card"><div class="spec-label">Total días</div><div class="spec-value">${totalDays}</div></div>
  </div>`;
  const filtered = all.filter(i => new Date(i.start).getFullYear() === historySelectedYear);
  const byMonth = {};
  filtered.forEach(i => {
    const m = new Date(i.start).toLocaleDateString('es-ES', { month:'long' });
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(i);
  });
  const monthsHTML = Object.entries(byMonth).map(([month, intervals]) => `
    <div class="month-group">
      <div class="month-label">${month}</div>
      ${intervals.map(i => {
        const dur = i.active
          ? elapsedSince(i.start)
          : `${durationDays(i.start, i.end)} días`;
        return `<div class="interval-row">
          <div class="interval-dates">${formatDate(i.start)} → ${i.active ? 'ahora' : formatDate(i.end)}</div>
          <div class="interval-duration">${dur}${i.active ? ' <span style="color:#4CAF50">●</span>' : ''}</div>
        </div>`;
      }).join('')}
    </div>`).join('');
  body.innerHTML = summary + yearTabs + monthsHTML;
  body.querySelectorAll('.year-tab').forEach(tab => {
    tab.addEventListener('click', () => { historySelectedYear = parseInt(tab.dataset.year); renderHistoryBody(); });
  });
}

/* ─── SETTINGS ─── */
function renderSettings() {
  const ws   = getWatches();
  const grid = document.getElementById('settings-stats');
  if (!grid) return;
  const autoCount = ws.filter(w=>w.type==='automatic').length;
  const qtzCount  = ws.filter(w=>w.type==='quartz').length;
  const manCount  = ws.filter(w=>w.type==='manual').length;
  const totalSess = ws.reduce((a,w) => a + (w.history?.length||0) + (w.wearStart?1:0), 0);
  let totalDays=0, mostUsedWatch=null, mostUsedDays=0;
  const gapDays=[];
  ws.forEach(w => {
    const all = [...(w.history||[])];
    if (w.wearStart) all.push({start:w.wearStart,end:Date.now()});
    const wDays = all.reduce((s,i)=>s+durationDays(i.start,i.end||Date.now()),0);
    totalDays += wDays;
    if (wDays > mostUsedDays) { mostUsedDays = wDays; mostUsedWatch = w; }
    if (all.length > 1) {
      const sorted = [...all].sort((a,b)=>a.start-b.start);
      for (let i=1;i<sorted.length;i++) {
        const gap = Math.round((sorted[i].start - (sorted[i-1].end||Date.now()))/86400000);
        if (gap >= 0) gapDays.push(gap);
      }
    }
  });
  const avgGap = gapDays.length ? Math.round(gapDays.reduce((a,b)=>a+b,0)/gapDays.length) : null;
  const stats = [
    {v:ws.length,l:'Relojes'},{v:autoCount,l:'Automáticos'},{v:qtzCount,l:'Cuarzo'},
    {v:manCount,l:'Manual'},{v:totalSess,l:'Sesiones'},{v:totalDays,l:'Días uso'},
  ];
  grid.innerHTML = stats.map(s=>`
    <div class="settings-stat-card">
      <div class="settings-stat-val">${s.v}</div>
      <div class="settings-stat-label">${s.l}</div>
    </div>`).join('');
  const advEl = document.getElementById('settings-advanced-stats');
  if (!advEl) return;
  const rows=[];
  if (mostUsedWatch) rows.push({l:'Reloj más usado',v:`${mostUsedWatch.brand} ${mostUsedWatch.model} · ${mostUsedDays}d`});
  if (avgGap!==null) rows.push({l:'Media días entre usos',v:`${avgGap} días`});
  if (ws.length) rows.push({l:'Media días por reloj',v:`${Math.round(totalDays/ws.length)}d`});
  advEl.innerHTML = rows.map(r=>`
    <div class="interval-row" style="margin-bottom:6px;">
      <div class="interval-dates" style="color:var(--mid);font-size:12px;">${r.l}</div>
      <div class="interval-duration" style="color:var(--light);font-weight:500;">${r.v}</div>
    </div>`).join('');

  // Render session ID in settings
  renderSessionId();
}

async function handleExportPDF() {
  if (!getWatches().length) { showToast('No hay relojes'); return; }
  try { await generateCollectionPDF(); } catch(e) { showToast('Error PDF: '+e.message); }
}

function handleExportJSON() {
  const ws = getWatches();
  if (!ws.length) { showToast('No hay datos'); return; }
  const blob = new Blob([JSON.stringify({version:2,exported:Date.now(),watches:ws},null,2)],{type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download=`horlogerie-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
  URL.revokeObjectURL(url);
  showToast('Copia de seguridad descargada');
}

function handleImportJSON() { document.getElementById('import-json-input').click(); }

function processImportJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      const incoming = data.watches || (Array.isArray(data) ? data : null);
      if (!incoming) throw new Error('Formato no reconocido');
      showConfirm('Restaurar copia de seguridad',
        `Se importarán ${incoming.length} relojes. Los datos actuales se conservarán.`, async () => {
          const existingIds = new Set(getWatches().map(w=>w.id));
          let added = 0;
          for (const w of incoming) {
            if (!existingIds.has(w.id)) { watches.push(w); added++; }
          }
          save();
          showToast(`${added} relojes importados`);
          renderHome(); renderSettings();
        });
    } catch(err) { showToast('Error: '+err.message); }
    e.target.value = '';
  };
  reader.readAsText(file);
}

/* ─── Init ─── */
setTimeout(() => {
  document.getElementById('intro').classList.add('fade');
  setTimeout(() => document.getElementById('intro').style.display = 'none', 600);
}, 1600);

loadPhotos().then(() => renderHome());
// Check for updates silently on every launch
window.addEventListener('load', () => setTimeout(initVersionCheck, 2000));

/* ─── Expose globals ─── */
window.showView            = showView;
window.openAddModal        = openAddModal;
window.closeAddModal       = closeAddModal;
window.closeModalIfOutside = closeModalIfOutside;
window.openDetail          = openDetail;
window.handlePhotoUpload   = handlePhotoUpload;
window.openPhotoSheet      = openPhotoSheet;
window.closePhotoSheet     = closePhotoSheet;
window.closePhotoSheetIfOutside = closePhotoSheetIfOutside;
window.choosePhotoSource   = choosePhotoSource;
window.saveWatch           = saveWatch;
window.openEditModal       = openEditModal;
window.handleExportPDF     = handleExportPDF;
window.handleExportJSON    = handleExportJSON;
window.handleImportJSON    = handleImportJSON;
window.processImportJSON   = processImportJSON;
window.syncManual          = syncManual;
window.handleDbSearch      = handleDbSearch;
window.renderSettings      = renderSettings;

// showView extended for settings
const _showViewBase = showView;
window.showView = function(v) { _showViewBase(v); };

/* ══════════════════════════════════════════════════════
   WISHLIST
══════════════════════════════════════════════════════ */

let _wlEditingId = null;

const PRIORITY_CFG = {
  high:   { label: '🔥 Alta',  color: '#e57373' },
  medium: { label: '⭐ Media', color: '#D4AF6A' },
  low:    { label: '💭 Baja',  color: 'var(--mid)' },
};

/* ── Render wishlist view ── */
function renderWishlist() {
  const items  = getWishlist();
  const list   = document.getElementById('wishlist-list');
  const empty  = document.getElementById('wishlist-empty');
  const banner = document.getElementById('wishlist-export-banner');

  if (!items.length) {
    list.innerHTML = '';
    empty.style.display = 'flex';
    if (banner) banner.style.display = 'none';
    return;
  }

  empty.style.display = 'none';

  // Count items with enough specs to be useful in DB
  const exportable = items.filter(i => i.brand && i.model &&
    Object.values(i.specs || {}).some(v => v)).length;

  if (banner) {
    banner.style.display = exportable > 0 ? 'flex' : 'none';
    const countEl = banner.querySelector('.wl-exportable-count');
    if (countEl) countEl.textContent = exportable;
  }

  // Sort by priority
  const order = { high: 0, medium: 1, low: 2 };
  const sorted = [...items].sort((a, b) => (order[a.priority]||1) - (order[b.priority]||1));

  list.innerHTML = sorted.map(item => {
    const p = PRIORITY_CFG[item.priority] || PRIORITY_CFG.medium;
    const specCount = Object.values(item.specs || {}).filter(v => v).length;
    const specLabel = specCount > 0 ? `${specCount} specs guardadas` : 'Sin specs aún';
    return `
      <div class="wl-card" data-wlid="${escHtml(item.id)}">
        <div class="wl-card-header">
          <div class="wl-priority-dot" style="background:${p.color};" title="${p.label}"></div>
          <div class="wl-card-title">
            <div class="wl-brand">${escHtml(item.brand)}</div>
            <div class="wl-model">${escHtml(item.model)}${item.ref ? ` <span class="wl-ref">· ${escHtml(item.ref)}</span>` : ''}</div>
          </div>
          <div class="wl-card-actions">
            <button class="wl-btn-icon" data-action="edit" title="Editar"><i class="ti ti-edit"></i></button>
            <button class="wl-btn-icon" data-action="promote" title="Añadir a colección"><i class="ti ti-wrist-watch"></i></button>
            <button class="wl-btn-icon wl-btn-danger" data-action="delete" title="Eliminar"><i class="ti ti-trash"></i></button>
          </div>
        </div>
        <div class="wl-card-body">
          ${item.precio ? `<div class="wl-precio"><i class="ti ti-tag" style="font-size:12px;"></i> ${escHtml(item.precio)}</div>` : ''}
          <div class="wl-spec-count">${specLabel}</div>
          ${item.notas ? `<div class="wl-notas">${escHtml(item.notas)}</div>` : ''}
        </div>
        ${specCount > 0 ? `
        <div class="wl-specs-preview">
          ${item.specs.calibre ? `<span class="wl-spec-chip">${escHtml(item.specs.calibre)}</span>` : ''}
          ${item.specs.cristal ? `<span class="wl-spec-chip">${escHtml(item.specs.cristal)}</span>` : ''}
          ${item.specs.diametro ? `<span class="wl-spec-chip">⌀ ${escHtml(item.specs.diametro)}</span>` : ''}
          ${item.specs.resistencia ? `<span class="wl-spec-chip">${escHtml(item.specs.resistencia)}</span>` : ''}
        </div>` : ''}
      </div>`;
  }).join('');

  // Event delegation for card actions
  list.querySelectorAll('.wl-btn-icon').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const card = btn.closest('.wl-card');
      const id   = card.dataset.wlid;
      const action = btn.dataset.action;
      if (action === 'edit')    openWishlistEdit(id);
      if (action === 'promote') handleWishlistPromote(id);
      if (action === 'delete')  handleWishlistDelete(id);
    });
  });
}

/* ── Modal: add new ── */
function openWishlistAdd() {
  _wlEditingId = null;
  document.getElementById('wl-modal-title').textContent = 'Añadir a lista de deseos';
  document.getElementById('wl-save-btn').textContent    = 'Guardar';
  clearWishlistForm();
  document.getElementById('wishlist-modal').style.display = 'flex';
}

/* ── Modal: edit existing ── */
function openWishlistEdit(id) {
  const item = getWishlist().find(i => i.id === id);
  if (!item) return;
  _wlEditingId = id;
  document.getElementById('wl-modal-title').textContent = 'Editar reloj deseado';
  document.getElementById('wl-save-btn').textContent    = 'Actualizar';
  document.getElementById('wl-brand').value      = item.brand;
  document.getElementById('wl-model').value      = item.model;
  document.getElementById('wl-ref').value        = item.ref || '';
  document.getElementById('wl-type').value       = item.type;
  document.getElementById('wl-priority').value   = item.priority;
  document.getElementById('wl-precio').value     = item.precio || '';
  document.getElementById('wl-notas').value      = item.notas  || '';
  // Specs
  const s = item.specs || {};
  ['calibre','cristal','diametro','grosor','resistencia','reserva','caja','brazalete','esfera'].forEach(k => {
    const el = document.getElementById('wl-' + k);
    if (el) el.value = s[k] || '';
  });
  document.getElementById('wishlist-modal').style.display = 'flex';
}

function clearWishlistForm() {
  ['wl-brand','wl-model','wl-ref','wl-precio','wl-notas',
   'wl-calibre','wl-cristal','wl-diametro','wl-grosor',
   'wl-resistencia','wl-reserva','wl-caja','wl-brazalete','wl-esfera']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('wl-type').value     = 'automatic';
  document.getElementById('wl-priority').value = 'medium';
}

function closeWishlistModal() {
  document.getElementById('wishlist-modal').style.display = 'none';
}
function closeWishlistModalIfOutside(e) {
  if (e.target.id === 'wishlist-modal') closeWishlistModal();
}

/* ── Save ── */
function saveWishlistItem() {
  const brand = document.getElementById('wl-brand').value.trim();
  const model = document.getElementById('wl-model').value.trim();
  if (!brand) { showToast('Introduce la marca'); return; }
  if (!model) { showToast('Introduce el modelo'); return; }

  const data = {
    brand, model,
    ref:      document.getElementById('wl-ref').value.trim(),
    type:     document.getElementById('wl-type').value,
    priority: document.getElementById('wl-priority').value,
    precio:   document.getElementById('wl-precio').value.trim(),
    notas:    document.getElementById('wl-notas').value.trim(),
    calibre:  document.getElementById('wl-calibre').value.trim(),
    cristal:  document.getElementById('wl-cristal').value.trim(),
    diametro: document.getElementById('wl-diametro').value.trim(),
    grosor:   document.getElementById('wl-grosor').value.trim(),
    resistencia: document.getElementById('wl-resistencia').value.trim(),
    reserva:  document.getElementById('wl-reserva').value.trim(),
    caja:     document.getElementById('wl-caja').value.trim(),
    brazalete:document.getElementById('wl-brazalete').value.trim(),
    esfera:   document.getElementById('wl-esfera').value.trim(),
  };

  if (_wlEditingId) {
    const items = getWishlist();
    const idx = items.findIndex(i => i.id === _wlEditingId);
    if (idx !== -1) {
      items[idx] = { ...items[idx], ...data,
        specs: {
          calibre: data.calibre, cristal: data.cristal,
          diametro: data.diametro, grosor: data.grosor,
          resistencia: data.resistencia, reserva: data.reserva,
          caja: data.caja, brazalete: data.brazalete, esfera: data.esfera,
        }
      };
      saveWishlist(items);
    }
    showToast('Reloj actualizado');
  } else {
    addWishlistItem(data);
    showToast(`${brand} ${model} añadido a deseos`);
  }

  closeWishlistModal();
  renderWishlist();
}

/* ── Promote to collection ── */
async function handleWishlistPromote(id) {
  const item = getWishlist().find(i => i.id === id);
  if (!item) return;
  showConfirm(
    '¿Añadir a tu colección?',
    `${item.brand} ${item.model} pasará a tu colección de relojes. Podrás añadirle foto después.`,
    async () => {
      const watchData = promoteWishlistToCollection(id);
      const newWatch  = await addWatch(watchData);
      if (watchData.specs) await updateWatch(newWatch.id, { specs: watchData.specs, _source: 'wishlist' });
      deleteWishlistItem(id);
      showToast(`¡${item.brand} ${item.model} añadido a la colección!`);
      renderWishlist();
      renderHome();
    }
  );
}

/* ── Delete ── */
function handleWishlistDelete(id) {
  const item = getWishlist().find(i => i.id === id);
  if (!item) return;
  showConfirm('¿Eliminar de deseos?', `Se eliminará ${item.brand} ${item.model} de la lista.`, () => {
    deleteWishlistItem(id);
    showToast('Eliminado de deseos');
    renderWishlist();
  });
}

/* ── Export to DB JSON ── */
function exportWishlistToDb() {
  const items = getWishlist().filter(i =>
    i.brand && i.model && Object.values(i.specs || {}).some(v => v)
  );
  if (!items.length) { showToast('No hay items con specs para exportar'); return; }

  // Build DB-compatible JSON entries
  const dbEntries = items.map((item, idx) => ({
    id:    9000 + idx,  // high ID range to avoid conflicts with existing DB
    brand: item.brand,
    model: item.model,
    ref:   item.ref || '',
    type:  item.type,
    specs: {
      calibre:     item.specs.calibre     || '',
      movimiento:  item.type === 'automatic' ? 'Automático' : item.type === 'quartz' ? 'Cuarzo' : 'Manual',
      cristal:     item.specs.cristal     || '',
      brazalete:   item.specs.brazalete   || '',
      esfera:      item.specs.esfera      || '',
      caja:        item.specs.caja        || '',
      resistencia: item.specs.resistencia || '',
      reserva:     item.specs.reserva     || '',
      diametro:    item.specs.diametro    || '',
      grosor:      item.specs.grosor      || '',
    },
    price: { value: item.precio || '', note: 'Lista de deseos' },
    _source: 'wishlist_export',
    notas:   item.notas || '',
  }));

  const blob = new Blob([JSON.stringify(dbEntries, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `horlogerie_wishlist_db_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`${dbEntries.length} relojes exportados a JSON`);
}

window.openWishlistAdd             = openWishlistAdd;
window.openWishlistEdit            = openWishlistEdit;
window.closeWishlistModal          = closeWishlistModal;
window.closeWishlistModalIfOutside = closeWishlistModalIfOutside;
window.saveWishlistItem            = saveWishlistItem;
window.exportWishlistToDb          = exportWishlistToDb;
window.renderWishlist              = renderWishlist;

/* ══════════════════════════════════════════════════════
   SESSION MANAGEMENT
   Each user has a UUID stored in localStorage.
   They can share it to sync across devices.
══════════════════════════════════════════════════════ */

function renderSessionId() {
  const el = document.getElementById('session-id-display');
  if (!el) return;
  const id = getSessionId();
  // Show truncated for display, full on copy
  el.textContent = id;
  el.title = id;
}

function copySessionId() {
  const id = getSessionId();
  navigator.clipboard.writeText(id)
    .then(() => showToast('ID copiado al portapapeles'))
    .catch(() => {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = id;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('ID copiado');
    });
}

function showQR() {
  const id   = getSessionId();
  const modal = document.getElementById('qr-modal');
  if (!modal) return;
  document.getElementById('qr-session-id').textContent = id;

  // Generate QR using a free QR API (no key needed)
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(id)}&bgcolor=1A1A1A&color=D4AF6A`;
  const img   = document.getElementById('qr-img');
  if (img) { img.src = qrUrl; img.style.display = 'block'; }

  modal.style.display = 'flex';
}

function closeQR() {
  const modal = document.getElementById('qr-modal');
  if (modal) modal.style.display = 'none';
}

function openImportSession() {
  const modal = document.getElementById('import-session-modal');
  if (!modal) return;
  document.getElementById('import-session-input').value = '';
  document.getElementById('import-session-status').textContent = '';
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('import-session-input').focus(), 100);
}

function closeImportSession() {
  const modal = document.getElementById('import-session-modal');
  if (modal) modal.style.display = 'none';
}

async function handleImportSession() {
  const input = document.getElementById('import-session-input').value.trim();
  const status = document.getElementById('import-session-status');

  if (!input) { status.textContent = 'Introduce un ID de sesión'; status.style.color = 'rgba(220,80,80,0.8)'; return; }

  // Basic UUID format validation
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(input)) {
    status.textContent = 'Formato de ID incorrecto. Debe ser: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
    status.style.color = 'rgba(220,80,80,0.8)'; return;
  }

  if (input === getSessionId()) {
    status.textContent = 'Este ya es tu ID actual';
    status.style.color = 'var(--gold)'; return;
  }

  const btn = document.querySelector('#import-session-modal .modal-btn-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Verificando…'; }
  status.textContent = 'Buscando sesión en la nube…';
  status.style.color = 'var(--mid)';

  const ok = await importSession(input);

  if (btn) { btn.disabled = false; btn.textContent = 'Importar'; }

  if (ok) {
    closeImportSession();
    renderHome();
    renderSettings();
    renderSessionId();
  } else {
    status.textContent = 'No se encontró ninguna colección con ese ID.';
    status.style.color = 'rgba(220,80,80,0.8)';
  }
}

// Expose all session functions globally
window.renderSessionId    = renderSessionId;
window.copySessionId      = copySessionId;
window.showQR             = showQR;
window.closeQR            = closeQR;
window.openImportSession  = openImportSession;
window.closeImportSession = closeImportSession;
window.handleImportSession = handleImportSession;

/* ══════════════════════════════════════════════════════
   VERSION CHECK & AUTO-UPDATE
   Compares local APP_VERSION with /version.json on server.
   Works on iOS PWA where SW update is unreliable.
══════════════════════════════════════════════════════ */

const APP_VERSION = '1.2.0'; // Must match version.json

async function initVersionCheck() {
  // Show current version in UI
  const vEl = document.getElementById('app-version-display');
  const dEl = document.getElementById('app-version-date');
  if (vEl) vEl.textContent = APP_VERSION;

  // Silent check on every launch — fetch version.json bypassing cache
  try {
    const res = await fetch('./version.json?t=' + Date.now(), {
      cache: 'no-store'
    });
    if (!res.ok) return;
    const data = await res.json();
    if (dEl && data.date) dEl.textContent = `Publicada el ${data.date}`;
    if (data.version && data.version !== APP_VERSION) {
      // New version available — show banner and force reload
      showUpdateBanner(data.version, data.notes);
    }
  } catch {
    // Offline — skip silently
  }
}

function showUpdateBanner(newVersion, notes) {
  // Show a persistent banner at top of screen
  const existing = document.getElementById('update-banner');
  if (existing) return;

  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
    background: var(--gold); color: var(--dark);
    padding: calc(env(safe-area-inset-top, 0px) + 10px) 16px 12px;
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; font-family: var(--font-body); font-size: 13px;
    font-weight: 500; cursor: pointer; box-shadow: 0 2px 12px rgba(0,0,0,0.3);
  `;
  banner.innerHTML = `
    <div>
      <span>⬆️ Nueva versión ${newVersion} disponible</span>
      ${notes ? `<div style="font-size:11px;font-weight:400;opacity:0.8;margin-top:2px;">${escHtml(notes)}</div>` : ''}
    </div>
    <button style="background:var(--dark);color:var(--gold);border:none;border-radius:8px;
      padding:7px 14px;font-family:var(--font-body);font-size:12px;font-weight:600;cursor:pointer;
      white-space:nowrap;" onclick="applyUpdate()">Actualizar</button>
  `;
  document.body.appendChild(banner);
}

async function checkForUpdate() {
  const btn = document.getElementById('check-update-btn');
  const status = document.getElementById('update-status');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span> Comprobando…'; }
  if (status) status.textContent = '';

  try {
    const res = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('No se pudo conectar');
    const data = await res.json();

    const vEl = document.getElementById('app-version-display');
    const dEl = document.getElementById('app-version-date');
    if (vEl) vEl.textContent = data.version || APP_VERSION;
    if (dEl && data.date) dEl.textContent = `Publicada el ${data.date}`;

    if (data.version && data.version !== APP_VERSION) {
      if (status) {
        status.style.color = '#4CAF50';
        status.innerHTML = `✓ Nueva versión <strong>${data.version}</strong> disponible. Actualizando…`;
      }
      setTimeout(() => applyUpdate(), 1200);
    } else {
      if (status) {
        status.style.color = '#4CAF50';
        status.textContent = '✓ Ya tienes la versión más reciente';
      }
    }
  } catch (e) {
    if (status) {
      status.style.color = 'rgba(220,80,80,0.8)';
      status.textContent = 'Sin conexión. Conéctate e inténtalo de nuevo.';
    }
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-refresh"></i> Buscar actualización'; }
}

async function applyUpdate() {
  // 1. Unregister SW so it doesn't serve stale cache
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
  }
  // 2. Clear all caches
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
  }
  // 3. Hard reload — browser fetches everything fresh
  window.location.reload(true);
}

window.checkForUpdate = checkForUpdate;
window.applyUpdate    = applyUpdate;
