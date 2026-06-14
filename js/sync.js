/**
 * sync.js v4 — Per-user cloud sync with differential push
 *
 * Architecture:
 *   - Full push on first sync or after pull (data could have diverged)
 *   - Differential push on subsequent saves: only changed/new watches
 *   - Pull always merges cloud into local (cloud wins on conflict)
 *   - Photo hashes tracked to skip unchanged photos
 */

const SYNC_META_KEY = 'horlogerie_session_v1';
const SYNC_EL       = 'sync-status-indicator';

/* ════════════════════════════════════════
   SESSION ID
════════════════════════════════════════ */
function getSessionId() {
  const meta = getSyncMeta();
  if (meta.userId) return meta.userId;
  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
  setSyncMeta({ userId: id });
  return id;
}

function getSyncMeta() {
  try { return JSON.parse(localStorage.getItem(SYNC_META_KEY) || '{}'); } catch { return {}; }
}
function setSyncMeta(d) {
  localStorage.setItem(SYNC_META_KEY, JSON.stringify({ ...getSyncMeta(), ...d }));
}

/* ════════════════════════════════════════
   UI
════════════════════════════════════════ */
function setSyncUI(state, msg) {
  const el = document.getElementById(SYNC_EL);
  if (!el) return;
  const cfg = {
    syncing: { icon: 'ti-refresh',     color: 'var(--mid)',             spin: true  },
    ok:      { icon: 'ti-cloud-check', color: '#4CAF50',              spin: false },
    error:   { icon: 'ti-cloud-x',     color: 'rgba(220,80,80,0.8)',  spin: false },
    idle:    { icon: 'ti-cloud',       color: 'var(--mid)',             spin: false },
  }[state] || { icon: 'ti-cloud', color: 'var(--mid)', spin: false };
  el.innerHTML = `<i class="ti ${cfg.icon}" style="color:${cfg.color};font-size:18px;${cfg.spin ? 'animation:spin 1s linear infinite;' : ''}"></i>`;
  el.title = msg || '';
}

/* ════════════════════════════════════════
   HASH — lightweight fingerprint per watch
   Used to skip unchanged watches on push.
════════════════════════════════════════ */
async function hashWatch(w) {
  // Include all fields that could change (excluding photo — handled separately)
  const str = JSON.stringify({
    brand: w.brand, model: w.model, ref: w.ref, type: w.type,
    notes: w.notes, specs: w.specs, price: w.price,
    wearStart: w.wearStart, history: w.history,
  });
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('').slice(0, 16);
  } catch {
    // Fallback: simple string hash
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (Math.imul(31, h) + str.charCodeAt(i)) | 0; }
    return Math.abs(h).toString(16);
  }
}

async function hashPhoto(dataUrl) {
  if (!dataUrl) return null;
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(dataUrl.slice(0, 2000)));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('').slice(0, 16);
  } catch {
    return dataUrl.length.toString(16);
  }
}

