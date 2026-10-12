/* ─── Rotor Pro: what it includes, buying it, and the locks on Pro features ─── */
import { buyPro, isPro, proOffer, restorePro } from '../billing.js';
import { t, tk } from '../i18n.js';
import { escHtml, showToast } from './core.js';
import { openSheet } from './sheet.js';

export const PRO_FEATURES = [
  ['ti-tool', tk('Historial de mantenimiento'), tk('Revisiones, pilas y reparaciones con su coste; los avisos se ajustan solos.')],
  ['ti-clock', tk('Precisión'), tk('Apunta cuánto adelanta o atrasa y verás sus segundos al día.')],
  ['ti-link', tk('Correas'), tk('Las correas de cada reloj y cuál lleva puesta.')],
  ['ti-chart-bar', tk('Valor de la colección'), tk('Lo que pagaste, lo que vale hoy y el coste real por uso.')],
  ['ti-shield-lock', tk('Inventario para el seguro'), tk('Un PDF con fotos, números de serie y valores, listo para tu aseguradora.')],
];

/** Small «PRO» mark next to a section title */
export function proMark() { return `<span class="pro-mark">PRO</span>`; }

/** A locked section: what it does and a way to unlock it */
export function proTeaser(title, text, icon = 'ti-lock') {
  return `<button class="pro-teaser" data-pro-open>
    <i class="ti ${icon}" aria-hidden="true"></i>
    <span><b>${title} ${proMark()}</b><small>${text}</small></span>
    <i class="ti ti-chevron-right" aria-hidden="true"></i>
  </button>`;
}
/** Wire every [data-pro-open] inside root */
export function bindProTeasers(root) {
  root?.querySelectorAll('[data-pro-open]').forEach(b => b.addEventListener('click', () => openProSheet()));
}
/** true if Pro; otherwise opens the Pro sheet */
export function requirePro() {
  if (isPro()) return true;
  openProSheet();
  return false;
}

export async function openProSheet() {
  const sh = openSheet({ label: 'Rotor Pro', className: 'pro-sheet', html: '' });
  const paint = (offer, busy = '') => {
    const pro = isPro();
    const action = pro
      ? `<div class="pro-done"><i class="ti ti-circle-check" aria-hidden="true"></i> ${t('Rotor Pro está activado. Gracias por apoyar la app.')}</div>`
      : offer?.available
        ? `<button class="action-btn btn-wear" id="pro-buy" ${busy ? 'disabled' : ''}>${busy || t('Desbloquear por {p}', { p: escHtml(offer.price) })}</button>
           <button class="modal-btn modal-btn-cancel sheet-done" id="pro-restore">${t('Ya lo compré: restaurar')}</button>`
        : offer
          ? `<div class="sheet-text">${t('Rotor Pro se compra dentro de la app de Google Play. Si ya lo compraste, abre Rotor desde Play con tu cuenta de Google y se activará solo.')}</div>`
          : `<div class="sheet-text"><span class="loading-spinner"></span></div>`;
    sh.setContent(`
      <div class="modal-title">Rotor <span class="pro-word">Pro</span></div>
      <div class="sheet-text">${t('Pago único. Sin suscripción ni anuncios. Lo gratuito sigue siendo gratuito.')}</div>
      <ul class="pro-list">${PRO_FEATURES.map(([i, h, d]) => `<li><i class="ti ${i}" aria-hidden="true"></i><span><b>${t(h)}</b><small>${t(d)}</small></span></li>`).join('')}</ul>
      ${action}
      <button class="modal-btn modal-btn-cancel sheet-done" data-close>${t('Cerrar')}</button>`);
    sh.$('#pro-buy')?.addEventListener('click', async () => {
      paint(offer, t('Abriendo Google Play…'));
      try {
        const r = await buyPro();
        if (r === 'ok') showToast(t('Rotor Pro activado'));
        else if (r === 'pending') showToast(t('Pago pendiente: Pro se activará cuando Google lo confirme'), 4000);
        else if (r === 'failed') showToast(t('No se pudo completar la compra'));
      } catch (e) { showToast(t('No se pudo verificar la compra: {e}', { e: e.message })); }
      paint(offer);
    });
    sh.$('#pro-restore')?.addEventListener('click', async () => {
      paint(offer, t('Buscando tu compra…'));
      try {
        const r = await restorePro();
        showToast(r === 'ok' ? t('Rotor Pro activado') : r === 'pending' ? t('Pago pendiente: Pro se activará cuando Google lo confirme')
          : t('No hay ninguna compra de Rotor Pro en esta cuenta de Google'));
      } catch (e) { showToast(t('No se pudo verificar la compra: {e}', { e: e.message })); }
      paint(offer);
    });
  };
  paint(null);
  paint(await proOffer());
}

/* Ajustes → Rotor Pro */
export function renderProCard() {
  const el = document.getElementById('pro-card');
  if (!el) return;
  el.innerHTML = isPro()
    ? `<button class="settings-card pro-card on" data-pro-open>
        <div class="settings-card-icon tint-gold"><i class="ti ti-crown card-icon-gold" aria-hidden="true"></i></div>
        <div class="settings-card-text"><div class="settings-card-title">Rotor Pro</div>
          <div class="settings-card-sub">${t('Activado. Gracias por apoyar la app.')}</div></div>
        <i class="ti ti-chevron-right settings-card-arrow" aria-hidden="true"></i></button>`
    : `<button class="settings-card pro-card" data-pro-open>
        <div class="settings-card-icon tint-gold"><i class="ti ti-crown card-icon-gold" aria-hidden="true"></i></div>
        <div class="settings-card-text"><div class="settings-card-title">Rotor Pro ${proMark()}</div>
          <div class="settings-card-sub">${t('Mantenimiento, precisión, correas, valor e inventario para el seguro. Pago único.')}</div></div>
        <i class="ti ti-chevron-right settings-card-arrow" aria-hidden="true"></i></button>`;
  bindProTeasers(el);
}
