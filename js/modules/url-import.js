/**
 * url-import.js
 * Sends a product URL to the Cloudflare Worker → compound-beta reads the page
 * and returns extracted watch specs → fills the wishlist form.
 *
 * Works with: Amazon, AliExpress, eBay, Chrono24, brand websites, watch forums.
 */
async function importFromUrl() {
  const urlInput = document.getElementById('wl-url-input');
  const statusEl = document.getElementById('wl-url-status');
  const btn      = document.getElementById('wl-url-btn');
  const url      = urlInput?.value?.trim();

  if (!url) {
    if (statusEl) { statusEl.textContent = 'Pega una URL de producto primero'; statusEl.style.color = 'rgba(220,80,80,0.8)'; }
    return;
  }

  let hostname = '';
  try {
    hostname = new URL(url).hostname.replace('www.', '');
  } catch {
    if (statusEl) { statusEl.textContent = 'URL no válida'; statusEl.style.color = 'rgba(220,80,80,0.8)'; }
    return;
  }

  // Update UI — loading state
  if (btn)      { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span>'; }
  if (statusEl) { statusEl.style.color = 'var(--mid)'; statusEl.textContent = `Leyendo ${hostname}… (5-10 segundos)`; }

  try {
    const res = await fetch(`${CONFIG.WORKER_URL}/import-url`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Handle errors from worker
    if (data._blocked || data._empty) {
      if (statusEl) {
        statusEl.style.color = data._blocked ? 'rgba(220,80,80,0.8)' : 'var(--gold)';
        statusEl.textContent = data._message || 'No se encontraron especificaciones. Introduce los datos manualmente.';
      }
      return;
    }

    // Fill form fields
    let filled = 0;
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el && val) { el.value = val; filled++; }
    };

    set('wl-brand',       data.brand);
    set('wl-model',       data.model);
    set('wl-ref',         data.ref);
    set('wl-precio',      data.precio);
    set('wl-notas',       data.notas);
    set('wl-calibre',     data.calibre);
    set('wl-cristal',     data.cristal);
    set('wl-diametro',    data.diametro);
    set('wl-grosor',      data.grosor);
    set('wl-resistencia', data.resistencia);
    set('wl-reserva',     data.reserva);
    set('wl-caja',        data.caja);
    set('wl-brazalete',   data.brazalete);
    set('wl-esfera',      data.esfera);

    if (data.type) {
      const typeEl = document.getElementById('wl-type');
      if (typeEl) { typeEl.value = data.type; filled++; }
    }

    if (filled > 0) {
      if (statusEl) {
        statusEl.style.color = '#4CAF50';
        statusEl.innerHTML = `<i class="ti ti-check" aria-hidden="true"></i> ${filled} campos importados desde ${escHtml(hostname)}. Revisa y ajusta si es necesario.`;
      }
      showToast(`${filled} campos importados`);
      document.getElementById('wl-brand')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      if (statusEl) {
        statusEl.style.color = 'var(--gold)';
        statusEl.textContent = 'No se encontraron especificaciones en esta página. Prueba con otra tienda o introduce los datos manualmente.';
      }
    }

  } catch (e) {
    if (statusEl) {
      statusEl.style.color = 'rgba(220,80,80,0.8)';
      statusEl.textContent = 'Error de conexión. Verifica tu conexión e inténtalo de nuevo.';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-download" aria-hidden="true"></i>'; }
  }
}

window.importFromUrl = importFromUrl;
