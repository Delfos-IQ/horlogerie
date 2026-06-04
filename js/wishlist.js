/**
 * wishlist.js — Lista de deseos de relojes
 *
 * Almacena en localStorage bajo 'horlogerie_wishlist'.
 * Cada item puede exportarse a watches_db.json para enriquecer
 * la base de datos local de búsqueda.
 *
 * Flujo:
 *   1. Usuario añade reloj deseado con specs conocidas
 *   2. Al completar specs → exporta a watches_db.json
 *   3. La base de datos local se actualiza automáticamente
 *   4. El autocompletado del modal "Añadir" ya encuentra ese reloj
 */

const WL_KEY = 'horlogerie_wishlist';

const PRIORITY_CONFIG = {
  high:   { color: '#e57373', label: '🔥 Alta',  dot: '#e57373' },
  medium: { color: '#D4AF6A', label: '⭐ Media', dot: '#D4AF6A' },
  low:    { color: '#666',    label: '💭 Baja',  dot: '#666'    },
};

const SPEC_FIELDS = ['calibre','cristal','diametro','grosor','resistencia','reserva','caja','brazalete','esfera'];

/* ── Storage ── */
function wlLoad() {
  try { return JSON.parse(localStorage.getItem(WL_KEY) || '[]'); } catch { return []; }
}
function wlSave(items) {
  localStorage.setItem(WL_KEY, JSON.stringify(items));
}

let _wlEditingId = null;

/* ── Render ── */
function renderWishlist() {
  const items = wlLoad();
  const list  = document.getElementById('wishlist-list');
  const empty = document.getElementById('wishlist-empty');
  const banner = document.getElementById('wishlist-export-banner');

  if (!items.length) {
    list.innerHTML = '';
    empty.style.display = 'flex';
    banner.style.display = 'none';
    return;
  }
  empty.style.display = 'none';

  // Show export banner if any item has at least 3 specs filled
  const exportable = items.filter(it => countSpecs(it) >= 3);
  banner.style.display = exportable.length ? 'flex' : 'none';

  // Sort by priority: high → medium → low
  const order = { high: 0, medium: 1, low: 2 };
  const sorted = [...items].sort((a, b) => (order[a.priority]||1) - (order[b.priority]||1));

  list.innerHTML = sorted.map(item => renderWlCard(item)).join('');

  // Attach event listeners
  list.querySelectorAll('.wl-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('.wl-header-tap')?.addEventListener('click', () => toggleWlCard(card));
    card.querySelector('.wl-btn-edit')?.addEventListener('click', e => { e.stopPropagation(); openWishlistEdit(id); });
    card.querySelector('.wl-btn-delete')?.addEventListener('click', e => { e.stopPropagation(); deleteWlItem(id); });
    card.querySelector('.wl-btn-buy')?.addEventListener('click', e => { e.stopPropagation(); markWlAsBought(id); });
  });
}

function renderWlCard(item) {
  const cfg    = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.medium;
  const filled = countSpecs(item);
  const total  = SPEC_FIELDS.length;
  const pct    = Math.round((filled / total) * 100);

  const specRows = SPEC_FIELDS
    .filter(k => item[k])
    .map(k => `
      <div class="wl-spec">
        <div class="wl-spec-label">${specLabel(k)}</div>
        <div class="wl-spec-value">${escHtml(item[k])}</div>
      </div>`).join('');

  return `
    <div class="wl-card" data-id="${escHtml(item.id)}">
      <div class="wl-card-header wl-header-tap">
        <div class="wl-priority-dot" style="background:${cfg.dot};"></div>
        <div class="wl-card-titles">
          <div class="wl-card-brand">${escHtml(item.brand)}</div>
          <div class="wl-card-model">${escHtml(item.model)}</div>
          ${item.ref ? `<div class="wl-card-ref">${escHtml(item.ref)}</div>` : ''}
        </div>
        <div class="wl-card-actions">
          <button class="wl-action-btn wl-btn-edit"><i class="ti ti-edit"></i></button>
          <button class="wl-action-btn wl-btn-delete wl-action-delete"><i class="ti ti-trash"></i></button>
        </div>
      </div>

      <!-- Completeness bar -->
      <div class="wl-completeness">
        <div class="wl-progress-bar">
          <div class="wl-progress-fill" style="width:${pct}%;background:${pct===100?'#4CAF50':'var(--gold)'};"></div>
        </div>
        <div class="wl-progress-label">${filled}/${total} specs · ${pct}%</div>
      </div>

      <!-- Specs (collapsible) -->
      <div class="wl-specs-body" style="display:none;">
        ${specRows
          ? `<div class="wl-specs-grid">${specRows}</div>`
          : `<div class="wl-notes" style="color:var(--mid);font-style:italic;">Sin especificaciones — edita para añadir</div>`}
        ${item.precio ? `<div class="wl-notes"><i class="ti ti-tag" style="color:var(--gold);"></i> Precio estimado: <strong>${escHtml(item.precio)}</strong></div>` : ''}
        ${item.notas  ? `<div class="wl-notes"><i class="ti ti-info-circle" style="color:var(--mid);"></i> ${escHtml(item.notas)}</div>` : ''}
        <div style="padding:0 14px 14px;display:flex;gap:8px;">
          <button class="wl-action-btn wl-btn-buy wl-action-buy" style="flex:1;justify-content:center;">
            <i class="ti ti-check"></i> Lo tengo — añadir a colección
          </button>
        </div>
      </div>
    </div>`;
}

