/**
 * main.js — entrada de la app (módulo ES).
 *
 * - Importa los módulos, conecta storage con la UI (avisos) y con la nube.
 * - Delegación de eventos: el HTML no lleva código (onclick=""); los botones
 *   declaran data-action / data-arg, data-action-event, data-change o
 *   data-input. Eso permite una CSP estricta (script-src 'self').
 * - Arranque: pantalla de bienvenida, fotos, recomendación, service worker,
 *   comprobación de versión y sincronización.
 */
import { onLoad } from './ready.js';
import * as storage from './storage.js';
import * as sync from './sync.js';
import * as exporter from './export.js';
import * as core from './modules/core.js';
import * as homeDetail from './modules/home-detail.js';
import * as modals from './modules/modals.js';
import * as history from './modules/history.js';
import * as settings from './modules/settings.js';
import * as wishlist from './modules/wishlist.js';
import * as session from './modules/session.js';
import * as updates from './modules/updates.js';
import * as urlImport from './modules/url-import.js';
import * as db from './db.js';
import * as i18n from './i18n.js';
import * as onboarding from './modules/onboarding.js';
import * as billing from './billing.js';
import * as pro from './modules/pro.js';
import * as care from './modules/care.js';
import * as complications from './modules/complications.js';
import * as reminders from './reminders.js';
import * as moved from './modules/moved.js';
import { fillBrowserLine, mountBrowserNotice } from './browser-check.js';

// Language and theme first: the static HTML is translated before anything is drawn
i18n.applyTheme();
i18n.translateDOM();

// Logo and name lead to the Rotor website. In the installed app (Play or added to the home
// screen) the website opens in the browser, on top: the app stays as it was underneath.
const installed = window.matchMedia?.('(display-mode: standalone)').matches
  || navigator.standalone === true || document.referrer.startsWith('android-app://');
if (installed) document.querySelectorAll('[data-web-brand]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
storage.setNotifier(msg => core.showToast(i18n.t(msg)));

/* ── Actions available to data-action="…" (and data-arg) ── */
const actions = {
  showView:          arg => core.showView(arg),
  historyMode:       arg => history.setHistoryMode(arg, true),
  detailTab:         arg => homeDetail.setDetailTab(arg),
  openTodaySheet:    () => homeDetail.openTodaySheet(),
  openProSheet:      () => pro.openProSheet(),
  openInsurance:     () => { if (pro.requirePro()) care.openInsuranceSheet(); },
  openLinkSheet:     () => session.openLinkSheet(),
  openPairSheet:     () => session.openPairSheet(),
  openSaveKeySheet:  () => session.openSaveKeySheet(),
  copySessionId:     () => session.copySessionId(),
  shareSessionKey:   () => session.shareSessionKey(),
  handleRotateKey:   () => session.handleRotateKey(),
  handleDeleteCloud: () => session.handleDeleteCloud(),
  syncManual:        () => sync.syncManual(),
  checkForUpdate:    () => updates.checkForUpdate(),
  applyUpdate:       () => updates.applyUpdate(),
  handleExportPDF:   () => settings.handleExportPDF(),
  handleExportJSON:  () => settings.handleExportJSON(),
  handleImportJSON:  () => settings.handleImportJSON(),
  openWishlistAdd:   () => wishlist.openWishlistAdd(),
  closeWishlistModal:() => wishlist.closeWishlistModal(),
  saveWishlistItem:  () => wishlist.saveWishlistItem(),
  saveWatch:         () => modals.saveWatch(),
  closeAddModal:     () => modals.closeAddModal(),
  openPhotoSheet:    () => modals.openPhotoSheet(),
  openMoveSheet:     () => moved.openMoveSheet(),
  closePhotoSheet:   () => modals.closePhotoSheet(),
  // receive the event (click on the dark backdrop closes the sheet)
  closeModalIfOutside:         e => modals.closeModalIfOutside(e),
  closePhotoSheetIfOutside:    e => modals.closePhotoSheetIfOutside(e),
  closeWishlistModalIfOutside: e => wishlist.closeWishlistModalIfOutside(e),
};
const changeHandlers = {
  cloudToggle:       e => session.handleCloudToggle(e.target.checked),
  handlePhotoUpload: e => modals.handlePhotoUpload(e),
  processImportJSON: e => settings.processImportJSON(e),
  prefLang:          e => settings.handlePrefChange('lang', e.target.value),
  prefTheme:         e => settings.handlePrefChange('theme', e.target.value),
  prefCurrency:      e => settings.handlePrefChange('currency', e.target.value),
};
const inputHandlers = {
  dbSearch: e => modals.handleDbSearch(e.target.value),
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action], [data-action-event]');
  if (!el) return;
  if (el.dataset.actionEvent) {
    const fn = actions[el.dataset.actionEvent];
    if (fn) fn(e);
    return;
  }
  const fn = actions[el.dataset.action];
  if (fn) fn(el.dataset.arg);
  else console.warn('Acción desconocida:', el.dataset.action);
});
document.addEventListener('change', e => {
  const fn = changeHandlers[e.target.dataset?.change];
  if (fn) fn(e);
});
document.addEventListener('input', e => {
  const fn = inputHandlers[e.target.dataset?.input];
  if (fn) fn(e);
});

