/* ══════════════════════════════════════════════════════
   SESSION MANAGEMENT
   Each user has a UUID stored in localStorage.
   They can share it to sync across devices.
══════════════════════════════════════════════════════ */

function renderSessionId() {
  const el = document.getElementById('session-id-display');
  if (!el) return;
  const id = getSessionId();
  // Show truncated for display, full on copy
  el.textContent = id;
  el.title = id;
}

function copySessionId() {
  const id = getSessionId();
  navigator.clipboard.writeText(id)
    .then(() => showToast('ID copiado al portapapeles'))
    .catch(() => {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = id;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('ID copiado');
    });
}

function showQR() {
  const id    = getSessionId();
  const modal = document.getElementById('qr-modal');
  if (!modal) return;
  document.getElementById('qr-session-id').textContent = id;

  // Generated on the device: the id is a secret and must never reach a third party
  const container = document.getElementById('qr-container');
  if (container) {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(id);
      qr.make();
      container.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 12, scalable: true,
        alt: 'Código QR con tu ID de sesión' });
      const svg = container.querySelector('svg');
      if (svg) { svg.setAttribute('width', '200'); svg.setAttribute('height', '200'); svg.style.borderRadius = '10px'; }
    } catch {
      container.textContent = 'No se pudo generar el QR. Copia el ID con el botón de copiar.';
    }
  }

  modal.style.display = 'flex';
}

/* ─── Cloud copy controls (Ajustes) ─── */
async function handleCloudToggle(on) {
  const input = document.getElementById('cloud-toggle');
  if (input) input.disabled = true;
  try {
    await setCloudEnabled(on);
    showToast(on ? 'Copia en la nube activada' : 'Copia en la nube desactivada. Lo que ya estaba en la nube sigue ahí.');
    renderHome();
    if (typeof renderWishlist === 'function') renderWishlist();
  } finally {
    if (input) input.disabled = false;
    renderSettings();
  }
}

function handleRotateKey() {
  showConfirm(
    '¿Cambiar la llave?',
    'Se creará un ID de sesión nuevo y se borrará la copia guardada con el ID actual. En tus otros dispositivos tendrás que volver a importar la sesión con el ID nuevo.',
    async () => {
      try {
        await rotateSessionKey();
        showToast('Llave cambiada. Usa el ID nuevo en tus otros dispositivos.');
      } catch (e) { showToast('No se pudo cambiar la llave: ' + e.message); }
      renderSettings();
    },
    { okLabel: 'Cambiar llave', danger: false }
  );
}

function handleDeleteCloud() {
  showConfirm(
    '¿Borrar tus datos de la nube?',
    'Se borrará la copia de tu colección y tu lista de deseos guardada en la nube, y la copia en la nube quedará desactivada. Lo que hay en este dispositivo no se toca.',
    async () => {
      try {
        await deleteCloudData();
        showToast('Datos borrados de la nube');
      } catch (e) { showToast('No se pudo borrar: ' + e.message); }
      renderSettings();
    },
    { okLabel: 'Borrar de la nube' }
  );
}

window.handleCloudToggle = handleCloudToggle;
window.handleRotateKey   = handleRotateKey;
window.handleDeleteCloud = handleDeleteCloud;

function closeQR() {
  const modal = document.getElementById('qr-modal');
  if (modal) modal.style.display = 'none';
}

function openImportSession() {
  const modal = document.getElementById('import-session-modal');
  if (!modal) return;
  document.getElementById('import-session-input').value = '';
  document.getElementById('import-session-status').textContent = '';
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('import-session-input').focus(), 100);
}

function closeImportSession() {
  const modal = document.getElementById('import-session-modal');
  if (modal) modal.style.display = 'none';
}

async function handleImportSession() {
  const input = document.getElementById('import-session-input').value.trim();
  const status = document.getElementById('import-session-status');

  if (!input) { status.textContent = 'Introduce un ID de sesión'; status.style.color = 'var(--danger)'; return; }

  // Basic UUID format validation
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(input)) {
    status.textContent = 'Formato de ID incorrecto. Debe ser: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
    status.style.color = 'var(--danger)'; return;
  }

  if (input === getSessionId()) {
    status.textContent = 'Este ya es tu ID actual';
    status.style.color = 'var(--gold-light)'; return;
  }

  const btn = document.querySelector('#import-session-modal .modal-btn-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Verificando…'; }
  status.textContent = 'Buscando sesión en la nube…';
  status.style.color = 'var(--mid)';

  const ok = await importSession(input);

  if (btn) { btn.disabled = false; btn.textContent = 'Importar'; }

  if (ok) {
    closeImportSession();
    renderHome();
    renderSettings();
    renderSessionId();
  } else {
    status.textContent = 'No se encontró ninguna colección con ese ID.';
    status.style.color = 'var(--danger)';
  }
}

// Expose all session functions globally
window.renderSessionId    = renderSessionId;
window.copySessionId      = copySessionId;
window.showQR             = showQR;
window.closeQR            = closeQR;
window.openImportSession  = openImportSession;
window.closeImportSession = closeImportSession;
window.handleImportSession = handleImportSession;

/* ══════════════════════════════════════════════════════
   VERSION CHECK & AUTO-UPDATE
   Compares local APP_VERSION with /version.json on server.
   Works on iOS PWA where SW update is unreliable.
══════════════════════════════════════════════════════ */

