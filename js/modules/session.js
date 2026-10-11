/* ══════════════════════════════════════════════════════
   CLOUD KEY, DEVICE LINKING AND RECOVERY (Ajustes → Copia en la nube)

   - The session key is the only thing that identifies a collection in the
     cloud (no accounts, no email). New keys are 16 characters
     (7KQ2-M4XR-9TBW-2HNF); keys created before v2.8 are UUIDs and still work.
   - "Vincular otro dispositivo" asks the Worker for a one-use 6-character code
     valid for 10 minutes, shown as text and as a QR with a link to the app.
   - "Usar una clave o código" accepts either and merges the cloud copy here.
══════════════════════════════════════════════════════ */

import { getWatches } from '../storage.js';
import { deleteCloudData, getSessionId, getSyncMeta, importSession, isCloudEnabled, normalizeKey, normalizePairCode, pairClaim, pairCreate, rotateSessionKey, setCloudEnabled, setSyncMeta } from '../sync.js';
import { escHtml, showToast } from './core.js';
import { renderHome, showConfirm } from './home-detail.js';
import { renderCloudControls, renderSettings } from './settings.js';
import { renderWishlist } from './wishlist.js';

export const APP_URL = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`;

/** Bottom sheet built on the fly; the back gesture closes it via _close */
export function openSheet(html, { onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'display:flex;z-index:400;';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `<div class="modal-sheet" style="padding-bottom:max(20px,env(safe-area-inset-bottom));">
    <div class="modal-handle"></div>${html}</div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); onClose?.(); };
  overlay._close = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  return { overlay, close, $: sel => overlay.querySelector(sel) };
}

export function fmtPairCode(c) { return `${c.slice(0, 3)}-${c.slice(3)}`; }

export function qrSvg(text, size = 180) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text); qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true, alt: 'Código QR' })
      .replace('<svg ', `<svg width="${size}" height="${size}" `);
  } catch { return ''; }
}

/* ─── Copy / save the key ─── */
export function copySessionId() {
  const id = getSessionId();
  const done = () => showToast('Clave copiada');
  navigator.clipboard?.writeText(id).then(done).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = id; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    done();
  });
}

export function markKeySaved() {
  setSyncMeta({ keySavedAt: Date.now() });
  if (typeof renderCloudControls === 'function') renderCloudControls();
}

/** Share sheet (password manager, notes, email to yourself…) or a small .txt file */
export async function shareSessionKey() {
  const key  = getSessionId();
  const text = `Clave de recuperación de Rotor: ${key}\n\nPara recuperar tu colección: Rotor → Ajustes → «Usar una clave o código».`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Clave de Rotor', text }); markKeySaved(); showToast('Clave guardada'); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'rotor-clave.txt';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  markKeySaved();
  showToast('Clave descargada en rotor-clave.txt');
}

export function openSaveKeySheet() {
  const key = getSessionId();
  const { $, close } = openSheet(`
    <div class="modal-title">Guarda tu clave de recuperación</div>
    <div class="sheet-text">Es lo único que necesitas para recuperar tu colección si reinstalas la app o cambias de móvil.
      Rotor no te pide email ni cuenta, así que <b>si la pierdes nadie puede recuperarla</b>.</div>
    <div class="cloud-key big" id="sk-key">${escHtml(key)}</div>
    <div class="cloud-key-actions">
      <button class="session-btn" id="sk-copy"><i class="ti ti-copy" aria-hidden="true"></i> Copiar</button>
      <button class="session-btn" id="sk-share"><i class="ti ti-share" aria-hidden="true"></i> Guardar…</button>
    </div>
    <div class="sheet-hint">Guárdala en tu gestor de contraseñas o envíatela a ti mismo.</div>
    <div class="modal-actions" style="margin-top:14px;">
      <button class="modal-btn modal-btn-cancel" data-close>Más tarde</button>
      <button class="modal-btn modal-btn-save" id="sk-done">Ya la he guardado</button>
    </div>`, { onClose: () => typeof renderCloudControls === 'function' && renderCloudControls() });
  $('#sk-copy').addEventListener('click', copySessionId);
  $('#sk-share').addEventListener('click', async () => { await shareSessionKey(); if (getSyncMeta().keySavedAt) close(); });
  $('#sk-done').addEventListener('click', () => { markKeySaved(); close(); showToast('Perfecto'); });
}

