/**
 * core.js — Rotor (antes Horlogerie) UI
 * Depends on: db.js, storage.js, api.js, sync.js, export.js
 *
 * Features:
 * - Watch collection grid with wear tracking
 * - Locked cards navigable in read-only mode
 * - DB search autocomplete (Chinese brands + any brand)
 * - Wear recommendation based on least-recently-used
 * - History view with year/month filters
 * - Settings: stats, sync, PDF export, JSON backup
 */

import { t, locale } from '../i18n.js';
import { renderHome, stopActiveTimer } from './home-detail.js';
import { openAddModal } from './modals.js';
import { renderHistory } from './history.js';
import { renderSettings } from './settings.js';
import { openWishlistAdd, renderWishlist } from './wishlist.js';

/* ─── State ─── */
/** UI state shared between modules (one object, so every module sees changes) */
export const ui = {
  currentWatchId: null,        // watch open in the detail view
  editingPhotoData: null,      // photo chosen in the add/edit modal
  editingWatchId: null,        // watch being edited in the modal (null = new)
  historySelectedWatch: null,  // watch open in Historial → Por reloj
  activeTimer: null,           // interval updating the live wear time
};

/* ─── Keyboard: nav items respond to Enter/Space ─── */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        item.click();
      }
    });
  });
});

/* ─── Keyboard: Escape closes the top sheet or modal, like the back gesture ─── */
export const STATIC_MODALS = ['photo-sheet', 'wishlist-modal', 'add-modal'];   // topmost first
export function closeTopOverlay() {
  const dyn = [...document.querySelectorAll('body > .modal-overlay:not([id])')].pop();
  if (dyn) { if (typeof dyn._close === 'function') dyn._close(); else dyn.remove(); return true; }
  for (const id of STATIC_MODALS) {
    const el = document.getElementById(id);
    if (el && el.style.display !== 'none') { el.style.display = 'none'; return true; }
  }
  return false;
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && closeTopOverlay()) {
    e.preventDefault();
    document.querySelector('.fab')?.focus();
  }
});

/* ─── Android back gesture / browser back button ─── */
// Navigation model:
//  - 'home' is the root state, set via replaceState (never pushed again)
//  - Any other view does pushState, building a real back-stack
//  - On popstate, we ALWAYS handle navigation ourselves (never delegate
//    to the browser) UNLESS we're already at the root with nothing to
//    pop — only then does the gesture exit the app, which is correct.
export let _navState = null; // state of the entry currently shown (popstate only gives the new one)
export function navPush(st)    { st = { ...st, above: true }; _navState = st; history.pushState(st, '', ''); }   // above: there is an entry of ours below
export function navReplace(st) { _navState = st; history.replaceState(st, '', ''); }
let _quietPop = false;   // showView('home') already drew the collection: the pop only drops our entry
window.addEventListener('popstate', e => {
  const targetView = e.state?.view || 'home';
  if (_quietPop) { _quietPop = false; _navState = e.state || { view: 'home' }; syncBackWatcher(); return; }

  // An open sheet or modal closes first instead of navigating away
  if (closeTopOverlay()) {
    navPush(_navState || { view: targetView });
    return;
  }

  _navState = e.state || { view: 'home' };
  // Always render the target view explicitly — including 'home'.
  // This is what makes the gesture go "back into the app" instead of
  // exiting it when there's still a view above home in the stack.
  document.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(x => {
    x.classList.remove('active');
    x.setAttribute('aria-selected', 'false');
  });
  const viewEl = document.getElementById('view-' + targetView);
  if (viewEl) viewEl.classList.add('active');
  const navEl = document.getElementById('nav-' + targetView);
  if (navEl) { navEl.classList.add('active'); navEl.setAttribute('aria-selected', 'true'); }
  stopActiveTimer();
  if (targetView === 'home')     renderHome();
  if (targetView === 'history')  renderHistory();
  if (targetView === 'settings') renderSettings();
  if (targetView === 'wishlist') renderWishlist();
  updateFab(targetView);
  syncBackWatcher();
  // When targetView is 'home' and the user gestures back again, there is
  // no further pushState entry above home, so the browser/OS takes over
  // and correctly exits the app — exactly the behaviour requested.
});

/* ─── Back gesture on Android (Chrome 120+): CloseWatcher ───
   Android can skip history entries when it decides the page added them on its own, and then the
   back gesture leaves the app from any screen. A CloseWatcher receives the gesture first, so:
   an open sheet closes; another section goes back to the collection; from the collection, the
   gesture leaves the app (no watcher there). Browsers without CloseWatcher use the history above. */
let _watcher = null;
const overlayOpen = () => !!document.querySelector('body > .modal-overlay:not([id])') ||
  STATIC_MODALS.some(id => { const el = document.getElementById(id); return el && el.style.display !== 'none'; });
function handleBack() {
  if (closeTopOverlay()) return syncBackWatcher();
  if (history.state?.above) history.back();          // popstate renders the screen below (the collection)
  else if ((_navState?.view || 'home') !== 'home') showView('home');
  syncBackWatcher();
}
export function syncBackWatcher() {
  if (typeof window.CloseWatcher !== 'function') return;
  const need = (_navState?.view || 'home') !== 'home' || !!_navState?.hw || overlayOpen();
  if (need && !_watcher) {
    try { _watcher = new window.CloseWatcher(); _watcher.onclose = () => { _watcher = null; handleBack(); }; }
    catch { _watcher = null; }
  } else if (!need && _watcher) {
    const w = _watcher; _watcher = null; w.onclose = null; w.destroy();
  }
}
let _syncQueued = false;
new MutationObserver(() => {
  if (_syncQueued) return;
  _syncQueued = true;
  queueMicrotask(() => { _syncQueued = false; syncBackWatcher(); });
}).observe(document.body, { childList: true });
document.addEventListener('DOMContentLoaded', () => {
  for (const id of STATIC_MODALS) {
    const el = document.getElementById(id);
    if (el) new MutationObserver(() => syncBackWatcher()).observe(el, { attributes: true, attributeFilter: ['style'] });
  }
});

