/* ─── SETTINGS ─── */
function renderSettings() {
  const ws   = getWatches();
  const grid = document.getElementById('settings-stats');
  if (!grid) return;
  const autoCount = ws.filter(w=>w.type==='automatic').length;
  const qtzCount  = ws.filter(w=>w.type==='quartz').length;
  const manCount  = ws.filter(w=>w.type==='manual').length;
  const now = Date.now();
  let totalDays = 0, totalSess = 0, mostUsedWatch = null, mostUsedDays = 0, used30 = 0;
  const gapDays = [];
  const cut30 = dayKey(now - 29 * 86400000);
  ws.forEach(w => {
    const st = wearStats(w, now);
    totalDays += st.daysWorn;
    totalSess += st.sessions;
    if (st.daysWorn > mostUsedDays) { mostUsedDays = st.daysWorn; mostUsedWatch = w; }
    const keys = [...wornDayKeys(w, now)].sort();
    if (keys.length && keys[keys.length - 1] >= cut30) used30++;
    for (let i = 1; i < keys.length; i++) {
      const g = calendarDaysBetween(new Date(keys[i - 1] + 'T12:00').getTime(), new Date(keys[i] + 'T12:00').getTime());
      if (g > 1) gapDays.push(g - 1);   // days in the box between two wears
    }
  });
  const avgGap = gapDays.length ? Math.round(gapDays.reduce((a,b)=>a+b,0)/gapDays.length) : null;
  const stats = [
    {v:ws.length,l:'Relojes'},{v:autoCount,l:'Automáticos'},{v:qtzCount,l:'Cuarzo'},
    {v:manCount,l:'Manual'},{v:totalSess,l:'Sesiones'},{v:totalDays,l:'Días uso'},
  ];
  grid.innerHTML = stats.map(s=>`
    <div class="settings-stat-card">
      <div class="settings-stat-val">${s.v}</div>
      <div class="settings-stat-label">${s.l}</div>
    </div>`).join('');
  const advEl = document.getElementById('settings-advanced-stats');
  if (!advEl) return;
  const rows=[];
  if (mostUsedWatch) rows.push({l:'Reloj más usado',v:`${mostUsedWatch.brand} ${mostUsedWatch.model} · ${mostUsedDays}d`});
  if (avgGap!==null) rows.push({l:'Media de días en la caja entre usos',v:`${avgGap} días`});
  if (ws.length) rows.push({l:'Media días por reloj',v:`${Math.round(totalDays/ws.length)}d`});
  if (ws.length) rows.push({l:'Rotación (últimos 30 días)',v:`${used30} de ${ws.length} relojes`});
  const alerts = ws.flatMap(w => maintenanceAlerts(w, now).map(a => `${w.brand} ${w.model}`));
  if (alerts.length) rows.push({l:'Mantenimiento pendiente',v:`${alerts.length}: ${alerts.slice(0,2).join(', ')}${alerts.length > 2 ? '…' : ''}`});
  advEl.innerHTML = rows.map(r=>`
    <div class="interval-row" style="margin-bottom:6px;">
      <div class="interval-dates" style="color:var(--mid);font-size:12px;">${r.l}</div>
      <div class="interval-duration" style="color:var(--light);font-weight:500;">${escHtml(r.v)}</div>
    </div>`).join('');

  // Render session ID and cloud controls
  renderSessionId();
  renderCloudControls();
  renderSystemStatus();   // fills version + session + sync status panel
  loadCloudSize();         // async — updates cloud size bar
}

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

loadPhotos().then(() => { renderHome(); updateFab('home'); });
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

/* ══════════════════════════════════════════════════════
   WISHLIST
══════════════════════════════════════════════════════ */

let _wlEditingId = null;


/* ─── Cloud storage size indicator ─── */
async function loadCloudSize() {
  const textEl = document.getElementById('cloud-size-text');
  const fillEl = document.getElementById('cloud-size-fill');
  if (!textEl || !fillEl) return;

  try {
    if (!isCloudEnabled()) { textEl.textContent = 'Copia en la nube desactivada'; fillEl.style.width = '0%'; return; }
    const res    = await syncApi('/sync/size');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    if (!data.exists || !data.sizeBytes) {
      textEl.textContent = 'Sin datos en la nube todavía';
      fillEl.style.width = '0%';
      return;
    }

    const kb      = (data.sizeBytes / 1024).toFixed(0);
    const mb      = (data.sizeBytes / 1024 / 1024).toFixed(2);
    const maxMB   = 3;  // MAX_SYNC_PAYLOAD in worker
    const pct     = Math.min(100, (data.sizeBytes / (maxMB * 1024 * 1024)) * 100);

    textEl.textContent = `${kb}KB en la nube · ${data.count} relojes`;

    // Color the bar based on usage
    const color = pct > 80 ? '#e57373' : pct > 50 ? '#D4AF6A' : 'var(--gold)';
    fillEl.style.width      = pct + '%';
    fillEl.style.background = color;

    if (pct > 80) {
      textEl.style.color = '#e57373';
      textEl.textContent += ' · ⚠️ cerca del límite';
    }
  } catch {
    const textEl2 = document.getElementById('cloud-size-text');
    if (textEl2) textEl2.textContent = 'Sin conexión';
  }
}

window.loadCloudSize = loadCloudSize;

