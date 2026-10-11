/**
 * url-import.js — "Rellenar desde un enlace"
 *
 * One bottom sheet used from three places (new watch, watch detail, wishlist):
 *   1. The user pastes a product link (shop or official site) — or, if the shop
 *      blocks automatic reading, the text of the spec sheet.
 *   2. The Worker (v12+) downloads the page, extracts the specs and checks every
 *      value against the page text.
 *   3. The sheet shows what was found next to what is already saved; the user
 *      ticks what to apply. Nothing is overwritten without a tick.
 */

const IMPORT_LABELS = {
  brand: 'Marca', model: 'Modelo', ref: 'Referencia', type: 'Tipo',
  calibre: 'Calibre', movimiento: 'Movimiento', cristal: 'Cristal', diametro: 'Diámetro',
  grosor: 'Grosor', resistencia: 'Agua', reserva: 'Reserva', caja: 'Caja',
  brazalete: 'Brazalete', esfera: 'Esfera', asas: 'Entre asas', precio: 'Precio', notas: 'Notas',
};
const IMPORT_SPEC_KEYS = ['calibre','movimiento','cristal','diametro','grosor','resistencia','reserva','caja','brazalete','esfera','asas'];
const TYPE_LABELS = { automatic: 'Automático', quartz: 'Cuarzo', manual: 'Cuerda manual' };

/* ── Availability ──
   The button is shown whenever the feature switch is on. Whether the server
   supports it (Worker v12+ with an AI key) is checked only when the user taps
   it, so the app makes no background requests. */
function importEnabled() { return !!FEATURES.urlImport; }
async function serverSupportsImport() {
  const c = await workerCaps();
  return !!(c.importUrl && parseInt(String(c.version || '0'), 10) >= 12);
}

