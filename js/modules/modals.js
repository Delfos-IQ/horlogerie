/* ─── ADD / EDIT MODAL ─── */
import { dbGet, dbLoad, dbSearch } from '../db.js';
import { MOMENT_GROUPS, addWatch, cleanMoments, compressPhoto, getWatch, photoSrc, updateWatch } from '../storage.js';
import { escHtml, showToast, ui } from './core.js';
import { openDetail, renderHome } from './home-detail.js';
import { importEnabled, showImportedPreview } from './url-import.js';
import { currencySymbol, t } from '../i18n.js';

export function openAddModal() {
  ui.editingWatchId = null;
  ui.editingPhotoData = null;
  window._pendingDbSpecs = null;
  window._pendingDbPrice = null;
  window._pendingSource  = null;
  window._pendingSourceUrl = null;
  document.getElementById('modal-title-text').textContent = t('Añadir reloj');
  document.getElementById('modal-save-btn').textContent   = t('Guardar');
  document.getElementById('f-brand').value  = '';
  document.getElementById('f-model').value  = '';
  document.getElementById('f-ref').value    = '';
  document.getElementById('f-type').value   = 'automatic';
  document.getElementById('f-notes').value  = '';
  renderMomentsPicker([]);
  setMaintFields({});
  document.getElementById('photo-preview').style.display = 'none';

  // "Rellenar desde un enlace" (visible only when the Worker supports it)
  const urlSec = document.getElementById('url-import-section');
  if (urlSec) urlSec.hidden = !(typeof importEnabled === 'function' && importEnabled());
  const urlStatus = document.getElementById('f-url-status');
  if (urlStatus) urlStatus.textContent = '';

  // Specs preview — hidden until URL import fills it
  const specsSec = document.getElementById('f-specs-section');
  if (specsSec) specsSec.style.display = 'none';
  ['fi-calibre','fi-cristal','fi-diametro','fi-grosor','fi-resistencia','fi-movimiento','fi-asas',
   'fi-reserva','fi-caja','fi-brazalete','fi-esfera','fi-precio'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });

  // DB search
  const dbSec = document.getElementById('db-search-section');
  if (dbSec) dbSec.style.display = 'block';
  const dbInput = document.getElementById('db-search-input');
  if (dbInput) dbInput.value = '';
  const dbRes = document.getElementById('db-search-results');
  if (dbRes) dbRes.style.display = 'none';
  resetDbHint();

  document.getElementById('add-modal').style.display = 'flex';
  dbLoad();
}

export function resetDbHint() {
  const hint = document.getElementById('db-hint');
  if (hint) hint.innerHTML = '<i class="ti ti-database c-gold" aria-hidden="true"></i> Berny · Pagani Design · San Martin · Cadisen · OBLVLO · Seagull · CIGA Design · Carnival · Reef Tiger · Steeldive';
}

/** @param {string} id @param {{ maintenance?: boolean }} [opts] maintenance: open with «Compra y mantenimiento» unfolded */
export function openEditModal(id, opts = {}) {
  const w = getWatch(id);
  if (!w) return;
  ui.editingWatchId   = id;
  ui.editingPhotoData = null;   // a new photo chosen in the modal (the current one stays in IndexedDB)
  window._pendingDbSpecs = null;
  window._pendingDbPrice = null;
  document.getElementById('modal-title-text').textContent = t('Editar reloj');
  document.getElementById('modal-save-btn').textContent   = t('Actualizar');
  document.getElementById('f-brand').value  = w.brand;
  document.getElementById('f-model').value  = w.model;
  document.getElementById('f-ref').value    = w.ref || '';
  document.getElementById('f-type').value   = w.type;
  document.getElementById('f-notes').value  = w.notes || '';
  renderMomentsPicker(w.moments || []);
  setMaintFields(w);
  const prev = document.getElementById('photo-preview');
  if (photoSrc(id)) { prev.src = photoSrc(id); prev.style.display = 'block'; }
  else { prev.style.display = 'none'; }
  // Hide URL import and DB search when editing — specs already exist
  const urlSec = document.getElementById('url-import-section');
  if (urlSec) urlSec.hidden = true;   // in the detail view: "Rellenar desde un enlace"
  const specsSec = document.getElementById('f-specs-section');
  if (specsSec) specsSec.style.display = 'none';
  const dbSec = document.getElementById('db-search-section');
  if (dbSec) dbSec.style.display = 'none';
  document.getElementById('add-modal').style.display = 'flex';
  if (opts.maintenance) {
    const det = document.getElementById('f-maint');
    if (det) { det.open = true; setTimeout(() => det.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50); }
  }
}

