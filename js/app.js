/**
 * app.js — UI logic. Depends on storage.js and api.js.
 *
 * AUDIT FIXES v3:
 * - identifyWatch: campos editables post-identificación + botón "Re-identificar"
 * - renderHome: no más innerHTML con IDs de usuario sin escapar en onclick attrs → usa dataset
 * - renderHome: día activo se actualiza en tiempo real con setInterval
 * - openDetail: currentWatchId se expone limpiamente; no XSS en onclick attrs
 * - renderSpecs: specs editables inline (click para editar)
 * - history: totalDays calcula correctamente duración de cada sesión
 * - resizeImage: calidad JPEG sube a 0.88 para mejor identificación visual
 * - saveWatch: trim en todos los campos + validación de tipo
 * - showView: scroll al top en cada vista
 * - deleteWatch: confirmación nativa reemplazada por modal propio (UX móvil)
 * - Intervalos del historial: duración calculada correctamente (end-start, no daysSince)
 */

let currentWatchId   = null;
let editingPhotoData = null;
let editingWatchId   = null;
let historySelectedWatch = null;
let historySelectedYear  = null;
let _activeTimer = null;  // setInterval for live day counter

/* ─────────────────── UTILITIES ─────────────────── */

function showToast(msg, dur = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), dur);
}

function durationDays(startTs, endTs) {
  // How many calendar days between two timestamps (minimum 1)
  return Math.max(1, Math.ceil((endTs - startTs) / (1000 * 60 * 60 * 24)));
}