/* ── Network ── */
async function requestImport({ url, text }) {
  const res = await fetch(`${CONFIG.WORKER_URL}/import-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(url ? { url } : { text }),
  });
  if (res.status === 429) return { _blocked: true, _message: 'Demasiadas importaciones seguidas. Espera una hora o rellena a mano.' };
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    return { _blocked: true, _message: e.error || `Error ${res.status}` };
  }
  return res.json();
}

function looksLikeUrl(v) { return /^https?:\/\/\S+\.\S+/i.test(v.trim()); }

/**
 * openImportSheet({ title, current, onApply })
 *   current: { brand, model, ref, type, precio, notas, calibre, … } values already saved
 *   onApply(values, meta): values = only the ticked fields; meta = { sourceUrl, source }
 */
async function openImportSheet(opts) {
  if (!navigator.onLine) { showToast('Necesitas conexión para leer un enlace'); return; }
  let ok = false;
  try { ok = await serverSupportsImport(); } catch {}
  if (!ok) { showToast('Esta función aún no está disponible en el servidor. Rellena los datos a mano.', 4000); return; }
  buildImportSheet(opts);
}

function buildImportSheet({ title = 'Rellenar desde un enlace', current = {}, onApply }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'display:flex;z-index:450;';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', title);
  overlay.innerHTML = `
    <div class="modal-sheet" style="padding-bottom:max(20px,env(safe-area-inset-bottom));">
      <div class="modal-handle"></div>
      <div class="modal-title">${escHtml(title)}</div>
      <div class="imp-step" data-step="input">
        <div class="form-field">
          <label class="form-label" for="imp-url">Enlace de la ficha del reloj</label>
          <input class="form-input" id="imp-url" type="url" inputmode="url" autocomplete="off"
                 placeholder="https://… (tienda, Amazon, AliExpress o web oficial)">
        </div>
        <details class="imp-paste">
          <summary>¿La tienda no deja leerla? Pega el texto de la ficha</summary>
          <textarea class="form-input" id="imp-text" rows="5"
            placeholder="Copia aquí las especificaciones (calibre, diámetro, cristal…)"></textarea>
        </details>
        <div class="imp-status" id="imp-status" role="status" aria-live="polite"></div>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-cancel" data-act="cancel">Cancelar</button>
          <button class="modal-btn modal-btn-save" data-act="read">Leer especificaciones</button>
        </div>
      </div>
      <div class="imp-step" data-step="review" hidden>
        <div class="imp-source" id="imp-source"></div>
        <div class="imp-rows" id="imp-rows"></div>
        <div class="imp-note">Marcado = se guarda. Lo que ya tenías y es distinto queda sin marcar: márcalo si quieres sustituirlo.</div>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-cancel" data-act="back">Atrás</button>
          <button class="modal-btn modal-btn-save" data-act="apply">Aplicar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const $ = sel => overlay.querySelector(sel);
  const status = (msg, kind = '') => { const el = $('#imp-status'); el.textContent = msg; el.dataset.kind = kind; };
  const close = () => overlay.remove();
  let found = null, sourceUrl = '';

  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  $('[data-act="cancel"]').addEventListener('click', close);
  $('[data-act="back"]').addEventListener('click', () => {
    $('[data-step="review"]').hidden = true; $('[data-step="input"]').hidden = false;
  });

  // Pasting a block of text into the link box: treat it as spec text
  $('#imp-url').addEventListener('paste', e => {
    const t = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    if (t && !looksLikeUrl(t) && t.length > 40) {
      e.preventDefault();
      $('.imp-paste').open = true; $('#imp-text').value = t;
    }
  });

  $('[data-act="read"]').addEventListener('click', async () => {
    const url  = $('#imp-url').value.trim();
    const text = $('#imp-text').value.trim();
    if (!url && !text) { status('Pega un enlace o el texto de la ficha.', 'error'); return; }
    if (url && !looksLikeUrl(url) && !text) { status('Eso no parece un enlace. Empieza por https://', 'error'); return; }
    const btn = $('[data-act="read"]');
    btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span> Leyendo…';
    status(text ? 'Leyendo el texto…' : 'Leyendo la página… (5-15 s)');
    try {
      const data = await requestImport(text ? { text } : { url });
      if (data._blocked || data._empty) {
        status(data._message || 'No se encontraron especificaciones.', 'error');
        if (data._blocked) $('.imp-paste').open = true;
        return;
      }
      found = data; sourceUrl = text ? '' : url;
      renderReview();
    } catch {
      status('Sin conexión. Inténtalo cuando tengas internet.', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Leer especificaciones';
    }
  });

  function renderReview() {
    const rows = Object.keys(IMPORT_LABELS).filter(k => found[k]);
    $('#imp-source').innerHTML = `<i class="ti ti-check" aria-hidden="true"></i> ${rows.length} datos encontrados en <strong>${escHtml(found._source || '')}</strong>` +
      (found._dropped?.length ? `<br><small>${found._dropped.length} dato(s) descartado(s) porque no aparecían en la página</small>` : '');
    $('#imp-rows').innerHTML = rows.map(k => {
      const nv = k === 'type' ? (TYPE_LABELS[found[k]] || found[k]) : found[k];
      const cvRaw = current[k];
      const cv = k === 'type' ? (TYPE_LABELS[cvRaw] || cvRaw) : cvRaw;
      const same = cv && String(cv).trim().toLowerCase() === String(nv).trim().toLowerCase();
      const checked = !cv || same;
      return `<label class="imp-row">
        <input type="checkbox" data-key="${k}" ${checked ? 'checked' : ''}>
        <span class="imp-label">${IMPORT_LABELS[k]}</span>
        <span class="imp-val">${escHtml(nv)}${cv && !same ? `<small>Ahora: ${escHtml(cv)}</small>` : ''}</span>
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

  setTimeout(() => $('#imp-url').focus(), 50);
}
window.openImportSheet = openImportSheet;

/* ═══ Contexts ═══ */

function splitImported(values) {
  const specs = {};
  IMPORT_SPEC_KEYS.forEach(k => { if (values[k]) specs[k] = values[k]; });
  return specs;
}

/* 1) New/edited watch modal */
function importIntoWatchForm() {
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
      if (st) st.textContent = `✓ ${Object.keys(v).length} datos listos para guardar (${meta.source})`;
    },
  });
}

function showImportedPreview() {
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
window.showImportedPreview = showImportedPreview;

/* 2) Existing watch (detail view) */
function importIntoWatch(watchId) {
  const w = getWatch(watchId);
  if (!w) return;
  openImportSheet({
    title: `Especificaciones · ${w.brand} ${w.model}`,
    current: { brand: w.brand, model: w.model, ref: w.ref, type: w.type, precio: w.price?.value || '', notas: w.notes, ...(w.specs || {}) },
    onApply: async (v, meta) => {
      const changes = { specs: { ...(w.specs || {}), ...splitImported(v) }, _source: meta.source };
      if (v.brand) changes.brand = v.brand;
      if (v.model) changes.model = v.model;
      if (v.ref)   changes.ref = v.ref;
      if (v.type)  changes.type = v.type;
      if (v.precio) changes.price = { value: v.precio, note: meta.source };
      if (v.notas) changes.notes = w.notes ? `${w.notes}\n${v.notas}` : v.notas;
      if (meta.sourceUrl) changes.sourceUrl = meta.sourceUrl;
      await updateWatch(watchId, changes);
      showToast(`${Object.keys(v).length} datos guardados`);
      openDetail(watchId);
    },
  });
}
window.importIntoWatch = importIntoWatch;

/* 3) Wishlist modal */
const WL_FIELDS = ['brand','model','ref','precio','notas', ...IMPORT_SPEC_KEYS];
function importIntoWishlistForm() {
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
      if (st) st.textContent = `✓ ${Object.keys(v).length} datos rellenados desde ${meta.source}. Revisa y guarda.`;
    },
  });
}

/* Wire buttons and visibility */
function refreshImportButtons() {
  const on = importEnabled();
  ['url-import-section', 'wl-url-section'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !(id === 'url-import-section' && editingWatchId)) el.hidden = !on;
  });
}
window.refreshImportButtons = refreshImportButtons;
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('f-import-btn')?.addEventListener('click', importIntoWatchForm);
  document.getElementById('wl-import-btn')?.addEventListener('click', importIntoWishlistForm);
  refreshImportButtons();
});
window.importEnabled = importEnabled;
window.serverSupportsImport = serverSupportsImport;