/* ─── System status panel ─── */
async function renderSystemStatus() {
  // ── Version row ──
  const versionVal  = document.getElementById('status-version-val');
  const versionIcon = document.getElementById('status-version-icon');
  const versionBtn  = document.getElementById('update-top-btn');

  if (versionVal) {
    try {
      const res  = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
      const data = await res.json();
      const serverVersion = data.version || APP_VERSION;
      const isUpToDate    = serverVersion === APP_VERSION;

      versionVal.textContent = isUpToDate
        ? `v${APP_VERSION} · Al día ✓`
        : `v${APP_VERSION} → v${serverVersion} disponible`;
      versionVal.style.color = isUpToDate ? '#4CAF50' : '#D4AF6A';

      if (versionIcon) {
        versionIcon.style.color     = isUpToDate ? '#4CAF50' : '#D4AF6A';
        versionIcon.style.background = isUpToDate
          ? 'rgba(76,175,80,0.12)' : 'rgba(212,175,106,0.12)';
      }
      if (!isUpToDate && versionBtn) {
        versionBtn.style.color       = '#D4AF6A';
        versionBtn.style.borderColor = 'rgba(212,175,106,0.4)';
      }
    } catch {
      if (versionVal) {
        versionVal.textContent = `v${APP_VERSION}`;
        versionVal.style.color = 'var(--light)';
      }
    }
  }

  // ── Session row ──
  const sessionSub  = document.getElementById('status-session-sub');
  const sessionIcon = document.getElementById('status-session-icon');
  const sessionId   = getSessionId();

  // Check if cloud has data for this session
  try {
    if (!isCloudEnabled()) {
      if (sessionSub) { sessionSub.textContent = 'Copia en la nube desactivada · tus datos solo están en este dispositivo'; sessionSub.style.color = 'var(--mid)'; }
      if (sessionIcon) { sessionIcon.style.color = 'var(--mid)'; sessionIcon.style.background = 'var(--dark3)'; }
      throw 'off';
    }
    const res  = await syncApi('/sync/exists');
    const data = await res.json();

    if (sessionIcon) {
      sessionIcon.style.color      = data.exists ? '#4CAF50' : 'var(--mid)';
      sessionIcon.style.background = data.exists
        ? 'rgba(76,175,80,0.12)' : 'var(--dark3)';
    }
    if (sessionSub) {
      sessionSub.textContent = data.exists
        ? `${data.count} relojes en la nube · Misma sesión en todos tus dispositivos`
        : 'Sin datos en la nube todavía — sincroniza para activar multi-dispositivo';
      sessionSub.style.color = data.exists ? '#4CAF50' : 'var(--mid)';
    }
  } catch (e) {
    if (e !== 'off' && sessionSub) sessionSub.textContent = 'Sin conexión';
  }

  // ── Sync row ──
  const syncVal  = document.getElementById('status-sync-val');
  const syncSub  = document.getElementById('status-sync-sub');
  const syncIcon = document.getElementById('status-sync-icon');
  const meta     = getSyncMeta ? getSyncMeta() : {};
  const lastPush = meta.lastPush;

  if (syncVal) {
    if (!lastPush) {
      syncVal.textContent  = 'Nunca sincronizado';
      syncVal.style.color  = 'var(--mid)';
    } else {
      const mins = Math.round((Date.now() - lastPush) / 60000);
      const when = mins < 1 ? 'hace un momento'
        : mins < 60 ? `hace ${mins} min`
        : mins < 1440 ? `hace ${Math.round(mins/60)}h`
        : `hace ${Math.round(mins/1440)} días`;
      syncVal.textContent = `Última sync: ${when}`;
      syncVal.style.color = mins < 60 ? '#4CAF50' : mins < 1440 ? '#D4AF6A' : 'var(--mid)';
      if (syncIcon) {
        syncIcon.style.color      = mins < 60 ? '#4CAF50' : '#D4AF6A';
        syncIcon.style.background = mins < 60
          ? 'rgba(76,175,80,0.12)' : 'rgba(212,175,106,0.12)';
      }
    }
  }
  if (syncSub) {
    syncSub.textContent = isCloudEnabled() ? 'Toca ↻ para sincronizar ahora' : 'Actívala en «Copia en la nube»';
  }
}

window.renderSystemStatus = renderSystemStatus;

/* ─── Cloud controls ─── */
function renderCloudControls() {
  const on     = isCloudEnabled();
  const toggle = document.getElementById('cloud-toggle');
  const sub    = document.getElementById('cloud-toggle-sub');
  if (toggle) toggle.checked = on;
  if (sub) sub.textContent = on
    ? 'Activada: tu colección y tu lista de deseos se guardan en Cloudflare y se sincronizan entre tus dispositivos'
    : 'Desactivada: tus datos solo están en este dispositivo. Haz copias JSON de vez en cuando.';
  const hadCloud = !!getSyncMeta().lastPush;
  const show = (id, v) => { const el = document.getElementById(id); if (el) el.hidden = !v; };
  show('btn-rotate-key', on);
  show('btn-delete-cloud', on || hadCloud);
  const qrBtn = document.querySelector('#cloud-actions [onclick="showQR()"]');
  if (qrBtn) qrBtn.hidden = !on;
}
window.renderCloudControls = renderCloudControls;