// Set initial history state on load so there's always a 'home' entry
window.addEventListener('load', () => {
  if (!history.state) {
    navReplace({ view: 'home' });
  } else _navState = history.state;
});

/* ─── Utilities ─── */
export function showToast(msg, dur = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), dur);
}


/**
 * Format elapsed time since a timestamp with smart granularity:
 *   < 1h   → "23 min"
 *   < 24h  → "5h 12min"
 *   < 48h  → "1 día 3h"
 *   ≥ 48h  → "3 días 4h"
 */
export function elapsedSince(ts) {
  const totalMs  = Date.now() - ts;
  const totalMin = Math.floor(totalMs / 60000);
  const hours    = Math.floor(totalMin / 60);
  const minutes  = totalMin % 60;
  const days     = Math.floor(hours / 24);
  const remHours = hours % 24;

  if (totalMin < 60) {
    return `${totalMin} min`;
  } else if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
  }
  const d = days === 1 ? t('1 día') : t('{n} días', { n: days });
  return remHours > 0 ? `${d} ${remHours}h` : d;
}

/** Short version for the grid card badge */
export function elapsedShort(ts) {
  const totalMs  = Date.now() - ts;
  const totalMin = Math.floor(totalMs / 60000);
  const hours    = Math.floor(totalMin / 60);
  const days     = Math.floor(hours / 24);
  if (totalMin < 60)  return `${totalMin}min`;
  if (hours < 24)     return `${hours}h`;
  return days === 1 ? t('1 día') : t('{n} días', { n: days });
}
export function formatDate(ts) {
  return new Date(ts).toLocaleDateString(locale(), { day:'2-digit', month:'short', year:'numeric' });
}
/** Drawn dial used when a watch has no photo (inline SVG, follows the text colour) */
export const DIAL_SVG = '<svg class="dial-art" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect x="57" y="29" width="4" height="6" rx="1" fill="currentColor" opacity=".55"/><circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M32.0 13.0L32.0 9.0M42.2 14.2L43.5 12.1M49.8 21.8L51.9 20.5M51.0 32.0L55.0 32.0M49.8 42.2L51.9 43.5M42.2 49.8L43.5 51.9M32.0 51.0L32.0 55.0M21.8 49.8L20.5 51.9M14.2 42.3L12.1 43.5M13.0 32.0L9.0 32.0M14.2 21.8L12.1 20.5M21.7 14.2L20.5 12.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M32 32L23.5 26.5M32 32L40.5 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="32" cy="32" r="2" fill="currentColor"/></svg>';
export function dialArt() { return DIAL_SVG; }
export function typeLabel(type) {
  return type === 'automatic' ? t('Automático') : type === 'quartz' ? t('Cuarzo') : t('Manual');
}
export function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ─── Navigation ─── */
export function showView(v) {
  // Re-rendering the view that is already open: keep scroll and back stack
  const sameView = !!document.getElementById('view-' + v)?.classList.contains('active');
  document.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(x => {
    x.classList.remove('active');
    x.setAttribute('aria-selected', 'false');
  });
  const viewEl = document.getElementById('view-' + v);
  if (viewEl) viewEl.classList.add('active');
  const navEl = document.getElementById('nav-' + v);
  if (navEl) {
    navEl.classList.add('active');
    navEl.setAttribute('aria-selected', 'true');
  }
  if (v !== 'detail') stopActiveTimer();
  if (v === 'home')     renderHome();
  if (v === 'history')  renderHistory();
  if (v === 'settings') renderSettings();
  if (v === 'wishlist') renderWishlist();
  if (!sameView) document.getElementById('view-' + v).scrollTop = 0;
  updateFab(v);

  // Push a history state so Android back gesture navigates within the app
  // When on 'home', replace state (no back from home → exits app, correct behaviour)
  // When on any other view, push so back returns to previous view
  // Every section sits one step above the collection: back always returns to the collection,
  // and from the collection the gesture leaves the app.
  if (v === 'home') {
    if (history.state?.above) { _navState = { view: 'home' }; _quietPop = true; history.back(); }   // drop our entry: back from here exits
    else navReplace({ view: 'home' });
  } else if (sameView || history.state?.above) {
    navReplace({ view: v, above: !!history.state?.above });
  } else {
    navPush({ view: v });
  }
  syncBackWatcher();
}

/* FAB shows only on views where "add" makes sense, and calls the right handler */
export function updateFab(v) {
  const fab = document.querySelector('.fab');
  if (!fab) return;
  if (v === 'home') {
    fab.style.display = 'flex';
    fab.onclick = () => openAddModal();
    fab.setAttribute('aria-label', t('Añadir reloj'));
  } else if (v === 'wishlist') {
    fab.style.display = 'flex';
    fab.onclick = () => openWishlistAdd();
    fab.setAttribute('aria-label', t('Añadir a la lista de deseos'));
  } else {
    fab.style.display = 'none';
  }
}