function toggleWlCard(card) {
  const body = card.querySelector('.wl-specs-body');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
}

function specLabel(k) {
  const map = { calibre:'Calibre', cristal:'Cristal', diametro:'Diámetro', grosor:'Grosor',
    resistencia:'Agua', reserva:'Reserva', caja:'Caja', brazalete:'Brazalete', esfera:'Esfera' };
  return map[k] || k;
}

function countSpecs(item) {
  return SPEC_FIELDS.filter(k => item[k] && item[k].trim()).length;
}

/* ── Add / Edit modal ── */
function openWishlistAdd() {
  _wlEditingId = null;
  clearWlForm();
  document.getElementById('wl-modal-title').textContent = 'Añadir a lista de deseos';
  document.getElementById('wl-save-btn').textContent    = 'Guardar';
  document.getElementById('wishlist-modal').style.display = 'flex';
}

function openWishlistEdit(id) {
  const items = wlLoad();
  const item  = items.find(i => i.id === id);
  if (!item) return;
  _wlEditingId = id;
  document.getElementById('wl-brand').value     = item.brand     || '';
  document.getElementById('wl-model').value     = item.model     || '';
  document.getElementById('wl-ref').value       = item.ref       || '';
  document.getElementById('wl-type').value      = item.type      || 'automatic';
  document.getElementById('wl-calibre').value   = item.calibre   || '';
  document.getElementById('wl-cristal').value   = item.cristal   || '';
  document.getElementById('wl-diametro').value  = item.diametro  || '';
  document.getElementById('wl-grosor').value    = item.grosor    || '';
  document.getElementById('wl-resistencia').value = item.resistencia || '';
  document.getElementById('wl-reserva').value   = item.reserva   || '';
  document.getElementById('wl-caja').value      = item.caja      || '';
  document.getElementById('wl-brazalete').value = item.brazalete || '';
  document.getElementById('wl-esfera').value    = item.esfera    || '';
  document.getElementById('wl-precio').value    = item.precio    || '';
  document.getElementById('wl-notas').value     = item.notas     || '';
  document.getElementById('wl-priority').value  = item.priority  || 'medium';
  document.getElementById('wl-modal-title').textContent = 'Editar reloj deseado';
  document.getElementById('wl-save-btn').textContent    = 'Actualizar';
  document.getElementById('wishlist-modal').style.display = 'flex';
}

