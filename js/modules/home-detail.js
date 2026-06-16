/* ─── HOME ─── */
function renderHome() {
  const grid  = document.getElementById('watches-grid');
  const empty = document.getElementById('empty-state');
  if (!grid || !empty) return;   // DOM not ready yet
  const ws    = getWatches();
  const activeW = getActiveWatch();

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
    const locked   = !!(activeW && !isActive);
    return `
      <div class="watch-card${locked ? ' locked' : ''}${isActive ? ' active-card' : ''}" data-id="${escHtml(w.id)}" role="button" tabindex="0" aria-label="${escHtml(w.brand)} ${escHtml(w.model)}${isActive ? ' — actualmente puesto' : ''}">
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
  // keyboard + click support for accessibility
  grid.querySelectorAll('.watch-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(card.dataset.id); }
    });
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
  const hasAnySpec = Object.values(specs).some(v => v);
  const defs = [
    {k:'calibre',l:'Calibre'},{k:'movimiento',l:'Movimiento'},{k:'cristal',l:'Cristal'},
    {k:'brazalete',l:'Brazalete'},{k:'esfera',l:'Esfera'},{k:'caja',l:'Caja'},
    {k:'resistencia',l:'Agua'},{k:'reserva',l:'Reserva'},{k:'diametro',l:'Diámetro'},{k:'grosor',l:'Grosor'},
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
    const activate = () => editSpecInline(card.dataset.key, getWatch(currentWatchId));
    card.addEventListener('click', activate);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }});
  });

  // Also show URL import button in detail view
  renderSpecsImportBtn(w);
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

function renderSpecsImportBtn(w) {
  // Add/replace the "Import specs from URL" button below the specs grid
  const specsEl = document.getElementById('d-specs');
  if (!specsEl) return;

  // Remove previous import section if present
  const prev = document.getElementById('d-specs-import');
  if (prev) prev.remove();

  const div = document.createElement('div');
  div.id = 'd-specs-import';
  div.style.cssText = 'margin-top:12px;';
  div.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
      <input id="d-url-input" type="url"
        aria-label="URL para importar especificaciones"
        class="form-input"
        placeholder="Pega URL de Amazon, AliExpress, tienda…"
        style="flex:1;font-size:13px;padding:9px 12px;">
      <button id="d-url-btn"
        aria-label="Importar especificaciones desde URL"
        onclick="importSpecsFromUrl('${w.id}')"
        style="width:40px;height:40px;border-radius:10px;border:0.5px solid var(--glass-border);
          background:var(--dark3);color:var(--gold-light);cursor:pointer;font-size:18px;
          display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <i class="ti ti-download" aria-hidden="true"></i>
      </button>
    </div>
    <div id="d-url-status" style="font-size:11px;color:var(--mid);min-height:14px;"></div>`;

  specsEl.insertAdjacentElement('afterend', div);
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

