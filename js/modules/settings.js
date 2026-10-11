/* ─── SETTINGS ─── */
function renderSettings() {
  renderCloudControls();
  renderSystemStatus();
  renderBackupInfo();
}

/* ─── JSON backup: when was the last one ─── */
const BACKUP_KEY = 'horlogerie_last_backup';
function lastBackupAt() { try { return Number(localStorage.getItem(BACKUP_KEY)) || 0; } catch { return 0; } }
function daysAgoLabel(ts) {
  const d = Math.floor((Date.now() - ts) / 86400000);
  return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`;
}
function renderBackupInfo() {
  const el = document.getElementById('backup-card-sub');
  if (!el) return;
  const t = lastBackupAt();
  el.textContent = t ? `Última copia: ${daysAgoLabel(t)} · relojes, fotos, historial y deseos`
                     : 'Relojes, fotos, historial y lista de deseos en un archivo';
}

/**
 * Discreet reminder on Colección when the cloud is off and there is no recent
 * JSON copy (30 days). Not shown during the first week or if dismissed.
 */
function renderBackupReminder() {
  const el = document.getElementById('backup-reminder');
  if (!el) return;
  if (window.storageRecovered?.length && !window._recoveryDismissed) {
    el.innerHTML = `<div class="backup-reminder" role="alert">
        <i class="ti ti-shield-exclamation" aria-hidden="true"></i>
        <span>Parte de los datos guardados en este móvil no se podía leer. Se ha apartado una copia sin tocarla. Recupera tu colección con tu clave (Ajustes → Usar una clave o código) o con una copia JSON.</span>
        <button class="br-x" id="br-x" aria-label="Cerrar aviso"><i class="ti ti-x" aria-hidden="true"></i></button>
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
      <span>${last ? `Tu última copia es de ${daysAgoLabel(last)}.` : 'Aún no tienes copia de tu colección.'} Si cambias de móvil, la necesitarás.</span>
      <button class="br-do" id="br-do">Hacer copia</button>
      <button class="br-x" id="br-x" aria-label="Recordármelo dentro de un mes"><i class="ti ti-x" aria-hidden="true"></i></button>
    </div>`;
  el.querySelector('#br-do').addEventListener('click', () => handleExportJSON());
  el.querySelector('#br-x').addEventListener('click', () => {
    try { localStorage.setItem(BACKUP_KEY + '_snooze', String(Date.now())); } catch {}
    el.innerHTML = '';
  });
}
window.renderBackupReminder = renderBackupReminder;

async function handleExportPDF() {
  if (!getWatches().length) { showToast('No hay relojes'); return; }
  try { await generateCollectionPDF(); } catch(e) { showToast('Error PDF: '+e.message); }
}

async function handleExportJSON() {
  if (!getWatches().length && !getWishlist().length) { showToast('No hay datos'); return; }
  const backup = await buildBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `rotor-copia-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Copia descargada · ${backup.watches.length} relojes, ${backup.wishlist.length} deseos`);
  try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch {}
  renderBackupInfo(); renderBackupReminder();
}

function handleImportJSON() { document.getElementById('import-json-input').click(); }

function processImportJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    let data;
    try { data = JSON.parse(ev.target.result); }
    catch { showToast('El archivo no es un JSON válido'); e.target.value = ''; return; }
    const nW  = Array.isArray(data) ? data.length : (data?.watches?.length || 0);
    const nWl = Array.isArray(data?.wishlist) ? data.wishlist.length : 0;
    if (!nW && !nWl) { showToast('No encuentro relojes en ese archivo'); e.target.value = ''; return; }
    showConfirm('Restaurar copia de seguridad',
      `El archivo tiene ${nW} relojes${nWl ? ` y ${nWl} deseos` : ''}. Se combinarán con lo que ya tienes: si un reloj está en los dos sitios, se queda la versión modificada más recientemente. No se borra nada.`,
      async () => {
        try {
          const r = await importBackup(data);
          const msg = `Restaurado · ${r.total} relojes revisados` +
            (r.totalWishlist ? `, ${r.totalWishlist} deseos` : '') +
            (r.rejected ? ` · ${r.rejected} entradas no válidas ignoradas` : '');
          showToast(msg, 4000);
          renderHome(); renderSettings();
          if (typeof renderWishlist === 'function') renderWishlist();
        } catch (err) { showToast('Error al restaurar: ' + err.message); }
      },
      { okLabel: 'Restaurar', danger: false });
    e.target.value = '';
  };
  reader.readAsText(file);
}

/* ─── Init ─── */
setTimeout(() => {
  document.getElementById('intro').classList.add('fade');
  setTimeout(() => document.getElementById('intro').style.display = 'none', 600);
}, 1600);

loadPhotos().then(() => {
  renderHome(); updateFab('home');
  if (getWatches().length) requestPersistence();
});
// Check for updates silently on every launch
window.addEventListener('load', () => setTimeout(initVersionCheck, 2000));

/* ─── Expose globals ─── */
window.showView            = showView;
window.updateFab           = updateFab;
window.openAddModal        = openAddModal;
window.closeAddModal       = closeAddModal;
window.closeModalIfOutside = closeModalIfOutside;
window.openDetail          = openDetail;
window.handlePhotoUpload   = handlePhotoUpload;
window.openPhotoSheet      = openPhotoSheet;
window.closePhotoSheet     = closePhotoSheet;
window.closePhotoSheetIfOutside = closePhotoSheetIfOutside;
window.choosePhotoSource   = choosePhotoSource;
window.saveWatch           = saveWatch;
window.openEditModal       = openEditModal;
window.handleExportPDF     = handleExportPDF;
window.handleExportJSON    = handleExportJSON;
window.handleImportJSON    = handleImportJSON;
window.processImportJSON   = processImportJSON;
window.handleDbSearch      = handleDbSearch;
window.renderSettings      = renderSettings;



/* ─── System status panel ─── */
function agoLabel(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  return mins < 1 ? 'hace un momento' : mins < 60 ? `hace ${mins} min`
    : mins < 1440 ? `hace ${Math.round(mins / 60)} h` : `hace ${Math.round(mins / 1440)} días`;
}
function fmtDateEs(iso) {
  const d = new Date(iso + 'T12:00');
  return isNaN(d) ? iso : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}
function paintStatusIcon(el, tone) {
  if (!el) return;
  const c = { ok: 'var(--ok)', gold: 'var(--gold-light)', warn: 'var(--danger)', off: 'var(--mid)' }[tone];
  el.style.color = c;
  el.style.background = tone === 'off' ? 'var(--dark3)' : `color-mix(in srgb, ${c} 12%, transparent)`;
}

async function renderSystemStatus() {
  // ── Version ──
  const vVal = document.getElementById('status-version-val');
  const vSub = document.getElementById('status-version-sub');
  if (vVal && !vVal.dataset.busy) {
    try {
      const res  = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
      const data = await res.json();
      const upToDate = (data.version || APP_VERSION) === APP_VERSION;
      vVal.textContent = upToDate ? `v${APP_VERSION} · al día` : `v${APP_VERSION} → v${data.version} disponible`;
      vVal.style.color = upToDate ? 'var(--ok)' : 'var(--gold-light)';
      if (vSub) vSub.textContent = data.date
        ? (upToDate ? `Publicada el ${fmtDateEs(data.date)}` : `Nueva del ${fmtDateEs(data.date)}${data.notes ? ': ' + data.notes : ''}`) : '';
      paintStatusIcon(document.getElementById('status-version-icon'), upToDate ? 'ok' : 'gold');
    } catch {
      vVal.textContent = `v${APP_VERSION}`; vVal.style.color = 'var(--light)';
      if (vSub) vSub.textContent = 'Sin conexión para comprobar';
    }
  }

  // ── Data on this device ──
  const lVal = document.getElementById('status-local-val');
  const lSub = document.getElementById('status-local-sub');
  if (lVal) {
    const p = await isPersisted();
    const n = getWatches().length;
    lVal.textContent = `${n} ${n === 1 ? 'reloj' : 'relojes'} en este dispositivo`;
    lVal.style.color = 'var(--light)';
    lSub.textContent = p === true ? 'Protegidos: el sistema no los borrará para liberar espacio'
      : p === false ? 'El sistema podría borrarlos si falta espacio: activa la nube o haz copias'
      : 'Haz copias de vez en cuando';
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
    val.textContent = 'Desactivada'; val.style.color = 'var(--mid)';
    sub.textContent = 'Tus datos solo están en este dispositivo';
    paintStatusIcon(icon, 'off'); return;
  }
  if (meta.lastState === 'error') {
    val.textContent = 'No se pudo sincronizar'; val.style.color = 'var(--danger)';
    sub.textContent = meta.lastStateMsg || 'Revisa la conexión y toca ↻';
    paintStatusIcon(icon, 'warn');
  } else {
    val.textContent = meta.lastSyncAt ? `Sincronizada ${agoLabel(meta.lastSyncAt)}` : 'Pendiente de la primera subida';
    val.style.color = meta.lastSyncAt ? 'var(--ok)' : 'var(--mid)';
    sub.textContent = 'Se guarda sola tras cada cambio';
    paintStatusIcon(icon, meta.lastSyncAt ? 'ok' : 'off');
  }
  // Size in the cloud (async, best effort)
  try {
    const res = await syncApi('/sync/size');
    const d = res.ok ? await res.json() : null;
    if (d?.exists && d.sizeBytes && meta.lastState !== 'error') {
      const kb = Math.round(d.sizeBytes / 1024);
      const pct = Math.round(d.sizeBytes / (3 * 1024 * 1024) * 100);
      sub.textContent = `${d.count} ${d.count === 1 ? 'reloj' : 'relojes'} · ${kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'} de 3 MB${pct > 80 ? ' · cerca del límite' : ''} · se guarda sola`;
      if (pct > 80) sub.style.color = 'var(--danger)';
    }
  } catch { /* offline */ }
}
window.renderSystemStatus = renderSystemStatus;