/* ─── Link another device: temporary 6-character code ─── */
export async function openPairSheet() {
  const { $ } = openSheet(`
    <div class="modal-title">Vincular otro dispositivo</div>
    <div id="pair-body" class="sheet-text">Generando código…</div>
    <button class="modal-btn modal-btn-cancel" style="width:100%;margin-top:12px;" data-close>Cerrar</button>`,
    { onClose: () => clearInterval(timer) });
  let timer = null;
  const body = $('#pair-body');

  async function generate() {
    body.textContent = 'Generando código…';
    clearInterval(timer);
    let data;
    try { data = await pairCreate(); }
    catch (e) {
      body.innerHTML = `<p>${escHtml(e.message)}.</p><p>Mientras tanto, puedes escribir tu clave de recuperación en el otro dispositivo:</p>
        <div class="cloud-key big">${escHtml(getSessionId())}</div>`;
      return;
    }
    const link = `${APP_URL}#vincular=${data.code}`;
    body.innerHTML = `
      <p>En el otro dispositivo abre Rotor → <b>Ajustes</b> → <b>Usar una clave o código</b> y escribe:</p>
      <div class="pair-code" id="pair-code" aria-label="Código ${data.code.split('').join(' ')}">${fmtPairCode(data.code)}</div>
      <div class="pair-timer" id="pair-timer"></div>
      <div class="pair-qr">${qrSvg(link)}</div>
      <p class="sheet-hint">O escanea el QR con la cámara del otro móvil. Sirve una sola vez y caduca en 10 minutos.</p>`;
    const tick = () => {
      const left = Math.max(0, Math.round((data.expiresAt - Date.now()) / 1000));
      const t = body.querySelector('#pair-timer');
      if (!t) return clearInterval(timer);
      if (!left) {
        clearInterval(timer);
        body.querySelector('#pair-code')?.classList.add('expired');
        body.querySelector('.pair-qr')?.remove();
        t.innerHTML = 'Caducado. <button class="link-btn" id="pair-again">Generar otro</button>';
        t.querySelector('#pair-again').addEventListener('click', generate);
        return;
      }
      t.textContent = `Caduca en ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    };
    tick(); timer = setInterval(tick, 1000);
  }
  generate();
}

/* ─── Use a key or a code on this device (also: recover after reinstalling) ─── */
export function openLinkSheet(prefill = '') {
  const { $, close } = openSheet(`
    <div class="modal-title">Usar una clave o código</div>
    <div class="sheet-text">Escribe el <b>código de 6 caracteres</b> que ves en tu otro dispositivo, o tu <b>clave de recuperación</b>.
      Lo que ya tengas aquí se combina con lo de la nube: no se borra nada.</div>
    <div class="form-field">
      <label class="form-label" for="link-input">Código o clave</label>
      <input class="form-input mono-input" id="link-input" autocomplete="off" autocapitalize="characters" spellcheck="false"
        placeholder="K7Q-M4X  ·  7KQ2-M4XR-9TBW-2HNF" value="${escHtml(prefill)}">
    </div>
    <div class="sheet-status" id="link-status" role="status"></div>
    <div class="modal-actions">
      <button class="modal-btn modal-btn-cancel" data-close>Cancelar</button>
      <button class="modal-btn modal-btn-save" id="link-go">Recuperar</button>
    </div>`);
  const input = $('#link-input'), status = $('#link-status'), go = $('#link-go');
  const say = (msg, tone = 'mid') => { status.textContent = msg; status.style.color = `var(--${tone === 'err' ? 'danger' : 'mid'})`; };
  input.addEventListener('input', () => say(''));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
  setTimeout(() => (prefill ? go : input).focus(), 120);

  go.addEventListener('click', async () => {
    const raw  = input.value;
    const code = normalizePairCode(raw);
    const key  = code ? null : normalizeKey(raw);
    if (!code && !key) return say('Eso no parece ni un código de 6 caracteres ni una clave de recuperación.', 'err');
    if (key && key === getSessionId() && isCloudEnabled()) return say('Esa ya es la clave de este dispositivo.');
    go.disabled = true; go.textContent = 'Buscando…';
    say(code ? 'Comprobando el código…' : 'Buscando tu colección en la nube…');
    let ok = false;
    try { ok = code ? await pairClaim(code) : await importSession(key); }
    catch (e) { say(e.message, 'err'); }
    go.disabled = false; go.textContent = 'Recuperar';
    if (!ok) { if (!status.textContent || status.style.color.includes('mid')) say('No se encontró ninguna colección con esa clave.', 'err'); return; }
    close();
    renderHome(); renderSettings();
    if (typeof renderWishlist === 'function') renderWishlist();
    showToast(`Listo: ${getWatches().length} relojes en este dispositivo`);
  });
}

/* ─── Cloud on/off, new key, delete ─── */
export async function handleCloudToggle(on) {
  const input = document.getElementById('cloud-toggle');
  if (input) input.disabled = true;
  try {
    await setCloudEnabled(on);
    showToast(on ? 'Copia en la nube activada' : 'Copia en la nube desactivada. Lo que ya estaba en la nube sigue ahí.');
    renderHome();
    if (typeof renderWishlist === 'function') renderWishlist();
    if (on && !getSyncMeta().keySavedAt) openSaveKeySheet();
  } finally {
    if (input) input.disabled = false;
    renderSettings();
  }
}

export function handleRotateKey() {
  showConfirm(
    '¿Cambiar la llave?',
    'Se creará una clave nueva y se borrará la copia guardada con la actual. En tus otros dispositivos tendrás que volver a vincularlos.',
    async () => {
      try {
        await rotateSessionKey();
        renderSettings();
        openSaveKeySheet();
      } catch (e) { showToast('No se pudo cambiar la llave: ' + e.message); renderSettings(); }
    },
    { okLabel: 'Cambiar llave', danger: false }
  );
}

export function handleDeleteCloud() {
  showConfirm(
    '¿Borrar tus datos de la nube?',
    'Se borrará la copia de tu colección y tu lista de deseos guardada en la nube, y la copia en la nube quedará desactivada. Lo que hay en este dispositivo no se toca.',
    async () => {
      try {
        await deleteCloudData();
        showToast('Datos borrados de la nube');
      } catch (e) { showToast('No se pudo borrar: ' + e.message); }
      renderSettings();
    },
    { okLabel: 'Borrar de la nube' }
  );
}

/* ─── Opened from a linking QR: …/horlogerie/#vincular=K7QM4X ─── */
export function handleLinkFromUrl() {
  const m = location.hash.match(/^#vincular=([0-9A-Za-z-]{6,8})$/);
  if (!m) return;
  history.replaceState(history.state, '', location.pathname + location.search);
  const code = normalizePairCode(m[1]);
  if (code) setTimeout(() => openLinkSheet(fmtPairCode(code)), 1800);   // after the splash
}
window.addEventListener('load', handleLinkFromUrl);