/* ── Start ── */
setTimeout(() => {
  const intro = document.getElementById('intro');
  intro?.classList.add('fade');
  setTimeout(() => { if (intro) intro.style.display = 'none'; }, 600);
}, 1600);

storage.loadPhotos().then(() => {
  homeDetail.renderHome(); core.updateFab('home');
  settings.setupFeedbackLink();
  if (moved.checkMoved()) return;
  mountBrowserNotice(document.getElementById('browser-notice'), i18n.lang());
  if (fillBrowserLine(document.getElementById('status-browser-sub'), i18n.lang())) {   // Ajustes → Estado del sistema
    document.getElementById('status-browser-row').hidden = false;
    document.getElementById('status-browser-div').hidden = false;
  }   // old address: forward to the new one (bringing the watches)
  if (storage.getWatches().length) storage.requestPersistence();
  else if (!location.hash.startsWith('#vincular=')) setTimeout(() => onboarding.maybeShowOnboarding(), 1900);   // after the splash
});

// Service workers registered outside the app folder (/horlogerie/ or /app/) by very old versions
const APP_SCOPE = new URL('./', location.href).href;
navigator.serviceWorker?.getRegistrations?.()
  .then(regs => regs.filter(r => r.scope !== APP_SCOPE).forEach(r => r.unregister()))
  .catch(() => {});

if ('serviceWorker' in navigator) {
  onLoad(() => {
    // Reload only when a new SW replaces one that already controlled the page, once
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    const reloadOnce = () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(reg => reg.update())
      .catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
    navigator.serviceWorker.addEventListener('message', e => { if (e.data?.type === 'SW_UPDATED') reloadOnce(); });
  });
}
// Reminders: keep the plan the service worker reads in step with the collection
let remindTimer = null;
const replan = () => { clearTimeout(remindTimer); remindTimer = setTimeout(reminders.syncReminderPlan, 800); };
storage.onDataChange(replan);
document.addEventListener('visibilitychange', () => { if (document.hidden) reminders.syncReminderPlan(); });

/* Opened from a reminder: …/horlogerie/#reloj=<id> */
function openFromHash(hash = location.hash) {
  const m = /^#reloj=([A-Za-z0-9_-]{1,64})$/.exec(hash);
  if (!m) return;
  window.history.replaceState(window.history.state, '', location.pathname + location.search);
  if (storage.getWatch(m[1])) homeDetail.openDetail(m[1], 'maint');
}
navigator.serviceWorker?.addEventListener('message', e => {
  if (e.data?.type === 'OPEN_URL') openFromHash(new URL(e.data.url, location.href).hash);
});
window.addEventListener('hashchange', () => openFromHash());

// Pro switched on or off (purchase, restore, refund): repaint what is on screen
billing.onProChange(() => {
  replan();
  const v = document.querySelector('.view.active')?.id?.replace('view-', '');
  if (v === 'detail' && core.ui.currentWatchId) homeDetail.openDetail(core.ui.currentWatchId);
  else if (v === 'history') history.renderHistory();
  else if (v === 'settings') settings.renderSettings();
});

onLoad(() => {
  setTimeout(billing.recheckPro, 3000);
  setTimeout(async () => {
    await reminders.syncReminderPlan();
    openFromHash();
    // Without background sync this is the only moment due reminders can be shown
    if (reminders.remindersOn()) navigator.serviceWorker?.controller?.postMessage({ type: 'RUN_REMINDERS' });
  }, 1900);
  setTimeout(updates.initVersionCheck, 2000);
  setTimeout(sync.syncAuto, 1200);
});

/* ── Console and test access ──
   window.rotor exposes the modules for debugging. On localhost (tests,
   development) every exported function is also global, as before. */
const modulesApi = { storage, sync, exporter, core, homeDetail, modals, history, settings, wishlist, session, updates, urlImport, db, i18n, onboarding, billing, pro, care, reminders, complications };
window.rotor = modulesApi;
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  for (const mod of Object.values(modulesApi)) {
    for (const [k, v] of Object.entries(mod)) if (typeof v === 'function' && !(k in window)) window[k] = v;
  }
}
