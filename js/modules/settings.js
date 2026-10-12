/* ─── SETTINGS ─── */
import { buildBackup, getWatches, getWishlist, importBackup, isPersisted, storageRecovered } from '../storage.js';
import { cloudInfo, getSessionId, getSyncMeta, isCloudEnabled, isShortKey, workerCaps } from '../sync.js';
import { generateCollectionPDF } from '../export.js';
import { showToast } from './core.js';
import { renderHome } from './home-detail.js';
import { showConfirm } from './sheet.js';
import { renderWishlist } from './wishlist.js';
import { renderProCard } from './pro.js';

import { APP_VERSION } from './updates.js';
import { CURRENCIES, LANGS, THEMES, currencySymbol, locale, prefs, setPref, t } from '../i18n.js';

export function renderSettings() {
  renderProCard();
  renderPrefs();
  renderCloudControls();
  renderSystemStatus();
  renderBackupInfo();
}

/* ─── JSON backup: when was the last one ─── */
export const BACKUP_KEY = 'horlogerie_last_backup';
export function lastBackupAt() { try { return Number(localStorage.getItem(BACKUP_KEY)) || 0; } catch { return 0; } }
export function daysAgoLabel(ts) {
  const d = Math.floor((Date.now() - ts) / 86400000);
  return d <= 0 ? t('hoy') : d === 1 ? t('ayer') : t('hace {n} días', { n: d });
}
export function renderBackupInfo() {
  const el = document.getElementById('backup-card-sub');
  if (!el) return;
  const last = lastBackupAt();
  el.textContent = last ? t('Última copia: {d} · relojes, fotos, historial y deseos', { d: daysAgoLabel(last) })
                        : t('Relojes, fotos, historial y lista de deseos en un archivo');
}

/**
 * Discreet reminder on Colección when the cloud is off and there is no recent
 * JSON copy (30 days). Not shown during the first week or if dismissed.
 */
export function renderBackupReminder() {
  const el = document.getElementById('backup-reminder');
  if (!el) return;
  if (storageRecovered?.length && !window._recoveryDismissed) {
    el.innerHTML = `<div class="backup-reminder" role="alert">
        <i class="ti ti-shield-exclamation" aria-hidden="true"></i>
        <span>${t('Parte de los datos guardados en este móvil no se podía leer. Se ha apartado una copia sin tocarla. Recupera tu colección con tu clave (Ajustes → Usar una clave o código) o con una copia JSON.')}</span>
        <button class="br-x" id="br-x" aria-label="${t('Cerrar aviso')}"><i class="ti ti-x" aria-hidden="true"></i></button>
      </div>`;
    el.querySelector('#br-x').addEventListener('click', () => { window._recoveryDismissed = true; renderBackupReminder(); });
    return;
  }
  const ws = getWatches();
  const oldest = ws.reduce((m, w) => Math.min(m, w.created || Date.now()), Date.now());
  let snoozed = 0; try { snoozed = Number(localStorage.getItem(BACKUP_KEY + '_snooze')) || 0; } catch {}
  const DAY = 86400000, last = lastBackupAt();
  const due = !isCloudEnabled() && ws.length > 0 && Date.now() - oldest > 7 * DAY
    && Date.now() - last > 30 * DAY && Date.now() - snoozed > 30 * DAY;
  if (!due) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="backup-reminder" role="status">
      <i class="ti ti-shield-exclamation" aria-hidden="true"></i>
      <span>${last ? t('Tu última copia es de {d}.', { d: daysAgoLabel(last) }) : t('Aún no tienes copia de tu colección.')} ${t('Si cambias de móvil, la necesitarás.')}</span>
      <button class="br-do" id="br-do">${t('Hacer copia')}</button>
      <button class="br-x" id="br-x" aria-label="${t('Recordármelo dentro de un mes')}"><i class="ti ti-x" aria-hidden="true"></i></button>
    </div>`;
  el.querySelector('#br-do').addEventListener('click', () => handleExportJSON());
  el.querySelector('#br-x').addEventListener('click', () => {
    try { localStorage.setItem(BACKUP_KEY + '_snooze', String(Date.now())); } catch {}
    el.innerHTML = '';
  });
}
export async function handleExportPDF() {
  if (!getWatches().length) { showToast(t('No hay relojes')); return; }
  try { await generateCollectionPDF(); } catch (e) { showToast(t('No se pudo crear el PDF: {e}', { e: e.message })); }
}

export async function handleExportJSON() {
  if (!getWatches().length && !getWishlist().length) { showToast(t('No hay datos')); return; }
  const backup = await buildBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `${t('rotor-copia')}-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(t('Copia descargada · {w} relojes, {l} deseos', { w: backup.watches.length, l: backup.wishlist.length }));
  try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch {}
  renderBackupInfo(); renderBackupReminder();
}

export function handleImportJSON() { document.getElementById('import-json-input').click(); }

