/**
 * url-import.js — "Rellenar desde un enlace"
 *
 * One bottom sheet used from three places (new watch, watch detail, wishlist):
 *   1. The user pastes a product link (shop or official site) — or, if the shop
 *      blocks automatic reading, the text of the spec sheet.
 *   2. Without AI: the Worker (v13+) downloads the page and returns its text;
 *      js/spec-parser.js copies the specs that the page states. Pasted text is
 *      parsed on the device and never leaves it.
 *   3. The sheet shows what was found next to what is already saved; the user
 *      ticks what to apply. Nothing is overwritten without a tick.
 */

import { getWatch, updateWatch } from '../storage.js';
import { CONFIG, FEATURES, apiError } from '../api.js';
import { workerCaps } from '../sync.js';
import { openSheet } from './sheet.js';
import { escHtml, showToast, ui } from './core.js';
import { openDetail } from './home-detail.js';
import { updateMaintVisibility } from './modals.js';
import { lang, t } from '../i18n.js';

export const IMPORT_LABELS = {
  brand: 'Marca', model: 'Modelo', ref: 'Referencia', type: 'Tipo',
  calibre: 'Calibre', movimiento: 'Movimiento', cristal: 'Cristal', diametro: 'Diámetro',
  grosor: 'Grosor', resistencia: 'Agua', reserva: 'Reserva', caja: 'Caja',
  brazalete: 'Brazalete', esfera: 'Esfera', asas: 'Entre asas', precio: 'Precio', notas: 'Notas',
};
export const IMPORT_SPEC_KEYS = ['calibre','movimiento','cristal','diametro','grosor','resistencia','reserva','caja','brazalete','esfera','asas'];
export const TYPE_LABELS = { automatic: 'Automático', quartz: 'Cuarzo', manual: 'Cuerda manual' };

/* ── Availability ──
   Pasted text works always (parsed on the device). Reading a link needs the
   Worker v13+, which downloads the page; checked only when the user taps. */
export function importEnabled() { return !!FEATURES.urlImport; }
export async function serverSupportsImport() {
  const c = await workerCaps();
  return !!c.importSource;
}

