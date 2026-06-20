/**
 * app.js — Horlogerie UI
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

/* ─── State ─── */
let currentWatchId   = null;
let editingPhotoData = null;
let editingWatchId   = null;
let historySelectedWatch = null;
let historySelectedYear  = null;
let _activeTimer = null;

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

/* ─── Keyboard: Escape closes any open modal ─── */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const modals = ['wishlist-modal', 'add-modal', 'photo-sheet', 'import-session-modal', 'qr-modal'];
  for (const id of modals) {
    const el = document.getElementById(id);
    if (el && el.style.display !== 'none') {
      el.style.display = 'none';
      const fab = document.querySelector('.fab');
      if (fab) fab.focus();
      break;
    }
  }
});

/* ─── Android back gesture / browser back button ─── */
// Navigation model:
//  - 'home' is the root state, set via replaceState (never pushed again)
//  - Any other view does pushState, building a real back-stack
//  - On popstate, we ALWAYS handle navigation ourselves (never delegate
//    to the browser) UNLESS we're already at the root with nothing to
//    pop — only then does the gesture exit the app, which is correct.
window.addEventListener('popstate', e => {
  const targetView = e.state?.view || 'home';

  // If a modal is open, close it instead of navigating away
  const modals = ['wishlist-modal', 'add-modal', 'photo-sheet', 'import-session-modal', 'qr-modal'];
  for (const id of modals) {
    const el = document.getElementById(id);
    if (el && el.style.display !== 'none') {
      el.style.display = 'none';
      history.pushState({ view: targetView }, '', '');
      return;
    }
  }

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
  // When targetView is 'home' and the user gestures back again, there is
  // no further pushState entry above home, so the browser/OS takes over
  // and correctly exits the app — exactly the behaviour requested.
});

// Set initial history state on load so there's always a 'home' entry
window.addEventListener('load', () => {
  if (!history.state) {
    history.replaceState({ view: 'home' }, '', '');
  }
});

/* ─── Utilities ─── */
function showToast(msg, dur = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), dur);
}

function durationDays(startTs, endTs) {
  return Math.max(1, Math.ceil((endTs - startTs) / 86400000));
}
function daysSince(ts) {
  return Math.floor((Date.now() - ts) / 86400000);
}

/**
 * Format elapsed time since a timestamp with smart granularity:
 *   < 1h   → "23 min"
 *   < 24h  → "5h 12min"
 *   < 48h  → "1 día 3h"
 *   ≥ 48h  → "3 días 4h"
 */
function elapsedSince(ts) {
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
  } else if (days === 1) {
    return remHours > 0 ? `1 día ${remHours}h` : `1 día`;
  } else {
    return remHours > 0 ? `${days} días ${remHours}h` : `${days} días`;
  }
}

/** Short version for the grid card badge */
function elapsedShort(ts) {
  const totalMs  = Date.now() - ts;
  const totalMin = Math.floor(totalMs / 60000);
  const hours    = Math.floor(totalMin / 60);
  const days     = Math.floor(hours / 24);
  if (totalMin < 60)  return `${totalMin}min`;
  if (hours < 24)     return `${hours}h`;
  if (days === 1)     return `1 día`;
  return `${days} días`;
}
function formatDate(ts) {
  return new Date(ts).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' });
}
function watchEmoji(type) {
  return type === 'automatic' ? '⚙️' : type === 'quartz' ? '🔋' : '🕰️';
}
function typeLabel(type) {
  return type === 'automatic' ? 'Auto' : type === 'quartz' ? 'Quartz' : 'Manual';
}
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ─── Navigation ─── */
function showView(v) {
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
  document.getElementById('view-' + v).scrollTop = 0;
  updateFab(v);

  // Push a history state so Android back gesture navigates within the app
  // When on 'home', replace state (no back from home → exits app, correct behaviour)
  // When on any other view, push so back returns to previous view
  if (v === 'home') {
    history.replaceState({ view: 'home' }, '', '');
  } else {
    history.pushState({ view: v }, '', '');
  }
}

/* FAB shows only on views where "add" makes sense, and calls the right handler */
function updateFab(v) {
  const fab = document.querySelector('.fab');
  if (!fab) return;
  if (v === 'home') {
    fab.style.display = 'flex';
    fab.onclick = () => openAddModal();
    fab.setAttribute('aria-label', 'Añadir reloj');
  } else if (v === 'wishlist') {
    fab.style.display = 'flex';
    fab.onclick = () => openWishlistAdd();
    fab.setAttribute('aria-label', 'Añadir a la lista de deseos');
  } else {
    fab.style.display = 'none';
  }
}