export function processImportJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    let data;
    try { data = JSON.parse(ev.target.result); }
    catch { showToast(t('El archivo no es un JSON válido')); e.target.value = ''; return; }
    const nW  = Array.isArray(data) ? data.length : (data?.watches?.length || 0);
    const nWl = Array.isArray(data?.wishlist) ? data.wishlist.length : 0;
    if (!nW && !nWl) { showToast(t('No encuentro relojes en ese archivo')); e.target.value = ''; return; }
    showConfirm(t('Restaurar copia de seguridad'),
      (nWl ? t('El archivo tiene {w} relojes y {l} deseos.', { w: nW, l: nWl }) : t('El archivo tiene {w} relojes.', { w: nW })) + ' ' +
      t('Se combinarán con lo que ya tienes: si un reloj está en los dos sitios, se queda la versión modificada más recientemente. No se borra nada.'),
      async () => {
        try {
          const r = await importBackup(data);
          const msg = t('Restaurado · {n} relojes revisados', { n: r.total }) +
            (r.totalWishlist ? ', ' + t('{n} deseos', { n: r.totalWishlist }) : '') +
            (r.rejected ? ' · ' + t('{n} entradas no válidas ignoradas', { n: r.rejected }) : '');
          showToast(msg, 4000);
          renderHome(); renderSettings();
          if (typeof renderWishlist === 'function') renderWishlist();
        } catch (err) { showToast(t('No se pudo restaurar: {e}', { e: t(err.message) })); }
      },
      { okLabel: t('Restaurar'), danger: false });
    e.target.value = '';
  };
  reader.readAsText(file);
}

/* ─── System status panel ─── */
export function agoLabel(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  return mins < 1 ? t('hace un momento') : mins < 60 ? t('hace {n} min', { n: mins })
    : mins < 1440 ? t('hace {n} h', { n: Math.round(mins / 60) }) : t('hace {n} días', { n: Math.round(mins / 1440) });
}
export function fmtDateEs(iso) {
  const d = new Date(iso + 'T12:00');
  return isNaN(d) ? iso : d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
}
export function paintStatusIcon(el, tone) {
  if (!el) return;
  const c = { ok: 'var(--ok)', gold: 'var(--gold-light)', warn: 'var(--danger)', off: 'var(--mid)' }[tone];
  el.style.color = c;
  el.style.background = tone === 'off' ? 'var(--dark3)' : `color-mix(in srgb, ${c} 12%, transparent)`;
}

