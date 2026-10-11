/* ─── First run: three lines on what Rotor does, then straight to work ─── */
import { getWatches } from '../storage.js';
import { prefs, setPref, t } from '../i18n.js';
import { openSheet } from './sheet.js';
import { openAddModal } from './modals.js';
import { openLinkSheet } from './session.js';
import { DIAL_SVG } from './core.js';

/** Shown once, on a device with no watches. Automated browsers skip it unless forced. */
export function maybeShowOnboarding({ force = false } = {}) {
  if (!force && (prefs.onboarded || getWatches().length || navigator.webdriver)) return false;
  const points = [
    ['ti-hand-finger', t('Apunta el reloj que llevas cada día con un toque.')],
    ['ti-refresh', t('Rotor te sugiere el que lleva más tiempo en la caja, para que todos se usen.')],
    ['ti-shield-lock', t('Tus datos se quedan en tu móvil. La copia en la nube es opcional y va cifrada.')],
  ];
  const { $, close } = openSheet({
    label: t('Bienvenido a Rotor'),
    className: 'onboarding',
    onClose: () => setPref('onboarded', true),
    html: `<div class="ob-mark">${DIAL_SVG}</div>
      <div class="modal-title ob-title">${t('Bienvenido a Rotor')}</div>
      <ul class="ob-points">${points.map(([i, txt]) => `<li><i class="ti ${i}" aria-hidden="true"></i><span>${txt}</span></li>`).join('')}</ul>
      <button class="action-btn btn-wear" id="ob-add"><i class="ti ti-plus" aria-hidden="true"></i> ${t('Añadir mi primer reloj')}</button>
      <button class="modal-btn modal-btn-cancel sheet-done" id="ob-recover">${t('Ya uso Rotor: recuperar mis relojes')}</button>`,
  });
  $('#ob-add').addEventListener('click', () => { close(); openAddModal(); });
  $('#ob-recover').addEventListener('click', () => { close(); openLinkSheet(); });
  return true;
}
