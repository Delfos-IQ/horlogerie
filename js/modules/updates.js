import { escHtml, showToast } from './core.js';
import { renderSystemStatus } from './settings.js';
import { lang, t } from '../i18n.js';

export const APP_VERSION = '2.17.1'; // Must match version.json

export async function initVersionCheck() {
  // Silent check on every launch — fetch version.json bypassing cache
  try {
    const res = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.version && data.version !== APP_VERSION) showUpdateBanner(data.version, data.notes);
  } catch { /* Offline — skip */ }
}

export function showUpdateBanner(newVersion, notes) {
  // Show a persistent banner at top of screen
  const existing = document.getElementById('update-banner');
  if (existing) return;

  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.className = 'update-banner';
  const showNotes = notes && lang() === 'es';   // release notes are written in Spanish
  banner.innerHTML = `
    <div>
      <span><i class="ti ti-arrow-up-circle" aria-hidden="true"></i> ${t('Nueva versión {v} disponible', { v: escHtml(newVersion) })}</span>
      ${showNotes ? `<div class="update-banner-notes">${escHtml(notes)}</div>` : ''}
    </div>
    <button class="update-banner-btn" data-action="applyUpdate">${t('Actualizar')}</button>
  `;
  document.body.appendChild(banner);
}

/** Ajustes → Estado del sistema → Versión instalada → ↻ */
export async function checkForUpdate() {
  const icon = document.getElementById('update-top-icon');
  const val  = document.getElementById('status-version-val');
  const sub  = document.getElementById('status-version-sub');
  if (icon) icon.style.animation = 'spin 1s linear infinite';
  if (val) { val.dataset.busy = '1'; val.textContent = t('Comprobando…'); val.style.color = 'var(--mid)'; }
  try {
    const res = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(t('No se pudo conectar'));
    const data = await res.json();
    if (data.version && data.version !== APP_VERSION) {
      if (val) { val.textContent = t('v{v} disponible · instalando…', { v: data.version }); val.style.color = 'var(--gold-light)'; }
      showToast(t('Nueva versión {v}. Instalando…', { v: data.version }), 3000);
      setTimeout(() => applyUpdate(), 1500);
    } else {
      delete val?.dataset.busy;
      if (typeof renderSystemStatus === 'function') await renderSystemStatus();
      showToast(t('Ya tienes la versión más reciente'));
    }
  } catch {
    if (val) { delete val.dataset.busy; val.textContent = `v${APP_VERSION}`; val.style.color = 'var(--light)'; }
    if (sub) sub.textContent = t('Sin conexión: no se pudo comprobar');
    showToast(t('Sin conexión: no se pudo comprobar'));
  }
  if (icon) icon.style.animation = '';
}

export async function applyUpdate() {
  showToast(t('Reinstalando… la app se reiniciará'));
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch(e) {}
  setTimeout(() => window.location.reload(true), 300);
}
/* ══════════════════════════════════════════════════════
   URL IMPORT — wishlist
   Sends URL to Cloudflare Worker → compound-beta reads
   Amazon/AliExpress/etc → fills wishlist form fields
══════════════════════════════════════════════════════ */
