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
    const days     = isActive ? daysSince(w.wearStart) : null;
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
          ${isActive ? `<div class="days-badge">Día ${days + 1}</div>` : ''}
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

  const { watch: w, daysSinceLastWorn } = ranked[0];
  const color = daysSinceLastWorn === null || daysSinceLastWorn > 25 ? '#e57373'
    : daysSinceLastWorn > 14 ? '#D4AF6A' : '#4CAF50';
  const text = daysSinceLastWorn === null
    ? 'Nunca usado — ¡el aceite se seca!'
    : daysSinceLastWorn > 25 ? `Hace ${daysSinceLastWorn} días — necesita movimiento`
    : daysSinceLastWorn > 14 ? `Hace ${daysSinceLastWorn} días — ponértelo pronto`
    : `Hace ${daysSinceLastWorn} días — al día`;

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
    const lastWorn = all.length ? Math.max(...all.map(i => i.end || i.start)) : null;
    const daysSinceLastWorn = lastWorn ? Math.floor((Date.now() - lastWorn) / 86400000) : null;
    const base = daysSinceLastWorn === null ? 9999 : daysSinceLastWorn;
    const score = (w.type === 'automatic' || w.type === 'manual') ? base * 1.3 : base;
    return { watch: w, daysSinceLastWorn, score };
  }).sort((a, b) => b.score - a.score);
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
  const d = daysSince(w.wearStart);
  const el = document.getElementById('d-days');
  const se = document.getElementById('d-since');
  if (el) el.textContent = `${d + 1} ${d === 0 ? 'día' : 'días'}`;
  if (se) se.textContent = `Desde el ${formatDate(w.wearStart)}`;
}
function startActiveTimer(id) {
  stopActiveTimer();
  const w = getWatch(id);
  if (!w?.wearStart) return;
  _activeTimer = setInterval(() => { const c = getWatch(id); if (c?.wearStart) updateDayCounter(c); }, 60000);
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
        const d = durationDays(i.start, i.end || Date.now());
        return `<div class="interval-row">
          <div class="interval-dates">${formatDate(i.start)} → ${i.active ? 'hoy' : formatDate(i.end)}</div>
          <div class="interval-duration">${d}d${i.active ? ' <span style="color:#4CAF50">●</span>' : ''}</div>
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
