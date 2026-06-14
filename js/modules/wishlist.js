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
            <button class="wl-btn-icon" data-action="edit" aria-label="Editar ${escHtml(item.brand)} ${escHtml(item.model)}" title="Editar"><i class="ti ti-edit" aria-hidden="true"></i></button>
            <button class="wl-btn-icon" data-action="promote" aria-label="Añadir ${escHtml(item.brand)} ${escHtml(item.model)} a mi colección" title="Añadir a colección"><i class="ti ti-wrist-watch" aria-hidden="true"></i></button>
            <button class="wl-btn-icon wl-btn-danger" data-action="delete" aria-label="Eliminar ${escHtml(item.brand)} ${escHtml(item.model)} de deseos" title="Eliminar"><i class="ti ti-trash" aria-hidden="true"></i></button>
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

