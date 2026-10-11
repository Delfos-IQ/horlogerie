import { addWatch, addWishlistItem, deleteWishlistItem, getWishlist, promoteWishlistToCollection, saveWishlist, updateWatch } from '../storage.js';
import { escHtml, showToast } from './core.js';
import { renderHome } from './home-detail.js';
import { showConfirm } from './sheet.js';
import { importEnabled } from './url-import.js';
import { t } from '../i18n.js';

export const PRIORITY_CFG = {
  high:   { label: 'Prioridad alta',  color: 'var(--danger)' },
  medium: { label: 'Prioridad media', color: 'var(--gold-light)' },
  low:    { label: 'Prioridad baja',  color: 'var(--mid)' },
};

export let _wlEditingId = null;   // item being edited in the wishlist modal (null = new)

/* ── Render wishlist view ── */
export function renderWishlist() {
  const items  = getWishlist();
  const list   = document.getElementById('wishlist-list');
  const empty  = document.getElementById('wishlist-empty');

  if (!items.length) {
    list.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';

  // Sort by priority
  const order = { high: 0, medium: 1, low: 2 };
  const sorted = [...items].sort((a, b) => (order[a.priority]||1) - (order[b.priority]||1));

  list.innerHTML = sorted.map(item => {
    const p = PRIORITY_CFG[item.priority] || PRIORITY_CFG.medium;
    const specCount = Object.values(item.specs || {}).filter(v => v).length;
    const specLabel = specCount === 0 ? t('Sin datos técnicos todavía') : specCount === 1 ? t('1 dato técnico guardado') : t('{n} datos técnicos guardados', { n: specCount });
    return `
      <div class="wl-card" data-wlid="${escHtml(item.id)}">
        <div class="wl-card-header">
          <div class="wl-priority-dot" style="background:${p.color};" title="${t(p.label)}" role="img" aria-label="${t(p.label)}"></div>
          <div class="wl-card-title">
            <div class="wl-brand">${escHtml(item.brand)}</div>
            <div class="wl-model">${escHtml(item.model)}${item.ref ? ` <span class="wl-ref">· ${escHtml(item.ref)}</span>` : ''}</div>
          </div>
          <div class="wl-card-actions">
            <button class="wl-btn-icon" data-action="edit" aria-label="${escHtml(t('Editar {w}', { w: `${item.brand} ${item.model}` }))}" title="${t('Editar')}"><i class="ti ti-edit" aria-hidden="true"></i></button>
            <button class="wl-btn-icon" data-action="promote" aria-label="${escHtml(t('Añadir {w} a mi colección', { w: `${item.brand} ${item.model}` }))}" title="${t('Añadir a la colección')}"><i class="ti ti-device-watch" aria-hidden="true"></i></button>
            <button class="wl-btn-icon wl-btn-danger" data-action="delete" aria-label="${escHtml(t('Eliminar {w} de deseos', { w: `${item.brand} ${item.model}` }))}" title="${t('Eliminar')}"><i class="ti ti-trash" aria-hidden="true"></i></button>
          </div>
        </div>
        <div class="wl-card-body">
          ${item.precio ? `<div class="wl-precio"><i class="ti ti-tag" aria-hidden="true"></i> ${escHtml(item.precio)}</div>` : ''}
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
export function openWishlistAdd() {
  _wlEditingId = null;
  document.getElementById('wl-modal-title').textContent = t('Añadir a la lista de deseos');
  document.getElementById('wl-save-btn').textContent    = t('Guardar');
  clearWishlistForm();
  window._wlSourceUrl = '';
  const urlSec = document.getElementById('wl-url-section');
  if (urlSec) urlSec.hidden = !importEnabled();
  const st = document.getElementById('wl-url-status'); if (st) st.textContent = '';
  document.getElementById('wishlist-modal').style.display = 'flex';
}

/* ── Modal: edit existing ── */
export function openWishlistEdit(id) {
  const item = getWishlist().find(i => i.id === id);
  if (!item) return;
  _wlEditingId = id;
  document.getElementById('wl-modal-title').textContent = t('Editar reloj deseado');
  document.getElementById('wl-save-btn').textContent    = t('Actualizar');
  document.getElementById('wl-brand').value      = item.brand;
  document.getElementById('wl-model').value      = item.model;
  document.getElementById('wl-ref').value        = item.ref || '';
  document.getElementById('wl-type').value       = item.type;
  document.getElementById('wl-priority').value   = item.priority;
  document.getElementById('wl-precio').value     = item.precio || '';
  document.getElementById('wl-notas').value      = item.notas  || '';
  window._wlSourceUrl = item.sourceUrl || '';
  const urlSec = document.getElementById('wl-url-section');
  if (urlSec) urlSec.hidden = !importEnabled();
  const st = document.getElementById('wl-url-status'); if (st) st.textContent = '';
  // Specs
  const s = item.specs || {};
  ['calibre','cristal','diametro','grosor','resistencia','reserva','caja','brazalete','esfera','movimiento','asas'].forEach(k => {
    const el = document.getElementById('wl-' + k);
    if (el) el.value = s[k] || '';
  });
  document.getElementById('wishlist-modal').style.display = 'flex';
}

export function clearWishlistForm() {
  ['wl-brand','wl-model','wl-ref','wl-precio','wl-notas',
   'wl-calibre','wl-cristal','wl-diametro','wl-grosor',
   'wl-resistencia','wl-reserva','wl-caja','wl-brazalete','wl-esfera','wl-movimiento','wl-asas']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('wl-type').value     = 'automatic';
  document.getElementById('wl-priority').value = 'medium';
}

export function closeWishlistModal() {
  document.getElementById('wishlist-modal').style.display = 'none';
}
export function closeWishlistModalIfOutside(e) {
  if (e.target.id === 'wishlist-modal') closeWishlistModal();
}

/* ── Save ── */
export function saveWishlistItem() {
  const brand = document.getElementById('wl-brand').value.trim();
  const model = document.getElementById('wl-model').value.trim();
  if (!brand) { showToast(t('Introduce la marca')); return; }
  if (!model) { showToast(t('Introduce el modelo')); return; }

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
    movimiento: document.getElementById('wl-movimiento').value.trim(),
    asas:     document.getElementById('wl-asas').value.trim(),
    sourceUrl: window._wlSourceUrl || '',
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
          movimiento: data.movimiento, asas: data.asas,
        }
      };
      saveWishlist(items);
    }
    showToast(t('Reloj actualizado'));
  } else {
    addWishlistItem(data);
    showToast(t('{w} añadido a deseos', { w: `${brand} ${model}` }));
  }

  closeWishlistModal();
  renderWishlist();
}

/* ── Promote to collection ── */
export async function handleWishlistPromote(id) {
  const item = getWishlist().find(i => i.id === id);
  if (!item) return;
  showConfirm(
    t('¿Añadir a tu colección?'),
    t('{w} pasará a tu colección de relojes. Podrás añadirle foto después.', { w: `${item.brand} ${item.model}` }),
    async () => {
      const watchData = promoteWishlistToCollection(id);
      const newWatch  = await addWatch(watchData);
      if (watchData.specs) await updateWatch(newWatch.id, { specs: watchData.specs, _source: 'wishlist',
        ...(watchData.sourceUrl ? { sourceUrl: watchData.sourceUrl } : {}) });
      deleteWishlistItem(id);
      showToast(t('{w} añadido a la colección', { w: `${item.brand} ${item.model}` }));
      renderWishlist();
      renderHome();
    }
  );
}

/* ── Delete ── */
export function handleWishlistDelete(id) {
  const item = getWishlist().find(i => i.id === id);
  if (!item) return;
  showConfirm(t('¿Eliminar de deseos?'), t('Se eliminará {w} de la lista.', { w: `${item.brand} ${item.model}` }), () => {
    deleteWishlistItem(id);
    showToast(t('Eliminado de deseos'));
    renderWishlist();
  });
}

