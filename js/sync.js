/**
 * sync.js v2 — Cloud sync via Cloudflare KV
 * Photos travel with the payload (base64 in KV value).
 * Uses restoreFromCloud() from storage.js to properly split meta/photos.
 */

const SYNC_META_KEY = 'horlogerie_sync_v2';
const SYNC_EL       = 'sync-status-indicator';

function getSyncMeta() {
  try { return JSON.parse(localStorage.getItem(SYNC_META_KEY) || '{}'); } catch { return {}; }
}
function setSyncMeta(d) {
  localStorage.setItem(SYNC_META_KEY, JSON.stringify({ ...getSyncMeta(), ...d }));
}

function setSyncUI(state, msg) {
  const el = document.getElementById(SYNC_EL);
  if (!el) return;
  const cfg = {
    syncing: { icon: 'ti-refresh',     color: 'var(--mid)',             spin: true  },
    ok:      { icon: 'ti-cloud-check', color: '#4CAF50',                spin: false },
    error:   { icon: 'ti-cloud-x',     color: 'rgba(220,80,80,0.8)',    spin: false },
    idle:    { icon: 'ti-cloud',       color: 'var(--mid)',             spin: false },
  }[state] || { icon: 'ti-cloud', color: 'var(--mid)', spin: false };
  el.innerHTML = `<i class="ti ${cfg.icon}" style="color:${cfg.color};font-size:18px;${cfg.spin ? 'animation:spin 1s linear infinite;' : ''}"></i>`;
  el.title = msg || '';
}

/* ── PUSH ── */
async function syncPush() {
  setSyncUI('syncing', 'Guardando en la nube…');
  try {
    const ws  = await getWatchesWithPhotos();
    const res = await fetch(`${CONFIG.WORKER_URL}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watches: ws })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const data = await res.json();
    setSyncMeta({ lastPush: data.updatedAt });
    setSyncUI('ok', `Sincronizado · ${new Date(data.updatedAt).toLocaleTimeString('es-ES')}`);
    return true;
  } catch (e) {
    setSyncUI('error', e.message);
    console.warn('[sync] push failed:', e.message);
    return false;
  }
}

/* ── PULL ── */
async function syncPull(silent = false) {
  if (!silent) setSyncUI('syncing', 'Descargando…');
  try {
    const res = await fetch(`${CONFIG.WORKER_URL}/sync/pull`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.watches?.length) {
      setSyncUI('idle', 'Sin datos en la nube');
      return false;
    }

    const localTs = getSyncMeta().lastPush || 0;
    const cloudTs = data.updatedAt         || 0;

    if (cloudTs > localTs) {
      await restoreFromCloud(data.watches);
      setSyncMeta({ lastPush: cloudTs });
      setSyncUI('ok', `Actualizado · ${new Date(cloudTs).toLocaleTimeString('es-ES')}`);
      if (!silent) showToast('Colección sincronizada desde la nube');
      return true;
    }
    setSyncUI('ok', 'Ya estás al día');
    return false;
  } catch (e) {
    if (!silent) setSyncUI('error', e.message);
    console.warn('[sync] pull failed:', e.message);
    return false;
  }
}

/* ── AUTO (on app start) ── */
async function syncAuto() {
  const pulled = await syncPull(true);
  if (pulled) { renderHome(); if (typeof renderSettings === 'function') renderSettings(); }
  setSyncUI('idle', 'Toca para sincronizar');

  // Debounced push: 3s after last save
  let _t = null;
  window._debouncedPush = () => { clearTimeout(_t); _t = setTimeout(syncPush, 3000); };
}

/* ── MANUAL ── */
async function syncManual() {
  setSyncUI('syncing', 'Sincronizando…');
  const pulled = await syncPull(false);
  if (pulled) { renderHome(); if (typeof renderSettings === 'function') renderSettings(); }
  await syncPush();
  showToast('Sincronización completada');
}

window.syncPush   = syncPush;
window.syncPull   = syncPull;
window.syncAuto   = syncAuto;
window.syncManual = syncManual;