/* ════════════════════════════════════════
   PUSH — differential
   Compares current state against last-pushed hashes.
   Sends only changed or new watches.
════════════════════════════════════════ */
async function syncPush(forceFull = false) {
  setSyncUI('syncing', 'Guardando en la nube…');
  try {
    const userId = getSessionId();
    const ws     = await getWatchesWithPhotos();

    // Load previously pushed hashes
    const meta        = getSyncMeta();
    const prevHashes  = meta.watchHashes || {};
    const prevPhotos  = meta.photoHashes || {};

    // Compute current hashes
    const currentHashes = {};
    const currentPhotos = {};
    for (const w of ws) {
      currentHashes[w.id] = await hashWatch(w);
      currentPhotos[w.id] = await hashPhoto(w.photo);
    }

    // Decide which watches to include
    let payload;
    const deletedIds = Object.keys(prevHashes).filter(id => !ws.find(w => w.id === id));

    if (forceFull || !meta.lastPush) {
      // First push or forced: send everything
      payload = { userId, watches: ws, mode: 'full', deletedIds };
    } else {
      // Differential: only changed watches
      const changed = ws.filter(w =>
        currentHashes[w.id] !== prevHashes[w.id] ||
        currentPhotos[w.id] !== prevPhotos[w.id]
      );

      if (changed.length === 0 && deletedIds.length === 0) {
        // Nothing changed
        setSyncUI('ok', `Al día · ${new Date(meta.lastPush).toLocaleTimeString('es-ES')}`);
        return true;
      }

      payload = { userId, watches: changed, mode: 'diff', deletedIds };
    }

    const res = await fetch(`${CONFIG.WORKER_URL}/sync/push`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    const data = await res.json();

    // Save current hashes for next differential comparison
    setSyncMeta({
      lastPush:    data.updatedAt,
      watchHashes: currentHashes,
      photoHashes: currentPhotos,
    });

    const label = data.mode === 'diff'
      ? `${data.changed} cambio(s)`
      : `${data.count} reloj(es)`;
    const sizeLabel = data.sizeBytes
      ? ` · ${(data.sizeBytes / 1024).toFixed(0)}KB`
      : '';
    setSyncUI('ok', `Guardado · ${label}${sizeLabel} · ${new Date(data.updatedAt).toLocaleTimeString('es-ES')}`);
    return true;

  } catch (e) {
    setSyncUI('error', e.message);
    console.warn('[sync] push failed:', e.message);
    return false;
  }
}

/* ════════════════════════════════════════
   PULL — always full (cloud is source of truth)
════════════════════════════════════════ */
async function syncPull(silent = false) {
  if (!silent) setSyncUI('syncing', 'Descargando…');
  try {
    const userId = getSessionId();
    const res    = await fetch(`${CONFIG.WORKER_URL}/sync/pull?userId=${encodeURIComponent(userId)}`);
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
      // After pull, force next push to be full (hashes invalidated)
      setSyncMeta({ lastPush: cloudTs, watchHashes: {}, photoHashes: {} });
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

/* ════════════════════════════════════════
   IMPORT SESSION
════════════════════════════════════════ */
async function importSession(userId) {
  setSyncUI('syncing', 'Verificando sesión…');
  try {
    const res  = await fetch(`${CONFIG.WORKER_URL}/sync/exists?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.exists) throw new Error('Sesión no encontrada. Comprueba el ID.');
    setSyncMeta({ userId, lastPush: 0, watchHashes: {}, photoHashes: {} });
    const pulled = await syncPull(false);
    if (pulled) { showToast('Sesión importada correctamente'); return true; }
    return false;
  } catch (e) {
    setSyncUI('error', e.message);
    showToast('Error: ' + e.message);
    return false;
  }
}

/* ════════════════════════════════════════
   AUTO — on app start
════════════════════════════════════════ */
async function syncAuto() {
  getSessionId(); // ensure UUID exists
  const pulled = await syncPull(true);
  if (pulled) {
    renderHome();
    if (typeof renderSettings === 'function') renderSettings();
  }
  setSyncUI('idle', 'Toca para sincronizar');
  // Set up debounced push for future changes
  let _t = null;
  window._debouncedPush = () => { clearTimeout(_t); _t = setTimeout(syncPush, 3000); };
}

/* ════════════════════════════════════════
   MANUAL
════════════════════════════════════════ */
async function syncManual() {
  setSyncUI('syncing', 'Sincronizando…');
  const pulled = await syncPull(false);
  if (pulled) { renderHome(); if (typeof renderSettings === 'function') renderSettings(); }
  await syncPush();
  showToast('Sincronización completada');
}

window.syncPush      = syncPush;
window.syncPull      = syncPull;
window.syncAuto      = syncAuto;
window.syncManual    = syncManual;
window.getSessionId  = getSessionId;
window.importSession = importSession;
