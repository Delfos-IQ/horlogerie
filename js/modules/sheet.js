/**
 * sheet.js — the one bottom sheet used by every dialog created on the fly
 * (confirmations, day and wear sheets, import, key, linking).
 *
 * Same behaviour everywhere:
 *   - closes with the backdrop, any [data-close] button, Escape and the back
 *     gesture (core.js calls overlay._close on the topmost sheet);
 *   - focus moves into the sheet, Tab stays inside, and returns on close;
 *   - stacking: each new sheet sits above the previous one.
 */
import { escHtml } from './core.js';
import { t } from '../i18n.js';

let _depth = 0;
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * @param {object} o
 * @param {string} o.html           inner HTML of the sheet (below the handle)
 * @param {string} [o.label]        accessible name
 * @param {'dialog'|'alertdialog'} [o.role]
 * @param {() => void} [o.onClose]  called once, after the sheet is removed
 * @param {string} [o.className]    extra class on .modal-sheet
 * @returns {{ overlay: HTMLElement, sheet: HTMLElement, $: (s: string) => any, $$: (s: string) => any[], close: () => void, setContent: (html: string) => void }}
 */
export function openSheet({ html, label = '', role = 'dialog', onClose, className = '' }) {
  const returnFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay sheet-overlay';
  overlay.style.zIndex = String(400 + 10 * _depth++);
  overlay.setAttribute('role', role);
  overlay.setAttribute('aria-modal', 'true');
  if (label) overlay.setAttribute('aria-label', label);
  const sheet = document.createElement('div');
  sheet.className = `modal-sheet sheet ${className}`.trim();
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    _depth = Math.max(0, _depth - 1);
    overlay.remove();
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus?.();
    onClose?.();
  };
  const bindClose = () => sheet.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  const setContent = h => { sheet.innerHTML = `<div class="modal-handle"></div>${h}`; bindClose(); };
  setContent(html);

  overlay._close = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = [...sheet.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  // Focus the first field, or the sheet itself so screen readers announce it
  requestAnimationFrame(() => {
    if (closed) return;
    const target = sheet.querySelector('input, textarea, select') || sheet;
    if (target === sheet) sheet.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });

  return {
    overlay, sheet, close, setContent,
    $: s => sheet.querySelector(s),
    $$: s => [...sheet.querySelectorAll(s)],
  };
}

/**
 * Confirmation sheet. onConfirm runs only when the user accepts.
 * @param {string} title
 * @param {string} msg
 * @param {() => void} onConfirm
 * @param {{ okLabel?: string, danger?: boolean }} [opts]
 */
export function showConfirm(title, msg, onConfirm, { okLabel = t('Eliminar'), danger = true } = {}) {
  const { $, close } = openSheet({
    role: 'alertdialog', label: title,
    html: `<div class="sheet-title">${escHtml(title)}</div>
      <div class="sheet-msg">${escHtml(msg)}</div>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-cancel" id="cc" data-close>${t('Cancelar')}</button>
        <button class="modal-btn ${danger ? 'modal-btn-danger' : 'modal-btn-save'}" id="co">${escHtml(okLabel)}</button>
      </div>`,
  });
  $('#co').addEventListener('click', () => { close(); onConfirm(); });
}