function clearWlForm() {
  ['wl-brand','wl-model','wl-ref','wl-calibre','wl-cristal','wl-diametro',
   'wl-grosor','wl-resistencia','wl-reserva','wl-caja','wl-brazalete',
   'wl-esfera','wl-precio','wl-notas'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('wl-type').value     = 'automatic';
  document.getElementById('wl-priority').value = 'medium';
}

function closeWishlistModal() {
  document.getElementById('wishlist-modal').style.display = 'none';
}
function closeWishlistModalIfOutside(e) {
  if (e.target.id === 'wishlist-modal') closeWishlistModal();
}

function saveWishlistItem() {
  const brand = document.getElementById('wl-brand').value.trim();
  const model = document.getElementById('wl-model').value.trim();
  if (!brand) { showToast('Introduce la marca'); return; }
  if (!model) { showToast('Introduce el modelo'); return; }

  const item = {
    id:          _wlEditingId || ('wl_' + Date.now()),
    brand, model,
    ref:         document.getElementById('wl-ref').value.trim(),
    type:        document.getElementById('wl-type').value,
    calibre:     document.getElementById('wl-calibre').value.trim(),
    cristal:     document.getElementById('wl-cristal').value.trim(),
    diametro:    document.getElementById('wl-diametro').value.trim(),
    grosor:      document.getElementById('wl-grosor').value.trim(),
    resistencia: document.getElementById('wl-resistencia').value.trim(),
    reserva:     document.getElementById('wl-reserva').value.trim(),
    caja:        document.getElementById('wl-caja').value.trim(),
    brazalete:   document.getElementById('wl-brazalete').value.trim(),
    esfera:      document.getElementById('wl-esfera').value.trim(),
    precio:      document.getElementById('wl-precio').value.trim(),
    notas:       document.getElementById('wl-notas').value.trim(),
    priority:    document.getElementById('wl-priority').value,
    created:     _wlEditingId ? undefined : Date.now(),
    updated:     Date.now(),
  };

  let items = wlLoad();
  if (_wlEditingId) {
    items = items.map(i => i.id === _wlEditingId ? { ...i, ...item } : i);
    showToast('Reloj actualizado');
  } else {
    items.push(item);
    showToast(`${brand} ${model} añadido a la lista`);
  }
  wlSave(items);
  closeWishlistModal();
  renderWishlist();
}

function deleteWlItem(id) {
  showConfirm('¿Eliminar de la lista de deseos?', 'Se eliminará permanentemente.', () => {
    const items = wlLoad().filter(i => i.id !== id);
    wlSave(items);
    renderWishlist();
    showToast('Eliminado de la lista de deseos');
  });
}

/* ── Move to collection ── */
async function markWlAsBought(id) {
  const items = wlLoad();
  const item  = items.find(i => i.id === id);
  if (!item) return;

  showConfirm(
    `¿Añadir a tu colección?`,
    `${item.brand} ${item.model} se moverá a tu colección de relojes.`,
    async () => {
      const newW = await addWatch({
        brand: item.brand, model: item.model,
        ref:   item.ref,   type:  item.type,
        notes: item.notas || '',
        photo: null,
      });
      if (newW && countSpecs(item) > 0) {
        const specs = {};
        SPEC_FIELDS.forEach(k => { if (item[k]) specs[k] = item[k]; });
        await updateWatch(newW.id, {
          specs,
          price:   { value: item.precio || '', note: item.notas || '' },
          _source: 'wishlist',
        });
      }
      // Remove from wishlist
      wlSave(wlLoad().filter(i => i.id !== id));
      renderWishlist();
      showToast(`${item.brand} ${item.model} añadido a tu colección`);
      showView('home');
    }
  );
}

/* ── Export to watches_db.json ── */
function exportWishlistToDb() {
  const items = wlLoad();
  const exportable = items.filter(it => countSpecs(it) >= 3);

  if (!exportable.length) {
    showToast('Rellena al menos 3 specs en cada reloj para exportar');
    return;
  }

  // Build db entries compatible with watches_db.json format
  const dbEntries = exportable.map((item, i) => ({
    id:    Date.now() + i,
    brand: item.brand,
    model: item.model,
    ref:   item.ref || '',
    type:  item.type,
    specs: {
      calibre:     item.calibre     || '',
      movimiento:  typeToMovimiento(item.type, item.calibre),
      cristal:     item.cristal     || '',
      brazalete:   item.brazalete   || '',
      esfera:      item.esfera      || '',
      caja:        item.caja        || '',
      resistencia: item.resistencia || '',
      reserva:     item.reserva     || '',
      diametro:    item.diametro    || '',
      grosor:      item.grosor      || '',
    },
    price: {
      value: item.precio || '',
      note:  item.notas  || '',
    },
    _source: 'wishlist_export',
    notas: item.notas || '',
  }));

  // Also inject into the in-memory _db for immediate use (no page reload needed)
  if (typeof _db !== 'undefined') {
    dbEntries.forEach(entry => {
      // Avoid duplicates
      const exists = _db.find(w =>
        w.brand.toLowerCase() === entry.brand.toLowerCase() &&
        w.model.toLowerCase() === entry.model.toLowerCase()
      );
      if (!exists) _db.push(entry);
    });
  }

  // Download as JSON patch
  const blob = new Blob([JSON.stringify(dbEntries, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `wishlist_db_patch_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);

  showToast(`${dbEntries.length} reloj(es) exportados`);

  // Show instructions
  setTimeout(() => {
    showToast('Añade el JSON a watches_db.json y haz push al repo');
  }, 2500);
}

function typeToMovimiento(type, calibre) {
  const t = type === 'automatic' ? 'Automático' : type === 'quartz' ? 'Cuarzo' : 'Manual';
  return calibre ? `${t} · ${calibre}` : t;
}

/* ── Expose ── */
window.renderWishlist              = renderWishlist;
window.openWishlistAdd             = openWishlistAdd;
window.openWishlistEdit            = openWishlistEdit;
window.closeWishlistModal          = closeWishlistModal;
window.closeWishlistModalIfOutside = closeWishlistModalIfOutside;
window.saveWishlistItem            = saveWishlistItem;
window.exportWishlistToDb          = exportWishlistToDb;
window.markWlAsBought              = markWlAsBought;