/* ─── Cloud controls ─── */
async function renderCloudControls() {
  const on     = isCloudEnabled();
  const meta   = getSyncMeta();
  const toggle = document.getElementById('cloud-toggle');
  const sub    = document.getElementById('cloud-toggle-sub');
  if (toggle) toggle.checked = on;
  if (sub) sub.textContent = on
    ? 'Activada: tu colección y tu lista de deseos se guardan en Cloudflare y se sincronizan entre tus dispositivos'
    : 'Desactivada: tus datos solo están en este dispositivo. Haz copias JSON de vez en cuando.';
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
  if (on && !meta.keySavedAt) msgs.push(`<div><i class="ti ti-alert-triangle" aria-hidden="true"></i> Aún no has confirmado que la guardaste. Sin ella no podrás recuperar la copia si reinstalas. <button class="link-btn" onclick="openSaveKeySheet()">Guardarla ahora</button></div>`);
  if (on && !isShortKey(getSessionId()) && (await workerCaps()).shortKey)
    msgs.push(`<div><i class="ti ti-info-circle" aria-hidden="true"></i> Tu clave es del formato antiguo. «Cambiar llave» te da una de 16 caracteres, más fácil de teclear.</div>`);
  warn.innerHTML = msgs.join('');
  warn.hidden = !msgs.length;
}
window.renderCloudControls = renderCloudControls;
