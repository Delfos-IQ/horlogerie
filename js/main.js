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

storage.setNotifier(core.showToast);

/* ── Actions available to data-action="…" (and data-arg) ── */
const actions = {
  showView:          arg => core.showView(arg),
  historyMode:       arg => history.setHistoryMode(arg, true),
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
  closePhotoSheet:   () => modals.closePhotoSheet(),
  choosePhotoSource: arg => modals.choosePhotoSource(arg),
  // receive the event (click on the dark backdrop closes the sheet)
  closeModalIfOutside:         e => modals.closeModalIfOutside(e),
  closePhotoSheetIfOutside:    e => modals.closePhotoSheetIfOutside(e),
  closeWishlistModalIfOutside: e => wishlist.closeWishlistModalIfOutside(e),
};
const changeHandlers = {
  cloudToggle:       e => session.handleCloudToggle(e.target.checked),
  handlePhotoUpload: e => modals.handlePhotoUpload(e),
  processImportJSON: e => settings.processImportJSON(e),
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
  if (storage.getWatches().length) storage.requestPersistence();
});

// Service workers registered outside /horlogerie/ by very old versions
navigator.serviceWorker?.getRegistrations?.()
  .then(regs => regs.filter(r => !r.scope.includes('/horlogerie/')).forEach(r => r.unregister()))
  .catch(() => {});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Reload only when a new SW replaces one that already controlled the page, once
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    const reloadOnce = () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.register('./sw.js', { scope: '/horlogerie/' })
      .then(reg => reg.update())
      .catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
    navigator.serviceWorker.addEventListener('message', e => { if (e.data?.type === 'SW_UPDATED') reloadOnce(); });
  });
}
window.addEventListener('load', () => {
  setTimeout(updates.initVersionCheck, 2000);
  setTimeout(sync.syncAuto, 1200);
});

/* ── Console and test access ──
   window.rotor exposes the modules for debugging. On localhost (tests,
   development) every exported function is also global, as before. */
const modulesApi = { storage, sync, exporter, core, homeDetail, modals, history, settings, wishlist, session, updates, urlImport, db };
window.rotor = modulesApi;
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  for (const mod of Object.values(modulesApi)) {
    for (const [k, v] of Object.entries(mod)) if (typeof v === 'function' && !(k in window)) window[k] = v;
  }
}