export async function renderSystemStatus() {
  // ── Version ──
  const vVal = document.getElementById('status-version-val');
  const vSub = document.getElementById('status-version-sub');
  if (vVal && !vVal.dataset.busy) {
    try {
      const res  = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
      const data = await res.json();
      const upToDate = (data.version || APP_VERSION) === APP_VERSION;
      vVal.textContent = upToDate ? `v${APP_VERSION} · ${t('al día')}` : t('v{a} → v{b} disponible', { a: APP_VERSION, b: data.version });
      vVal.style.color = upToDate ? 'var(--ok)' : 'var(--gold-light)';
      if (vSub) vSub.textContent = data.date
        ? (upToDate ? t('Publicada el {d}', { d: fmtDateEs(data.date) }) : t('Nueva del {d}', { d: fmtDateEs(data.date) }) + (data.notes ? ': ' + data.notes : '')) : '';
      paintStatusIcon(document.getElementById('status-version-icon'), upToDate ? 'ok' : 'gold');
    } catch {
      vVal.textContent = `v${APP_VERSION}`; vVal.style.color = 'var(--light)';
      if (vSub) vSub.textContent = t('Sin conexión para comprobar');
    }
  }

  // ── Data on this device ──
  const lVal = document.getElementById('status-local-val');
  const lSub = document.getElementById('status-local-sub');
  if (lVal) {
    const p = await isPersisted();
    const n = getWatches().length;
    lVal.textContent = n === 1 ? t('1 reloj en este dispositivo') : t('{n} relojes en este dispositivo', { n });
    lVal.style.color = 'var(--light)';
    lSub.textContent = p === true ? t('Protegidos: el sistema no los borrará para liberar espacio')
      : p === false ? t('El sistema podría borrarlos si falta espacio: activa la nube o haz copias')
      : t('Haz copias de vez en cuando');
    paintStatusIcon(document.getElementById('status-local-icon'), p === true ? 'ok' : 'gold');
  }

  // ── Cloud ──
  const on   = isCloudEnabled();
  const meta = getSyncMeta();
  const val  = document.getElementById('status-sync-val');
  const sub  = document.getElementById('status-sync-sub');
  const btn  = document.getElementById('status-sync-btn');
  const icon = document.getElementById('status-sync-icon');
  if (!val) return;
  if (btn) btn.hidden = !on;
  if (!on) {
    val.textContent = t('Desactivada'); val.style.color = 'var(--mid)';
    sub.textContent = t('Tus datos solo están en este dispositivo');
    paintStatusIcon(icon, 'off'); return;
  }
  if (meta.lastState === 'error') {
    val.textContent = t('No se pudo sincronizar'); val.style.color = 'var(--danger)';
    sub.textContent = meta.lastStateMsg || t('Revisa la conexión y toca ↻');
    paintStatusIcon(icon, 'warn');
  } else {
    val.textContent = meta.lastSyncAt ? t('Sincronizada {d}', { d: agoLabel(meta.lastSyncAt) }) : t('Pendiente de la primera subida');
    val.style.color = meta.lastSyncAt ? 'var(--ok)' : 'var(--mid)';
    sub.textContent = t('Se guarda sola tras cada cambio');
    paintStatusIcon(icon, meta.lastSyncAt ? 'ok' : 'off');
  }
  // Size in the cloud (async, best effort)
  try {
    const d = await cloudInfo();
    if (d.exists && meta.lastState !== 'error') {
      const kb = Math.round((d.sizeBytes || 0) / 1024);
      const size = kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB';
      const n = d.count === 1 ? t('1 reloj') : t('{n} relojes', { n: d.count || 0 });
      if (d.e2e) {
        sub.textContent = `${n} · ${size} · ${t('cifrada de extremo a extremo')}`;
      } else {
        const pct = Math.round((d.sizeBytes || 0) / d.limitBytes * 100);
        sub.textContent = `${n} · ${t('{s} de 3 MB', { s: size })}${pct > 80 ? ' · ' + t('cerca del límite') : ''} · ${t('se guarda sola')}`;
        if (pct > 80) sub.style.color = 'var(--danger)';
      }
    }
  } catch { /* offline */ }
}
/* ─── Cloud controls ─── */
export async function renderCloudControls() {
  const on     = isCloudEnabled();
  const meta   = getSyncMeta();
  const toggle = document.getElementById('cloud-toggle');
  const sub    = document.getElementById('cloud-toggle-sub');
  if (toggle) toggle.checked = on;
  const e2e = (await workerCaps()).v2;
  if (sub) sub.textContent = on
    ? (e2e ? t('Activada: tu colección y tu lista de deseos se cifran en este dispositivo antes de subir. Nadie más puede leerlas.')
           : t('Activada: tu colección y tu lista de deseos se guardan en Cloudflare y se sincronizan entre tus dispositivos'))
    : t('Desactivada: tus datos solo están en este dispositivo. Haz copias JSON de vez en cuando.');
  const show = (id, v) => { const el = document.getElementById(id); if (el) el.hidden = !v; };
  show('cloud-key-box', on);
  show('btn-link-device', on);
  show('btn-rotate-key', on);
  show('btn-delete-cloud', on || !!meta.lastPush);
  const keyEl = document.getElementById('cloud-key');
  if (keyEl) { keyEl.textContent = on ? getSessionId() : ''; keyEl.classList.toggle('long', on && !isShortKey(getSessionId())); }
  const warn = document.getElementById('cloud-key-warn');
  if (!warn) return;
  const msgs = [];
  if (on && !meta.keySavedAt) msgs.push(`<div><i class="ti ti-alert-triangle" aria-hidden="true"></i> ${t('Aún no has confirmado que la guardaste. Sin ella no podrás recuperar la copia si reinstalas.')} <button class="link-btn" data-action="openSaveKeySheet">${t('Guardarla ahora')}</button></div>`);
  if (on && !isShortKey(getSessionId()) && (await workerCaps()).shortKey)
    msgs.push(`<div><i class="ti ti-info-circle" aria-hidden="true"></i> ${t('Tu clave es del formato antiguo. «Cambiar llave» te da una de 16 caracteres, más fácil de teclear.')}</div>`);
  warn.innerHTML = msgs.join('');
  warn.hidden = !msgs.length;
}

/* ─── Preferences: language, theme and currency ─── */
export function renderPrefs() {
  const fill = (id, opts, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = opts.map(o => `<option value="${o.id}"${o.id === value ? ' selected' : ''}>${o.label}</option>`).join('');
  };
  fill('pref-lang', LANGS.map(o => ({ id: o.id, label: o.id === 'auto' ? t(o.label) : o.label })), prefs.lang);
  fill('pref-theme', THEMES.map(o => ({ id: o.id, label: t(o.label) })), prefs.theme);
  const names = (() => { try { return new Intl.DisplayNames([locale()], { type: 'currency' }); } catch { return null; } })();
  fill('pref-currency', CURRENCIES.map(c => ({ id: c, label: `${c} · ${names?.of(c) || c}` })), prefs.currency);
}
export function handlePrefChange(key, value) {
  setPref(key, value);
  if (key === 'lang') { location.reload(); return; }   // static texts are translated once, at start
  if (key === 'currency') {
    document.querySelectorAll('.f-cur').forEach(el => { el.textContent = currencySymbol(); });
    renderHome();
    showToast(t('Moneda: {c}. Los importes no se convierten.', { c: value }));
  }
}