function daysSince(ts) {
  return Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

function watchEmoji(type) {
  return type === 'automatic' ? '⚙️' : type === 'quartz' ? '🔋' : '🕰️';
}

function typeLabel(type) {
  return type === 'automatic' ? 'Auto' : type === 'quartz' ? 'Quartz' : 'Manual';
}

function renderRecommendation(ws, activeW) {
  let banner = document.getElementById('recommendation-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'recommendation-banner';
    const grid = document.getElementById('watches-grid');
    grid.parentNode.insertBefore(banner, grid);
  }

  if (activeW) { banner.innerHTML = ''; return; }

  const ranked = rankWatchesByNeed(ws);
  if (!ranked.length) { banner.innerHTML = ''; return; }

  const { watch: w, daysSinceLastWorn } = ranked[0];

  const urgencyColor = daysSinceLastWorn === null || daysSinceLastWorn > 25
    ? '#e57373'
    : daysSinceLastWorn > 14 ? '#D4AF6A' : '#4CAF50';

  const urgencyText = daysSinceLastWorn === null
    ? 'Nunca usado — ¡el aceite se seca!'
    : daysSinceLastWorn > 25
    ? `Hace ${daysSinceLastWorn} días — necesita movimiento`
    : daysSinceLastWorn > 14
    ? `Hace ${daysSinceLastWorn} días — ponértelo pronto`
    : `Hace ${daysSinceLastWorn} días — al día`;

  banner.innerHTML = `
    <div class="recommendation-card" data-rec-id="${escHtml(w.id)}">
      <div class="rec-icon">
        <i class="ti ti-alarm" style="color:${urgencyColor};font-size:20px;"></i>
      </div>
      <div class="rec-body">
        <div class="rec-label">Recomendación de uso</div>
        <div class="rec-watch">${escHtml(w.brand)} ${escHtml(w.model)}</div>
        <div class="rec-reason" style="color:${urgencyColor};">${urgencyText}</div>
      </div>
      <i class="ti ti-chevron-right" style="color:var(--mid);font-size:18px;flex-shrink:0;"></i>
    </div>`;

  // Safe: addEventListener after DOM is written
  banner.querySelector('.recommendation-card')
    .addEventListener('click', () => openDetail(w.id));
}

function rankWatchesByNeed(ws) {
  return ws
    .filter(w => !w.wearStart) // exclude currently active
    .map(w => {
      const all = [...(w.history || [])];
      const lastWorn = all.length
        ? Math.max(...all.map(i => i.end || i.start))
        : null;
      const daysSinceLastWorn = lastWorn
        ? Math.floor((Date.now() - lastWorn) / 86400000)
        : null; // null = never worn

      // Score: higher = more urgent
      // Automatic watches get a 1.3x urgency multiplier (oil drying concern)
      const baseScore = daysSinceLastWorn === null ? 9999 : daysSinceLastWorn;
      const score     = w.type === 'automatic' || w.type === 'manual'
        ? baseScore * 1.3 : baseScore;

      return { watch: w, daysSinceLastWorn, score };
    })
    .sort((a, b) => b.score - a.score); // most urgent first
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─────────────────── NAVIGATION ─────────────────── */

function showView(v) {
  document.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
  document.getElementById('view-' + v).classList.add('active');
  const navEl = document.getElementById('nav-' + v);
  if (navEl) navEl.classList.add('active');

  // Stop live timer when leaving detail
  if (v !== 'detail') stopActiveTimer();

  if (v === 'home')    renderHome();
  if (v === 'history') renderHistory();

  document.getElementById('view-' + v).scrollTop = 0;
}

/* ─────────────────── HOME ─────────────────── */

function renderHome() {
  const grid  = document.getElementById('watches-grid');
  const empty = document.getElementById('empty-state');
  const ws    = getWatches();
  const activeW = getActiveWatch();

  const dot = document.getElementById('status-dot');
  dot.className = 'status-dot ' + (activeW ? 'dot-active' : 'dot-none');
  document.getElementById('status-text').textContent = activeW ? 'Reloj activo' : 'Ningún reloj activo';
  document.getElementById('status-watch-name').textContent = activeW
    ? `${activeW.brand} ${activeW.model}` : '';

  if (!ws.length) {
    grid.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }
  grid.style.display = 'grid';
  empty.style.display = 'none';

  // ── Recommendation banner ──
  renderRecommendation(ws, activeW);

  grid.innerHTML = ws.map(w => {
    const isActive = !!w.wearStart;
    const locked   = !!(activeW && !isActive);
    const days     = isActive ? daysSince(w.wearStart) : null;
    return `
      <div class="watch-card${locked ? ' locked' : ''}${isActive ? ' active-card' : ''}"
           data-id="${escHtml(w.id)}" data-locked="${locked}">
        <div class="watch-img-wrap">
          ${w.photo
            ? `<img src="${w.photo}" alt="${escHtml(w.brand)} ${escHtml(w.model)}" loading="lazy">`
            : `<div class="watch-img-placeholder">${watchEmoji(w.type)}</div>`}
          <div class="watch-type-badge">${typeLabel(w.type)}</div>
          ${isActive ? `<div class="active-badge">Puesto</div>` : ''}
          ${locked ? `<div class="locked-badge"><i class="ti ti-eye"></i></div>` : ''}
        </div>
        <div class="watch-info">
          <div class="watch-brand">${escHtml(w.brand)}</div>
          <div class="watch-model">${escHtml(w.model)}</div>
          ${isActive ? `<div class="days-badge">Día ${days + 1}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  // All cards clickable — locked ones open in read-only mode
  grid.querySelectorAll('.watch-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

/* ─────────────────── DETAIL ─────────────────── */

function openDetail(id) {
  currentWatchId = id;
  const w = getWatch(id);
  if (!w) return;

  document.getElementById('d-brand').textContent = w.brand;
  document.getElementById('d-name').textContent  = w.model + (w.ref ? ` · ${w.ref}` : '');

  const img         = document.getElementById('d-img');
  const placeholder = document.getElementById('d-img-placeholder');
  if (w.photo) {
    img.src = w.photo; img.style.display = 'block';
    placeholder.style.display = 'none';
  } else {
    img.style.display = 'none';
    placeholder.style.display = 'flex';
    placeholder.textContent = watchEmoji(w.type);
  }

  renderWearInfo(w);
  renderDetailActions(w);
  renderSpecs(w);
  renderPrice(w);
  document.getElementById('d-fetch-status').innerHTML = '';

  // Notes section
  const notesEl = document.getElementById('d-notes-val');
  if (notesEl) notesEl.textContent = w.notes || '—';

  showView('detail');
  startActiveTimer(id);
}

function renderWearInfo(w) {
  const box = document.getElementById('d-wear-info');
  if (w.wearStart) {
    box.style.display = 'block';
    updateDayCounter(w);
  } else {
    box.style.display = 'none';
  }
}

function updateDayCounter(w) {
  const d = daysSince(w.wearStart);
  const daysEl = document.getElementById('d-days');
  const sinceEl = document.getElementById('d-since');
  if (daysEl) daysEl.textContent = `${d + 1} ${d === 0 ? 'día' : 'días'}`;
  if (sinceEl) sinceEl.textContent = `Desde el ${formatDate(w.wearStart)}`;
}

function startActiveTimer(id) {
  stopActiveTimer();
  const w = getWatch(id);
  if (!w?.wearStart) return;
  _activeTimer = setInterval(() => {
    const current = getWatch(id);
    if (current?.wearStart) updateDayCounter(current);
  }, 60000); // update every minute
}

function stopActiveTimer() {
  if (_activeTimer) { clearInterval(_activeTimer); _activeTimer = null; }
}

function renderDetailActions(w) {
  const div     = document.getElementById('d-actions');
  const activeW = getActiveWatch();

  if (w.wearStart) {
    // This IS the active watch
    div.innerHTML = `
      <button class="action-btn btn-stop" id="btn-stop-wear">
        <i class="ti ti-player-stop" aria-hidden="true"></i> Quitarme este reloj
      </button>`;
    document.getElementById('btn-stop-wear')
      .addEventListener('click', () => handleStopWearing(w.id));

  } else if (!activeW) {
    // No active watch — can wear this one
    div.innerHTML = `
      <button class="action-btn btn-wear" id="btn-start-wear">
        <i class="ti ti-wrist-watch" aria-hidden="true"></i> Ponerme este reloj
      </button>`;
    document.getElementById('btn-start-wear')
      .addEventListener('click', () => handleStartWearing(w.id));

  } else {
    // Another watch is active — read-only view
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

/* Specs — editable inline */
function renderSpecs(w) {
  const specs = w.specs || {};
  const defs = [
    { k: 'calibre',     l: 'Calibre' },
    { k: 'movimiento',  l: 'Movimiento' },
    { k: 'cristal',     l: 'Cristal' },
    { k: 'brazalete',   l: 'Brazalete' },
    { k: 'esfera',      l: 'Esfera' },
    { k: 'caja',        l: 'Caja' },
    { k: 'resistencia', l: 'Agua' },
    { k: 'reserva',     l: 'Reserva' },
    { k: 'diametro',    l: 'Diámetro' },
    { k: 'grosor',      l: 'Grosor' },
  ];
  const grid = document.getElementById('d-specs');
  grid.innerHTML = defs.map(s => `
    <div class="spec-card" data-key="${s.k}" title="Toca para editar">
      <div class="spec-label">${s.l}</div>
      <div class="spec-value" id="spec-val-${s.k}">${escHtml(specs[s.k] || '—')}</div>
    </div>`).join('');

  grid.querySelectorAll('.spec-card').forEach(card => {
    card.addEventListener('click', () => editSpecInline(card.dataset.key, w));
  });
}

function editSpecInline(key, w) {
  const valEl = document.getElementById('spec-val-' + key);
  if (!valEl) return;
  const current = (w.specs || {})[key] || '';

  // Replace with input
  const input = document.createElement('input');
  input.className  = 'spec-input-inline';
  input.value      = current === '—' ? '' : current;
  input.placeholder = 'Añadir valor...';
  valEl.replaceWith(input);
  input.focus();
  input.select();

  function commit() {
    const newVal = input.value.trim();
    const newSpecs = { ...(getWatch(w.id)?.specs || {}), [key]: newVal };
    updateWatch(w.id, { specs: newSpecs });
    const updated = getWatch(w.id);
    // Re-render just this cell
    const newValEl = document.createElement('div');
    newValEl.className = 'spec-value';
    newValEl.id = 'spec-val-' + key;
    newValEl.textContent = newVal || '—';
    input.replaceWith(newValEl);
    if (newVal) showToast('Especificación guardada');
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') {
      const revert = document.createElement('div');
      revert.className = 'spec-value';
      revert.id = 'spec-val-' + key;
      revert.textContent = current || '—';
      input.replaceWith(revert);
    }
  });
}

function renderPrice(w) {
  const box = document.getElementById('d-price-box');
  if (w.price?.value) {
    box.style.display = 'block';
    document.getElementById('d-price').textContent = w.price.value;
    let noteText = w.price.note || '';
    if (w.sources) noteText += (noteText ? ' · ' : '') + w.sources;
    document.getElementById('d-price-note').textContent = noteText;
  } else {
    box.style.display = 'none';
  }

  // Source badge
  const existing = document.getElementById('d-source-badge');
  if (existing) existing.remove();
  if (!w._source) return;

  const badge = document.createElement('div');
  badge.id = 'd-source-badge';

  const src = w._source || '';
  const isReal = src.includes('calibercorner') || src.includes('watchbase') || src.includes('oficial') || src.includes('ebay');

  const sourceLabels = [];
  if (src.includes('calibercorner')) {
    sourceLabels.push('<a href="https://calibercorner.com" target="_blank" style="color:inherit;text-decoration:none;">CaliberCorner</a>');
  }
  if (src.includes('watchbase')) {
    const wb = w._watchbase;
    const wbText = wb?.updated ? `WatchBase (act. ${wb.updated})` : 'WatchBase';
    sourceLabels.push(`<a href="https://watchbase.com" target="_blank" style="color:inherit;text-decoration:none;">${wbText}</a>`);
  }
  if (src.includes('oficial')) {
    const off = w._official;
    sourceLabels.push(`<span title="${off?.source || ''}">Web oficial</span>`);
  }
  if (src.includes('ebay')) {
    const eb = w._ebay;
    const ebText = eb?.count ? `eBay (${eb.count} anuncios)` : 'eBay';
    sourceLabels.push(`<a href="https://www.ebay.es/sch/Wristwatches/31387/i.html?_nkw=${encodeURIComponent((w.brand||'')+' '+(w.model||''))}" target="_blank" style="color:inherit;text-decoration:none;">${ebText}</a>`);
  }
  if (src.includes('web')) {
    sourceLabels.push('Búsqueda web');
  }

  if (isReal) {
    badge.style.cssText = 'font-size:11px;color:#4CAF50;display:flex;align-items:center;gap:5px;padding:4px 0 10px;flex-wrap:wrap;';
    badge.innerHTML = `<i class="ti ti-database-check"></i> Datos verificados · ${sourceLabels.join(' + ')}`;
  } else {
    badge.style.cssText = 'font-size:11px;color:var(--gold);display:flex;align-items:center;gap:5px;padding:4px 0 10px;';
    badge.innerHTML = `<i class="ti ti-alert-triangle"></i> ${w._warning || 'Estimación IA — puede contener errores'}`;
  }

  document.getElementById('d-specs')?.insertAdjacentElement('afterend', badge);
}

/* ─────────────────── WEAR ACTIONS ─────────────────── */

function handleStartWearing(id) {
  const w = getWatch(id);
  if (startWearing(id)) {
    showToast(`¡Disfruta del ${w.brand} ${w.model}!`);
    openDetail(id);
  }
}

function handleStopWearing(id) {
  if (stopWearing(id)) {
    showToast('Intervalo registrado en el historial');
    stopActiveTimer();
    showView('home');
  }
}

/* ─────────────────── DELETE (custom confirm) ─────────────────── */

function handleDeleteWatch(id) {
  showConfirm(
    '¿Eliminar reloj?',
    'Se borrará el reloj y todo su historial. Esta acción no se puede deshacer.',
    () => {
      deleteWatch(id);
      showView('home');
      showToast('Reloj eliminado');
    }
  );
}
window.deleteWatch = handleDeleteWatch;

function showConfirm(title, msg, onConfirm) {
  // Reuse modal overlay with a mini confirm sheet
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'display:flex;z-index:400;';
  overlay.innerHTML = `
    <div class="modal-sheet" style="padding-bottom:max(20px,env(safe-area-inset-bottom));">
      <div class="modal-handle"></div>
      <div style="font-family:var(--font-display);font-size:20px;color:var(--light);margin-bottom:8px;">${escHtml(title)}</div>
      <div style="font-size:13px;color:var(--mid);line-height:1.6;margin-bottom:20px;">${escHtml(msg)}</div>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-cancel" id="confirm-cancel">Cancelar</button>
        <button class="modal-btn" id="confirm-ok"
          style="background:rgba(220,80,80,0.85);color:#fff;flex:1;">Eliminar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#confirm-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#confirm-ok').addEventListener('click', () => { overlay.remove(); onConfirm(); });
}

/* ─────────────────── FETCH DETAILS ─────────────────── */

async function fetchWatchDetails(id) {
  const w = getWatch(id);
  if (!w) return;

  const btn      = document.getElementById('d-fetch-btn');
  const statusEl = document.getElementById('d-fetch-status');
  btn.disabled   = true;
  btn.innerHTML  = '<span class="loading-spinner"></span> Buscando en CaliberCorner y WatchBase...';
  statusEl.innerHTML = `<div class="identify-progress" style="margin-bottom:8px;">
    <span class="loading-spinner"></span>
    <span>Consultando bases de datos especializadas…</span>
  </div>`;

  try {
    const data = await apiFetchDetails(w.brand, w.model, w.ref || '', w.type);
    const toSave = {};
    if (data.specs)     toSave.specs     = data.specs;
    if (data.price)     toSave.price     = data.price;
    if (data._source)   toSave._source   = data._source;
    if (data._watchbase)toSave._watchbase= data._watchbase;
    if (data._warning)  toSave._warning  = data._warning;
    if (data.sources)   toSave.sources   = data.sources;
    if (Object.keys(toSave).length) await updateWatch(id, toSave);
    renderSpecs(getWatch(id));
    renderPrice(getWatch(id));
    statusEl.innerHTML = `<div class="fetch-status-ok"><i class="ti ti-check"></i> Información actualizada</div>`;
    showToast('Detalles encontrados');
  } catch (e) {
    statusEl.innerHTML = `<div class="fetch-status-err"><i class="ti ti-alert-circle"></i> ${escHtml(e.message)}</div>`;
  }

  btn.disabled  = false;
  btn.innerHTML = '<i class="ti ti-wand" aria-hidden="true"></i> Buscar información completa';
}
window.fetchWatchDetails = fetchWatchDetails;

/* ─────────────────── ADD / EDIT MODAL ─────────────────── */

function resetModal() {
  document.getElementById('f-brand').value   = '';
  document.getElementById('f-model').value   = '';
  document.getElementById('f-ref').value     = '';
  document.getElementById('f-type').value    = 'automatic';
  document.getElementById('f-notes').value   = '';
  document.getElementById('photo-preview').style.display  = 'none';
  document.getElementById('identify-btn').style.display   = 'none';
  document.getElementById('identify-status').innerHTML    = '';
  document.getElementById('identify-result-fields').style.display = 'none';
  editingPhotoData = null;
}

function openAddModal() {
  editingWatchId = null;
  resetModal();
  document.getElementById('modal-title-text').textContent = 'Añadir Reloj';
  document.getElementById('modal-save-btn').textContent   = 'Guardar';
  document.getElementById('add-modal').style.display = 'flex';
}

function openEditModal(id) {
  const w = getWatch(id);
  if (!w) return;
  editingWatchId   = id;
  editingPhotoData = w.photo || null;

  document.getElementById('modal-title-text').textContent = 'Editar Reloj';
  document.getElementById('modal-save-btn').textContent   = 'Actualizar';
  document.getElementById('f-brand').value  = w.brand;
  document.getElementById('f-model').value  = w.model;
  document.getElementById('f-ref').value    = w.ref || '';
  document.getElementById('f-type').value   = w.type;
  document.getElementById('f-notes').value  = w.notes || '';
  document.getElementById('identify-status').innerHTML = '';
  document.getElementById('identify-result-fields').style.display = 'none';

  const prev = document.getElementById('photo-preview');
  if (w.photo) { prev.src = w.photo; prev.style.display = 'block'; }
  else { prev.style.display = 'none'; }
  document.getElementById('identify-btn').style.display = w.photo ? 'flex' : 'none';
  document.getElementById('add-modal').style.display = 'flex';
}
window.openEditModal = openEditModal;

function closeAddModal() {
  document.getElementById('add-modal').style.display = 'none';
}

function closeModalIfOutside(e) {
  if (e.target.id === 'add-modal') closeAddModal();
}

/* ─────────────────── PHOTO SHEET ─────────────────── */

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
  const inputId = source === 'camera' ? 'photo-input-camera' : 'photo-input-library';
  document.getElementById(inputId).click();
}
window.openPhotoSheet           = openPhotoSheet;
window.closePhotoSheet          = closePhotoSheet;
window.closePhotoSheetIfOutside = closePhotoSheetIfOutside;
window.choosePhotoSource        = choosePhotoSource;

function handlePhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    resizeImage(ev.target.result, 900).then(resized => {
      editingPhotoData = resized;
      const prev = document.getElementById('photo-preview');
      prev.src = resized; prev.style.display = 'block';
      document.getElementById('identify-btn').style.display = 'flex';
      document.getElementById('identify-result-fields').style.display = 'none';
    });
  };
  reader.readAsDataURL(file);
}

function resizeImage(dataUrl, maxSize) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.88)); // higher quality for AI
    };
    img.src = dataUrl;
  });
}

/* ── identifyWatch: 2-pass with editable result fields ── */
async function identifyWatch() {
  if (!editingPhotoData) return;
  const btn       = document.getElementById('identify-btn');
  const status    = document.getElementById('identify-status');
  const resFields = document.getElementById('identify-result-fields');

  btn.disabled   = true;
  resFields.style.display = 'none';
  status.innerHTML = `<div class="identify-progress">
    <span class="loading-spinner"></span>
    <span id="identify-step-label"><strong>Paso 1/2</strong> — Analizando esfera, agujas, bisel...</span>
  </div>`;
  btn.innerHTML = '<span class="loading-spinner"></span> Analizando foto...';

  const stepTimer = setTimeout(() => {
    const el = document.getElementById('identify-step-label');
    if (el) el.innerHTML = '<strong>Paso 2/2</strong> — Identificando marca y modelo...';
    btn.innerHTML = '<span class="loading-spinner"></span> Identificando...';
  }, 3800);

  try {
    const base64    = editingPhotoData.split(',')[1];
    const mediaType = editingPhotoData.split(';')[0].split(':')[1];
    const info = await apiIdentifyWatch(base64, mediaType);
    clearTimeout(stepTimer);
    if (info.error) throw new Error(info.error);

    const confidenceColor = info.confidence === 'high' ? '#4CAF50'
      : info.confidence === 'medium' ? '#D4AF6A' : 'rgba(220,80,80,0.8)';
    const confidenceLabel = info.confidence === 'high' ? 'Alta confianza'
      : info.confidence === 'medium' ? 'Confianza media' : 'Baja confianza';

    // Show identification result
    status.innerHTML = `
      <div class="identify-result-header">
        <i class="ti ti-sparkles" style="color:var(--gold)"></i>
        <span style="color:${confidenceColor};font-size:10px;letter-spacing:1px;text-transform:uppercase;">${confidenceLabel}</span>
      </div>
      ${info.reasoning
        ? `<div class="identify-reasoning">${escHtml(info.reasoning)}</div>`
        : ''}`;

    // Populate editable result fields
    const brandInput = document.getElementById('ir-brand');
    const modelInput = document.getElementById('ir-model');
    const refInput   = document.getElementById('ir-ref');
    const typeSelect = document.getElementById('ir-type');

    brandInput.value = info.brand && info.brand !== 'Desconocido' && info.brand !== 'Unknown'
      ? info.brand : '';
    modelInput.value = info.model || '';
    refInput.value   = info.ref   || '';
    if (info.type) typeSelect.value = info.type;

    resFields.style.display = 'block';

  } catch (e) {
    clearTimeout(stepTimer);
    status.innerHTML = `<div class="identify-error">
      <i class="ti ti-alert-circle"></i> ${escHtml(e.message)}
    </div>`;
  }

  btn.disabled  = false;
  btn.innerHTML = '<i class="ti ti-sparkles" aria-hidden="true"></i> Re-identificar';
}

/* Apply AI result to the main form fields */
function applyIdentifyResult() {
  const brand = document.getElementById('ir-brand').value.trim();
  const model = document.getElementById('ir-model').value.trim();
  const ref   = document.getElementById('ir-ref').value.trim();
  const type  = document.getElementById('ir-type').value;

  if (brand) document.getElementById('f-brand').value = brand;
  if (model) document.getElementById('f-model').value = model;
  if (ref)   document.getElementById('f-ref').value   = ref;
  if (type)  document.getElementById('f-type').value  = type;

  document.getElementById('identify-result-fields').style.display = 'none';
  document.getElementById('identify-status').innerHTML = `
    <div style="font-size:12px;color:#4CAF50;padding:4px 0;text-align:center;">
      <i class="ti ti-check"></i> Aplicado — revisa y edita si es necesario
    </div>`;
  // Scroll down to fields
  document.getElementById('modal-sheet').scrollTo({ top: 999, behavior: 'smooth' });
}
window.applyIdentifyResult = applyIdentifyResult;

async function saveWatch() {
  const brand = document.getElementById('f-brand').value.trim();
  const model = document.getElementById('f-model').value.trim();
  const ref   = document.getElementById('f-ref').value.trim();
  const type  = document.getElementById('f-type').value;
  const notes = document.getElementById('f-notes').value.trim();

  if (!brand) { showToast('Introduce la marca del reloj'); return; }
  if (!model) { showToast('Introduce el modelo del reloj'); return; }

  const btn = document.getElementById('modal-save-btn');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  try {
    if (editingWatchId) {
      await updateWatch(editingWatchId, { brand, model, ref, type, notes, photo: editingPhotoData });
      closeAddModal();
      showToast('Reloj actualizado');
      openDetail(editingWatchId);
    } else {
      await addWatch({ brand, model, ref, type, notes, photo: editingPhotoData });
      closeAddModal();
      showToast(`${brand} ${model} añadido`);
      renderHome();
    }
  } finally {
    btn.disabled = false;
    btn.textContent = editingWatchId ? 'Actualizar' : 'Guardar';
  }
}

/* ─────────────────── HISTORY ─────────────────── */

function renderHistory() {
  const sel = document.getElementById('history-selector');
  const ws  = getWatches();
  if (!ws.length) {
    document.getElementById('history-body').innerHTML =
      `<div class="history-empty"><i class="ti ti-clock" style="font-size:40px;color:var(--mid);"></i><br><br>No hay relojes en la colección</div>`;
    sel.innerHTML = '';
    return;
  }
  if (!historySelectedWatch || !getWatch(historySelectedWatch)) {
    historySelectedWatch = ws[0].id;
  }
  sel.innerHTML = ws.map(w => `
    <div class="hw-chip${w.id === historySelectedWatch ? ' active' : ''}"
         data-wid="${escHtml(w.id)}">
      ${escHtml(w.brand)} ${escHtml(w.model)}
    </div>`).join('');

  sel.querySelectorAll('.hw-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      historySelectedWatch = chip.dataset.wid;
      historySelectedYear  = null;
      renderHistory();
    });
  });

  renderHistoryBody();
}

function renderHistoryBody() {
  const w    = getWatch(historySelectedWatch);
  const body = document.getElementById('history-body');
  if (!w) { body.innerHTML = ''; return; }

  const allIntervals = [...(w.history || [])];
  if (w.wearStart) allIntervals.push({ start: w.wearStart, end: Date.now(), active: true });

  if (!allIntervals.length) {
    body.innerHTML = `<div class="history-empty"><i class="ti ti-calendar-x" style="font-size:36px;color:var(--mid);"></i><br><br>Aún no has usado este reloj</div>`;
    return;
  }

  // Correct total: sum actual durations
  const totalDays     = allIntervals.reduce((acc, i) => acc + durationDays(i.start, i.end || Date.now()), 0);
  const totalSessions = allIntervals.length;

  const years = [...new Set(allIntervals.map(i => new Date(i.start).getFullYear()))].sort((a, b) => b - a);
  if (!historySelectedYear) historySelectedYear = years[0];

  const yearTabs = `<div class="year-tabs">${
    years.map(y => `<div class="year-tab${y === historySelectedYear ? ' active' : ''}" data-year="${y}">${y}</div>`).join('')
  }</div>`;

  const summary = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
    <div class="spec-card"><div class="spec-label">Total sesiones</div><div class="spec-value">${totalSessions}</div></div>
    <div class="spec-card"><div class="spec-label">Total días</div><div class="spec-value">${totalDays}</div></div>
  </div>`;

  const filtered = allIntervals.filter(i => new Date(i.start).getFullYear() === historySelectedYear);
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
        const d = durationDays(i.start, i.end || Date.now());
        return `<div class="interval-row">
          <div class="interval-dates">${formatDate(i.start)} → ${i.active ? 'hoy' : formatDate(i.end)}</div>
          <div class="interval-duration">${d}d${i.active ? ' <span style="color:#4CAF50">●</span>' : ''}</div>
        </div>`;
      }).join('')}
    </div>`).join('');

  body.innerHTML = summary + yearTabs + monthsHTML;

  // Year tab click handlers (no inline JS)
  body.querySelectorAll('.year-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      historySelectedYear = parseInt(tab.dataset.year);
      renderHistoryBody();
    });
  });
}

/* ─────────────────── INIT ─────────────────── */

setTimeout(() => {
  document.getElementById('intro').classList.add('fade');
  setTimeout(() => document.getElementById('intro').style.display = 'none', 600);
}, 1600);

// Load photos from IndexedDB then render home
loadPhotos().then(() => renderHome());

// Expose globals needed by HTML
window.showView            = showView;
window.openAddModal        = openAddModal;
window.closeAddModal       = closeAddModal;
window.closeModalIfOutside = closeModalIfOutside;
window.openDetail          = openDetail;
window.handlePhotoUpload   = handlePhotoUpload;
window.identifyWatch       = identifyWatch;
window.saveWatch           = saveWatch;
window.handleStartWearing  = handleStartWearing;
window.handleStopWearing   = handleStopWearing;
window.fetchWatchDetails   = fetchWatchDetails;
window.openEditModal       = openEditModal;

/* ─────────────────── SETTINGS ─────────────────── */

function renderSettings() {
  const ws   = getWatches();
  const grid = document.getElementById('settings-stats');
  if (!grid) return;

  const autoCount = ws.filter(w => w.type === 'automatic').length;
  const qtzCount  = ws.filter(w => w.type === 'quartz').length;
  const manCount  = ws.filter(w => w.type === 'manual').length;
  const totalSess = ws.reduce((a, w) => a + (w.history?.length || 0) + (w.wearStart ? 1 : 0), 0);

  let totalDays = 0, mostUsedWatch = null, mostUsedDays = 0;
  const gapDays = [];

  ws.forEach(w => {
    const all = [...(w.history || [])];
    if (w.wearStart) all.push({ start: w.wearStart, end: Date.now() });
    const wDays = all.reduce((s, i) => s + Math.max(1, Math.ceil(((i.end || Date.now()) - i.start) / 86400000)), 0);
    totalDays += wDays;
    if (wDays > mostUsedDays) { mostUsedDays = wDays; mostUsedWatch = w; }
    if (all.length > 1) {
      const sorted = [...all].sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i++) {
        const gap = Math.round((sorted[i].start - (sorted[i-1].end || Date.now())) / 86400000);
        if (gap >= 0) gapDays.push(gap);
      }
    }
  });

  const avgGap = gapDays.length
    ? Math.round(gapDays.reduce((a, b) => a + b, 0) / gapDays.length) : null;

  const stats = [
    { v: ws.length,  l: 'Relojes' },
    { v: autoCount,  l: 'Automáticos' },
    { v: qtzCount,   l: 'Cuarzo' },
    { v: manCount,   l: 'Manual' },
    { v: totalSess,  l: 'Sesiones' },
    { v: totalDays,  l: 'Días uso' },
  ];

  grid.innerHTML = stats.map(s => `
    <div class="settings-stat-card">
      <div class="settings-stat-val">${s.v}</div>
      <div class="settings-stat-label">${s.l}</div>
    </div>`).join('');

  const advEl = document.getElementById('settings-advanced-stats');
  if (!advEl) return;
  const rows = [];
  if (mostUsedWatch) rows.push({ l: 'Reloj más usado', v: `${mostUsedWatch.brand} ${mostUsedWatch.model} · ${mostUsedDays}d` });
  if (avgGap !== null) rows.push({ l: 'Media días entre usos', v: `${avgGap} días` });
  if (ws.length) rows.push({ l: 'Media días por reloj', v: `${Math.round(totalDays / ws.length)}d` });
  advEl.innerHTML = rows.map(r => `
    <div class="interval-row" style="margin-bottom:6px;">
      <div class="interval-dates" style="color:var(--mid);font-size:12px;">${r.l}</div>
      <div class="interval-duration" style="color:var(--light);font-weight:500;">${r.v}</div>
    </div>`).join('');
}
window.renderSettings = renderSettings;

async function handleExportPDF() {
  const ws = getWatches();
  if (!ws.length) { showToast('No hay relojes en la colección'); return; }
  try {
    await generateCollectionPDF();
  } catch(e) {
    showToast('Error al generar PDF: ' + e.message);
    console.error(e);
  }
}
window.handleExportPDF = handleExportPDF;

function handleExportJSON() {
  const ws  = getWatches();
  if (!ws.length) { showToast('No hay datos que exportar'); return; }
  const blob = new Blob([JSON.stringify({ version: 2, exported: Date.now(), watches: ws }, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `horlogerie-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Copia de seguridad descargada');
}
window.handleExportJSON = handleExportJSON;

function handleImportJSON() {
  document.getElementById('import-json-input').click();
}
window.handleImportJSON = handleImportJSON;

function processImportJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      const incoming = data.watches || (Array.isArray(data) ? data : null);
      if (!incoming) throw new Error('Formato no reconocido');
      showConfirm(
        'Restaurar copia de seguridad',
        `Se importarán ${incoming.length} relojes. Los datos actuales se conservarán (no se borran).`,
        () => {
          const existing = getWatches();
          const existingIds = new Set(existing.map(w => w.id));
          let added = 0;
          incoming.forEach(w => {
            if (!existingIds.has(w.id)) {
              watches.push(w);
              added++;
            }
          });
          save();
          showToast(`${added} relojes importados`);
          renderHome();
          renderSettings();
        }
      );
    } catch(err) {
      showToast('Error al leer el archivo: ' + err.message);
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}
window.processImportJSON = processImportJSON;

// showView extended inline (no double-patch)
const _showViewBase = showView;
window.showView = function(v) {
  _showViewBase(v);
  if (v === 'settings') renderSettings();
};
