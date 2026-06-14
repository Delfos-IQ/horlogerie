/* ─── SETTINGS ─── */
function renderSettings() {
  const ws   = getWatches();
  const grid = document.getElementById('settings-stats');
  if (!grid) return;
  const autoCount = ws.filter(w=>w.type==='automatic').length;
  const qtzCount  = ws.filter(w=>w.type==='quartz').length;
  const manCount  = ws.filter(w=>w.type==='manual').length;
  const totalSess = ws.reduce((a,w) => a + (w.history?.length||0) + (w.wearStart?1:0), 0);
  let totalDays=0, mostUsedWatch=null, mostUsedDays=0;
  const gapDays=[];
  ws.forEach(w => {
    const all = [...(w.history||[])];
    if (w.wearStart) all.push({start:w.wearStart,end:Date.now()});
    const wDays = all.reduce((s,i)=>s+durationDays(i.start,i.end||Date.now()),0);
    totalDays += wDays;
    if (wDays > mostUsedDays) { mostUsedDays = wDays; mostUsedWatch = w; }
    if (all.length > 1) {
      const sorted = [...all].sort((a,b)=>a.start-b.start);
      for (let i=1;i<sorted.length;i++) {
        const gap = Math.round((sorted[i].start - (sorted[i-1].end||Date.now()))/86400000);
        if (gap >= 0) gapDays.push(gap);
      }
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
  if (avgGap!==null) rows.push({l:'Media días entre usos',v:`${avgGap} días`});
  if (ws.length) rows.push({l:'Media días por reloj',v:`${Math.round(totalDays/ws.length)}d`});
  advEl.innerHTML = rows.map(r=>`
    <div class="interval-row" style="margin-bottom:6px;">
      <div class="interval-dates" style="color:var(--mid);font-size:12px;">${r.l}</div>
      <div class="interval-duration" style="color:var(--light);font-weight:500;">${r.v}</div>
    </div>`).join('');

  // Render session ID in settings
  renderSessionId();
  loadCloudSize(); // async — updates size bar when ready
}

async function handleExportPDF() {
  if (!getWatches().length) { showToast('No hay relojes'); return; }
  try { await generateCollectionPDF(); } catch(e) { showToast('Error PDF: '+e.message); }
}

function handleExportJSON() {
  const ws = getWatches();
  if (!ws.length) { showToast('No hay datos'); return; }
  const blob = new Blob([JSON.stringify({version:2,exported:Date.now(),watches:ws},null,2)],{type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download=`horlogerie-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
  URL.revokeObjectURL(url);
  showToast('Copia de seguridad descargada');
}

function handleImportJSON() { document.getElementById('import-json-input').click(); }

function processImportJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      const incoming = data.watches || (Array.isArray(data) ? data : null);
      if (!incoming) throw new Error('Formato no reconocido');
      showConfirm('Restaurar copia de seguridad',
        `Se importarán ${incoming.length} relojes. Los datos actuales se conservarán.`, async () => {
          const existingIds = new Set(getWatches().map(w=>w.id));
          let added = 0;
          for (const w of incoming) {
            if (!existingIds.has(w.id)) { watches.push(w); added++; }
          }
          save();
          showToast(`${added} relojes importados`);
          renderHome(); renderSettings();
        });
    } catch(err) { showToast('Error: '+err.message); }
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
window.syncManual          = syncManual;
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
    const userId = getSessionId();
    const res    = await fetch(`${CONFIG.WORKER_URL}/sync/size?userId=${encodeURIComponent(userId)}`);
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