export function closeAddModal() {
  document.getElementById('add-modal').style.display = 'none';
}
export function closeModalIfOutside(e) {
  if (e.target.id === 'add-modal') closeAddModal();
}

/* ─── Photo upload ─── */
export function openPhotoSheet() {
  document.getElementById('photo-sheet').style.display = 'flex';
}
export function closePhotoSheet() {
  document.getElementById('photo-sheet').style.display = 'none';
}
export function closePhotoSheetIfOutside(e) {
  if (e.target.id === 'photo-sheet') closePhotoSheet();
}
export function choosePhotoSource(source) {
  closePhotoSheet();
  document.getElementById(source === 'camera' ? 'photo-input-camera' : 'photo-input-library').click();
}

export function handlePhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  // Reset input so same file can be re-selected
  e.target.value = '';
  const reader = new FileReader();
  reader.onload = ev => {
    compressPhoto(ev.target.result, 900).then(resized => {
      ui.editingPhotoData = resized;
      const prev = document.getElementById('photo-preview');
      prev.src = resized; prev.style.display = 'block';
    });
  };
  reader.readAsDataURL(file);
}

/* ─── DB Search ─── */
export function handleDbSearch(query) {
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

export function applyDbResult(w) {
  document.getElementById('f-brand').value = w.brand;
  document.getElementById('f-model').value = w.model;
  document.getElementById('f-ref').value   = w.ref || '';
  document.getElementById('f-type').value  = w.type;
  updateMaintVisibility();
  document.getElementById('db-search-results').style.display = 'none';
  document.getElementById('db-search-input').value = `${w.brand} ${w.model}`;
  const hint = document.getElementById('db-hint');
  if (hint) hint.innerHTML = `<i class="ti ti-check c-ok" aria-hidden="true"></i> <strong>${escHtml(w.brand)} ${escHtml(w.model)}</strong> — ${t('ficha encontrada')}`;
  window._pendingDbSpecs = w.specs;
  window._pendingDbPrice = w.price;
  window._pendingSource  = 'local_db';
  if (typeof showImportedPreview === 'function') showImportedPreview();
  showToast(t('{w} seleccionado', { w: `${w.brand} ${w.model}` }));
}

/* ─── Save watch ─── */
export async function saveWatch() {
  const brand = document.getElementById('f-brand').value.trim();
  const model = document.getElementById('f-model').value.trim();
  const ref   = document.getElementById('f-ref').value.trim();
  const type  = document.getElementById('f-type').value;
  const notes = document.getElementById('f-notes').value.trim();
  const moments = readMomentsPicker();
  const maint = readMaintFields();
  if (!brand) { showToast(t('Introduce la marca')); return; }
  if (maint === null) return;
  if (!model) { showToast(t('Introduce el modelo')); return; }

  const btn = document.getElementById('modal-save-btn');
  btn.disabled = true; btn.textContent = t('Guardando…');

  try {
    if (ui.editingWatchId) {
      // Only send the photo if it changed: updateWatch recompresses whatever it gets
      const changes = { brand, model, ref, type, notes, moments, ...maint };
      if (ui.editingPhotoData) changes.photo = ui.editingPhotoData;
      await updateWatch(ui.editingWatchId, changes);
      if (window._pendingDbSpecs) await updateWatch(ui.editingWatchId, pendingSpecChanges(getWatch(ui.editingWatchId)));
      closeAddModal();
      showToast(t('Reloj actualizado'));
      openDetail(ui.editingWatchId);
    } else {
      const newW = await addWatch({ brand, model, ref, type, notes, photo: ui.editingPhotoData });
      if (newW && Object.values(maint).some(v => v !== null)) await updateWatch(newW.id, maint);
      if (newW && moments.length) await updateWatch(newW.id, { moments });
      // No specs chosen: try the local model database automatically
      let autoFilled = false;
      if (!window._pendingDbSpecs && typeof dbGet === 'function') {
        const hit = dbGet(brand, model);
        if (hit?.specs) {
          window._pendingDbSpecs = hit.specs; window._pendingDbPrice = hit.price; window._pendingSource = 'local_db';
          autoFilled = true;
        }
      }
      if (window._pendingDbSpecs && newW) await updateWatch(newW.id, pendingSpecChanges(newW));
      window._pendingDbSpecs = null;
      window._pendingDbPrice = null;
      window._pendingSource = null;
      window._pendingSourceUrl = null;
      closeAddModal();
      showToast(autoFilled ? t('{w} añadido con su ficha técnica', { w: `${brand} ${model}` }) : t('{w} añadido', { w: `${brand} ${model}` }));
      renderHome();
    }
  } finally {
    btn.disabled = false;
    btn.textContent = ui.editingWatchId ? t('Actualizar') : t('Guardar');
  }
}


/* ─── Compra y mantenimiento ─── */
export function tsToDateInput(ts) {
  if (typeof ts !== 'number') return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function dateInputToTs(v) {
  const [y, m, d] = (v || '').split('-').map(Number);
  return y ? new Date(y, m - 1, d, 12, 0, 0).getTime() : null;
}
export function setMaintFields(w) {
  document.getElementById('f-purchase-price').value = typeof w.purchasePrice === 'number' ? w.purchasePrice : '';
  document.getElementById('f-purchase-date').value  = tsToDateInput(w.purchaseDate);
  document.getElementById('f-last-service').value   = tsToDateInput(w.lastService);
  document.getElementById('f-battery').value        = tsToDateInput(w.batteryChanged);
  const today = tsToDateInput(Date.now());
  ['f-purchase-date', 'f-last-service', 'f-battery'].forEach(id => document.getElementById(id).max = today);
  document.querySelectorAll('.f-cur').forEach(el => { el.textContent = currencySymbol(); });
  document.getElementById('f-current-value').value = typeof w.currentValue === 'number' ? w.currentValue : '';
  document.getElementById('f-serial').value = w.serial || '';
  const details = document.getElementById('f-maint');
  if (details) details.open = !!(w.purchasePrice || w.purchaseDate || w.lastService || w.batteryChanged || w.currentValue || w.serial);
  updateMaintVisibility();
}
/** Battery only matters for quartz; service only for mechanical */
export function updateMaintVisibility() {
  const quartz = document.getElementById('f-type').value === 'quartz';
  document.getElementById('f-battery-field').hidden = !quartz;
  document.getElementById('f-service-field').hidden = quartz;
}
/** Returns the fields to save, or null (and a toast) if something is wrong */
export function readMaintFields() {
  const raw = document.getElementById('f-purchase-price').value.trim().replace(',', '.');
  const price = raw === '' ? null : Number(raw);
  if (price !== null && (!isFinite(price) || price < 0)) { showToast(t('El precio debe ser un número')); return null; }
  const rawV = document.getElementById('f-current-value').value.trim().replace(',', '.');
  const currentValue = rawV === '' ? null : Number(rawV);
  if (currentValue !== null && (!isFinite(currentValue) || currentValue < 0)) { showToast(t('El precio debe ser un número')); return null; }
  const out = {
    purchasePrice:  price,
    purchaseDate:   dateInputToTs(document.getElementById('f-purchase-date').value),
    lastService:    dateInputToTs(document.getElementById('f-last-service').value),
    batteryChanged: dateInputToTs(document.getElementById('f-battery').value),
    currentValue,
    serial:         document.getElementById('f-serial').value.trim() || null,
  };
  if (['purchaseDate', 'lastService', 'batteryChanged'].some(k => out[k] !== null && out[k] > Date.now())) {
    showToast(t('Las fechas no pueden ser futuras')); return null;
  }
  return out;
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('f-type')?.addEventListener('change', updateMaintVisibility);
});

/** Specs, price and source chosen in the modal (database or link), as watch changes */
export function pendingSpecChanges(w) {
  const changes = { specs: { ...(w?.specs || {}), ...(window._pendingDbSpecs || {}) },
                    _source: window._pendingSource || 'local_db' };
  if (window._pendingDbPrice?.value) changes.price = window._pendingDbPrice;
  if (window._pendingSourceUrl) changes.sourceUrl = window._pendingSourceUrl;
  return changes;
}


/* ─── Momentos: ocasión, ánimo y estación (toggle chips) ─── */
export function renderMomentsPicker(selected) {
  const box = document.getElementById('f-moments');
  if (!box) return;
  const on = new Set(selected);
  box.innerHTML = MOMENT_GROUPS.map(g => `
    <div class="moments-group"><span class="moments-group-label">${t(g.label)}</span>
      ${g.items.map(m => `<button type="button" class="moment-chip" data-moment="${m.id}" aria-pressed="${on.has(m.id)}">
        <i class="ti ${m.icon}" aria-hidden="true"></i>${t(m.label)}</button>`).join('')}
    </div>`).join('');
  box.querySelectorAll('.moment-chip').forEach(b => b.addEventListener('click', () =>
    b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'))));
}
export function readMomentsPicker() {
  return cleanMoments([...document.querySelectorAll('#f-moments .moment-chip[aria-pressed="true"]')].map(b => b.dataset.moment));
}
