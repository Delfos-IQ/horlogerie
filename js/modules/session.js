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
  const id   = getSessionId();
  const modal = document.getElementById('qr-modal');
  if (!modal) return;
  document.getElementById('qr-session-id').textContent = id;

  // Generate QR using a free QR API (no key needed)
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(id)}&bgcolor=1A1A1A&color=D4AF6A`;
  const img   = document.getElementById('qr-img');
  if (img) { img.src = qrUrl; img.style.display = 'block'; }

  modal.style.display = 'flex';
}

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

  if (!input) { status.textContent = 'Introduce un ID de sesión'; status.style.color = 'rgba(220,80,80,0.8)'; return; }

  // Basic UUID format validation
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(input)) {
    status.textContent = 'Formato de ID incorrecto. Debe ser: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
    status.style.color = 'rgba(220,80,80,0.8)'; return;
  }

  if (input === getSessionId()) {
    status.textContent = 'Este ya es tu ID actual';
    status.style.color = 'var(--gold)'; return;
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
    status.style.color = 'rgba(220,80,80,0.8)';
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

