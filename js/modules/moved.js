/**
 * moved.js — the old address (GitHub Pages, /horlogerie/) now forwards to the new one
 * (https://rotor.pedicode-app.workers.dev/app/, the one the Google Play app opens).
 *
 * Browsers keep data per address, so a plain redirect would leave the watches behind:
 *   - nothing stored here → go to the new address straight away;
 *   - watches or wishlist here → «Llevar mis relojes»: turn the (encrypted) cloud copy on if it
 *     was off, create a one-use code and open the new address with it (…/app/#vincular=CODE),
 *     where one tap brings everything over.
 */
import { getWatches, getWishlist } from '../storage.js';
import { isCloudEnabled, pairCreate, setCloudEnabled } from '../sync.js';
import { errText } from '../api.js';
import { showToast } from './core.js';
import { openSheet } from './sheet.js';
import { lang, t } from '../i18n.js';

export const NEW_APP = 'https://rotor.pedicode-app.workers.dev/app/';
export const isOldAddress = () => location.hostname === 'delfos-iq.github.io';
const newAppUrl = (hash = '') => `${NEW_APP}?lang=${lang()}${hash}`;

/** On start: true when this is the old address (the caller then skips onboarding) */
export function checkMoved() {
  if (!isOldAddress()) return false;
  if (!getWatches().length && !getWishlist().length) {
    location.replace(newAppUrl(location.hash));
    return true;
  }
  setTimeout(openMoveSheet, 1900);   // after the splash
  return true;
}

export function openMoveSheet() {
  const cloudOff = !isCloudEnabled();
  const { $, close } = openSheet({
    label: t('Rotor se ha mudado'),
    html: `<div class="sheet-title">${t('Rotor se ha mudado')}</div>
      <div class="sheet-msg">${t('Rotor vive ahora en rotor.pedicode-app.workers.dev/app, la dirección que usará la app de Google Play. Esta dirección antigua ya no se usa.')}</div>
      <div class="sheet-msg">${cloudOff
        ? t('Con un toque llevamos tus relojes (fotos e historial incluidos) a la nueva dirección. Para hacerlo se activa tu copia en la nube, cifrada en este dispositivo.')
        : t('Con un toque llevamos tus relojes (fotos e historial incluidos) a la nueva dirección, a través de tu copia en la nube.')}</div>
      <div class="sheet-msg">${t('Allí, instala Rotor desde el navegador y borra el icono antiguo.')}</div>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-cancel" data-close>${t('Ahora no')}</button>
        <button class="modal-btn modal-btn-save" id="mv-go">${t('Llevar mis relojes')}</button>
      </div>`,
  });
  const go = $('#mv-go');
  go.addEventListener('click', async () => {
    go.disabled = true; go.textContent = t('Preparando…');
    try {
      if (!isCloudEnabled() && !(await setCloudEnabled(true))) throw new Error(t('No se pudo activar la copia en la nube'));
      const { code } = await pairCreate();
      close();
      location.replace(newAppUrl(`#vincular=${code}`));
    } catch (e) {
      showToast(errText(e), 4200);
      go.disabled = false; go.textContent = t('Llevar mis relojes');
    }
  });
}