/* ── Network ── */
export async function requestPage(url) {
  const res = await fetch(`${CONFIG.WORKER_URL}/import-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (res.status === 429) return { _blocked: true, _message: t('Demasiadas lecturas seguidas. Espera una hora o pega el texto de la ficha.') };
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    return { _blocked: true, _message: apiError(e) || `Error ${res.status}` };
  }
  return res.json();
}

export function looksLikeUrl(v) { return /^https?:\/\/\S+\.\S+/i.test(v.trim()); }

/**
 * openImportSheet({ title, current, onApply })
 *   current: { brand, model, ref, type, precio, notas, calibre, … } values already saved
 *   onApply(values, meta): values = only the ticked fields; meta = { sourceUrl, source }
 */
export async function openImportSheet(opts) {
  let canRead = false;
  if (navigator.onLine) { try { canRead = await serverSupportsImport(); } catch {} }
  buildImportSheet({ ...opts, canRead });
}

export function buildImportSheet({ title = t('Rellenar desde un enlace'), current = {}, onApply, canRead = true }) {
  const sh = openSheet({ label: title, html: `
      <div class="modal-title">${escHtml(title)}</div>
      <div class="imp-step" data-step="input">
        <div class="form-field">
          <label class="form-label" for="imp-url">${t('Enlace de la ficha del reloj')}</label>
          <input class="form-input" id="imp-url" type="url" inputmode="url" autocomplete="off"
                 placeholder="${t('https://… (tienda, Amazon, AliExpress o web oficial)')}">
        </div>
        <details class="imp-paste">
          <summary>${t('¿La tienda no deja leerla? Pega el texto de la ficha')}</summary>
          <textarea class="form-input" id="imp-text" rows="5"
            placeholder="${t('Copia aquí las especificaciones (calibre, diámetro, cristal…)')}"></textarea>
        </details>
        <div class="imp-status" id="imp-status" role="status" aria-live="polite"></div>
        <div class="imp-how">${t('Se copian solo los datos que la página dice, tal cual. Nada se rellena por suposición.')}</div>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-cancel" data-act="cancel">${t('Cancelar')}</button>
          <button class="modal-btn modal-btn-save" data-act="read">${t('Leer la ficha')}</button>
        </div>
      </div>
      <div class="imp-step" data-step="review" hidden>
        <div class="imp-source" id="imp-source"></div>
        <div class="imp-rows" id="imp-rows"></div>
        <div class="imp-note">${t('Marcado = se guarda. Lo que ya tenías y es distinto queda sin marcar: márcalo si quieres sustituirlo.')}</div>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-cancel" data-act="back">${t('Atrás')}</button>
          <button class="modal-btn modal-btn-save" data-act="apply">${t('Aplicar')}</button>
        </div>
      </div>` });

  const { $, close } = sh;
  const overlay = sh.sheet;
  const status = (msg, kind = '') => { const el = $('#imp-status'); el.textContent = msg; el.dataset.kind = kind; };
  let found = null, sourceUrl = '';

  $('[data-act="cancel"]').addEventListener('click', close);
  $('[data-act="back"]').addEventListener('click', () => {
    $('[data-step="review"]').hidden = true; $('[data-step="input"]').hidden = false;
  });

  // Pasting a block of text into the link box: treat it as spec text
  $('#imp-url').addEventListener('paste', e => {
    const txt = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    if (txt && !looksLikeUrl(txt) && txt.length > 40) {
      e.preventDefault();
      $('.imp-paste').open = true; $('#imp-text').value = txt;
    }
  });

  if (!canRead) {
    $('.imp-paste').open = true;
    status(navigator.onLine
      ? t('Leer enlaces necesita la nueva versión del servidor. Mientras tanto, pega el texto de la ficha: funciona igual.')
      : t('Sin conexión no se pueden leer enlaces, pero sí el texto de la ficha que pegues.'), 'info');
  }

  $('[data-act="read"]').addEventListener('click', async () => {
    const url  = $('#imp-url').value.trim();
    const text = $('#imp-text').value.trim();
    if (!url && !text) { status(t('Pega un enlace o el texto de la ficha.'), 'error'); return; }
    if (url && !looksLikeUrl(url) && !text) { status(t('Eso no parece un enlace. Empieza por https://'), 'error'); return; }
    if (!text && !canRead) { status(t('Ahora mismo solo se puede leer texto pegado. Copia la ficha de la página y pégala abajo.'), 'error'); $('.imp-paste').open = true; return; }
    if (text) {
      if (text.length < 20) { status(t('El texto es demasiado corto. Copia la ficha técnica completa.'), 'error'); return; }
      return showFound(parseSpecs({ text, lang: lang() }), '', t('el texto pegado'));
    }
    const btn = $('[data-act="read"]');
    btn.disabled = true; btn.innerHTML = `<span class="loading-spinner"></span> ${t('Leyendo…')}`;
    status(t('Leyendo la página… (2-10 s)'));
    try {
      const page = await requestPage(url);
      if (page._blocked || page._empty) {
        status(page._message || t('No se pudo leer la página.'), 'error');
        $('.imp-paste').open = true;
        return;
      }
      showFound(parseSpecs({ ...page, lang: lang() }), url, page._source || '');
    } catch {
      status(t('Sin conexión. Inténtalo cuando tengas internet.'), 'error');
    } finally {
      btn.disabled = false; btn.textContent = t('Leer la ficha');
    }
  });

  function showFound(parsed, url, source) {
    const n = Object.keys(IMPORT_LABELS).filter(k => parsed[k]).length;
    if (!n) {
      status((url ? t('No encontré datos técnicos en esa página.') : t('No encontré datos técnicos en ese texto.')) + ' ' + t('Prueba a copiar la tabla de la ficha técnica y pegarla abajo.'), 'error');
      $('.imp-paste').open = true;
      return;
    }
    found = { ...parsed, _source: source }; sourceUrl = url;
    renderReview();
  }

  function renderReview() {
    const rows = Object.keys(IMPORT_LABELS).filter(k => found[k]);
    const from = found._from || {};
    $('#imp-source').innerHTML = `<i class="ti ti-check" aria-hidden="true"></i> ${t('{n} datos leídos en {s}', { n: rows.length, s: `<strong>${escHtml(found._source || '')}</strong>` })}` +
      `<br><small>${t('Debajo de cada dato ves la línea de la que sale.')}</small>`;
    $('#imp-rows').innerHTML = rows.map(k => {
      const nv = k === 'type' ? (t(TYPE_LABELS[found[k]] || '') || found[k]) : found[k];
      const cvRaw = current[k];
      const cv = k === 'type' ? (TYPE_LABELS[cvRaw] ? t(TYPE_LABELS[cvRaw]) : cvRaw) : cvRaw;
      const same = cv && String(cv).trim().toLowerCase() === String(nv).trim().toLowerCase();
      const checked = !cv || same;
      return `<label class="imp-row">
        <input type="checkbox" data-key="${k}" ${checked ? 'checked' : ''}>
        <span class="imp-label">${t(IMPORT_LABELS[k])}</span>
        <span class="imp-val">${escHtml(nv)}${cv && !same ? `<small>${t('Ahora')}: ${escHtml(cv)}</small>` : ''}${from[k] ? `<em class="imp-from">«${escHtml(from[k])}»</em>` : ''}</span>
      </label>`;
    }).join('');
    $('[data-step="input"]').hidden = true; $('[data-step="review"]').hidden = false;
  }

  $('[data-act="apply"]').addEventListener('click', () => {
    const values = {};
    overlay.querySelectorAll('#imp-rows input:checked').forEach(cb => { values[cb.dataset.key] = found[cb.dataset.key]; });
    close();
    onApply(values, { sourceUrl, source: found._source || '' });
  });

  setTimeout(() => (canRead ? $('#imp-url') : $('#imp-text')).focus(), 50);
}
/* ═══ Contexts ═══ */

export function splitImported(values) {
  const specs = {};
  IMPORT_SPEC_KEYS.forEach(k => { if (values[k]) specs[k] = values[k]; });
  return specs;
}

/* 1) New/edited watch modal */
export function importIntoWatchForm() {
  const current = {
    brand: document.getElementById('f-brand').value, model: document.getElementById('f-model').value,
    ref: document.getElementById('f-ref').value, type: document.getElementById('f-type').value,
    ...(window._pendingDbSpecs || {}),
  };
  openImportSheet({
    current,
    onApply: (v, meta) => {
      if (v.brand) document.getElementById('f-brand').value = v.brand;
      if (v.model) document.getElementById('f-model').value = v.model;
      if (v.ref)   document.getElementById('f-ref').value   = v.ref;
      if (v.type)  { document.getElementById('f-type').value = v.type; if (typeof updateMaintVisibility === 'function') updateMaintVisibility(); }
      if (v.notas) { const n = document.getElementById('f-notes'); n.value = n.value ? `${n.value}\n${v.notas}` : v.notas; }
      window._pendingDbSpecs = { ...(window._pendingDbSpecs || {}), ...splitImported(v) };
      if (v.precio) window._pendingDbPrice = { value: v.precio, note: meta.source };
      window._pendingSource = meta.source;
      window._pendingSourceUrl = meta.sourceUrl;
      showImportedPreview();
      const st = document.getElementById('f-url-status');
      if (st) st.textContent = `✓ ${t('{n} datos listos para guardar ({s})', { n: Object.keys(v).length, s: meta.source })}`;
    },
  });
}

export function showImportedPreview() {
  const specs = window._pendingDbSpecs || {};
  let n = 0;
  [...IMPORT_SPEC_KEYS, 'precio'].forEach(k => {
    const el = document.getElementById('fi-' + k);
    const v = k === 'precio' ? window._pendingDbPrice?.value : specs[k];
    if (el) { el.textContent = v || '—'; if (v) n++; }
  });
  const sec = document.getElementById('f-specs-section');
  if (sec) sec.style.display = n ? 'block' : 'none';
}
/* 2) Existing watch (detail view) */
export function importIntoWatch(watchId) {
  const w = getWatch(watchId);
  if (!w) return;
  openImportSheet({
    title: `${t('Ficha técnica')} · ${w.brand} ${w.model}`,
    current: { brand: w.brand, model: w.model, ref: w.ref, type: w.type, precio: w.price?.value || '', notas: w.notes, ...(w.specs || {}) },
    onApply: async (v, meta) => {
      const changes = { specs: { ...(w.specs || {}), ...splitImported(v) }, _source: meta.source, _warning: '' };
      if (v.brand) changes.brand = v.brand;
      if (v.model) changes.model = v.model;
      if (v.ref)   changes.ref = v.ref;
      if (v.type)  changes.type = v.type;
      if (v.precio) changes.price = { value: v.precio, note: meta.source };
      if (v.notas) changes.notes = w.notes ? `${w.notes}\n${v.notas}` : v.notas;
      if (meta.sourceUrl) changes.sourceUrl = meta.sourceUrl;
      await updateWatch(watchId, changes);
      showToast(t('{n} datos guardados', { n: Object.keys(v).length }));
      openDetail(watchId);
    },
  });
}
/* 3) Wishlist modal */
export const WL_FIELDS = ['brand','model','ref','precio','notas', ...IMPORT_SPEC_KEYS];
export function importIntoWishlistForm() {
  const current = {};
  WL_FIELDS.forEach(k => { const el = document.getElementById('wl-' + k); if (el) current[k] = el.value; });
  current.type = document.getElementById('wl-type').value;
  openImportSheet({
    current,
    onApply: (v, meta) => {
      WL_FIELDS.forEach(k => { const el = document.getElementById('wl-' + k); if (el && v[k]) el.value = v[k]; });
      if (v.type) document.getElementById('wl-type').value = v.type;
      window._wlSourceUrl = meta.sourceUrl || window._wlSourceUrl || '';
      const st = document.getElementById('wl-url-status');
      if (st) st.textContent = `✓ ${t('{n} datos rellenados desde {s}. Revisa y guarda.', { n: Object.keys(v).length, s: meta.source })}`;
    },
  });
}

/* Wire buttons and visibility */
export function refreshImportButtons() {
  const on = importEnabled();
  ['url-import-section', 'wl-url-section'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !(id === 'url-import-section' && ui.editingWatchId)) el.hidden = !on;
  });
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('f-import-btn')?.addEventListener('click', importIntoWatchForm);
  document.getElementById('wl-import-btn')?.addEventListener('click', importIntoWishlistForm);
  refreshImportButtons();
});
