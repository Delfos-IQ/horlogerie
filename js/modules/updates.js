const APP_VERSION = '2.1.0'; // Must match version.json

async function initVersionCheck() {
  // Populate all version display elements
  const vEl  = document.getElementById('app-version-display');
  const vEl2 = document.getElementById('app-version-display2');
  if (vEl)  vEl.textContent  = APP_VERSION;
  if (vEl2) vEl2.textContent = APP_VERSION;

  // Silent check on every launch — fetch version.json bypassing cache
  try {
    const res = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const dEl = document.getElementById('app-version-date');
    if (dEl && data.date) dEl.textContent = `Publicada el ${data.date}`;
    if (data.version && data.version !== APP_VERSION) {
      showUpdateBanner(data.version, data.notes);
      // Also highlight the top button in settings
      const topBtn = document.getElementById('update-top-btn');
      const topSub = document.getElementById('update-top-sub');
      if (topBtn) topBtn.style.borderColor = '#4CAF50';
      if (topSub) topSub.innerHTML = `<span style="color:#4CAF50;font-weight:500;">⬆ Nueva versión ${data.version} disponible</span>`;
    }
  } catch { /* Offline — skip */ }
}

function showUpdateBanner(newVersion, notes) {
  // Show a persistent banner at top of screen
  const existing = document.getElementById('update-banner');
  if (existing) return;

  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
    background: var(--gold); color: var(--dark);
    padding: calc(env(safe-area-inset-top, 0px) + 10px) 16px 12px;
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; font-family: var(--font-body); font-size: 13px;
    font-weight: 500; cursor: pointer; box-shadow: 0 2px 12px rgba(0,0,0,0.3);
  `;
  banner.innerHTML = `
    <div>
      <span>⬆️ Nueva versión ${newVersion} disponible</span>
      ${notes ? `<div style="font-size:11px;font-weight:400;opacity:0.8;margin-top:2px;">${escHtml(notes)}</div>` : ''}
    </div>
    <button style="background:var(--dark);color:var(--gold);border:none;border-radius:8px;
      padding:7px 14px;font-family:var(--font-body);font-size:12px;font-weight:600;cursor:pointer;
      white-space:nowrap;" onclick="applyUpdate()">Actualizar</button>
  `;
  document.body.appendChild(banner);
}

async function checkForUpdate() {
  // Update both the header icon and the settings button
  const headerIcon = document.getElementById('update-btn-icon');
  const btn        = document.getElementById('check-update-btn');
  const status     = document.getElementById('update-status');

  // Spinning animation on header icon
  if (headerIcon) headerIcon.style.animation = 'spin 1s linear infinite';
  if (btn)    { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span> Comprobando…'; }
  if (status) { status.textContent = ''; }

  try {
    const res = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('No se pudo conectar');
    const data = await res.json();

    const vEl = document.getElementById('app-version-display');
    const dEl = document.getElementById('app-version-date');
    if (vEl) vEl.textContent = data.version || APP_VERSION;
    if (dEl && data.date) dEl.textContent = `Publicada el ${data.date}`;

    if (data.version && data.version !== APP_VERSION) {
      // New version — show gold icon + toast
      if (headerIcon) {
        headerIcon.style.animation = '';
        headerIcon.style.color = 'var(--gold)';
        headerIcon.className = 'ti ti-arrow-bar-to-down';
      }
      if (status) {
        status.style.color = '#4CAF50';
        status.innerHTML = `⬆️ Nueva versión <strong>${data.version}</strong> — actualizando…`;
      }
      showToast(`Nueva versión ${data.version} disponible. Instalando…`, 3000);
      setTimeout(() => applyUpdate(), 1500);
    } else {
      // Already up to date
      if (headerIcon) {
        headerIcon.style.animation = '';
        headerIcon.style.color = '#4CAF50';
        setTimeout(() => {
          if (headerIcon) { headerIcon.style.color = 'var(--mid)'; }
        }, 2000);
      }
      if (status) { status.style.color = '#4CAF50'; status.textContent = '✓ Ya tienes la versión más reciente'; }
      showToast('✓ App al día — versión ' + APP_VERSION);
    }
  } catch (e) {
    if (headerIcon) { headerIcon.style.animation = ''; headerIcon.style.color = 'rgba(220,80,80,0.8)'; }
    if (status) { status.style.color = 'rgba(220,80,80,0.8)'; status.textContent = 'Sin conexión'; }
    showToast('Sin conexión — no se pudo comprobar');
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-refresh"></i> Buscar actualización'; }
}

async function applyUpdate() {
  showToast('Reinstalando… la app se reiniciará');
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch(e) {}
  setTimeout(() => window.location.reload(true), 300);
}
window.applyUpdate    = applyUpdate;
window.checkForUpdate = checkForUpdate;

/* ══════════════════════════════════════════════════════
   URL IMPORT — wishlist
   Sends URL to Cloudflare Worker → compound-beta reads
   Amazon/AliExpress/etc → fills wishlist form fields
══════════════════════════════════════════════════════ */
