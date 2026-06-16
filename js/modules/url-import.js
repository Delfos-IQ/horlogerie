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

/* ─── Import URL into the ADD WATCH modal ─── */
async function importFromUrlToWatch() {
  const urlInput = document.getElementById('f-url-input');
  const statusEl = document.getElementById('f-url-status');
  const btn      = document.getElementById('f-url-btn');
  const url      = urlInput?.value?.trim();

  if (!url) {
    if (statusEl) { statusEl.textContent = 'Pega una URL de producto primero'; statusEl.style.color = 'rgba(220,80,80,0.8)'; }
    return;
  }

  let hostname = '';
  try { hostname = new URL(url).hostname.replace('www.', ''); }
  catch { if (statusEl) { statusEl.textContent = 'URL no válida'; statusEl.style.color = 'rgba(220,80,80,0.8)'; } return; }

  if (btn)      { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span>'; }
  if (statusEl) { statusEl.style.color = 'var(--mid)'; statusEl.textContent = `Leyendo ${hostname}… (5-10 segundos)`; }

  try {
    const res = await fetch(`${CONFIG.WORKER_URL}/import-url`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data._blocked || data._empty) {
      if (statusEl) { statusEl.style.color = data._blocked ? 'rgba(220,80,80,0.8)' : 'var(--gold)'; statusEl.textContent = data._message || 'No se encontraron especificaciones.'; }
      return;
    }

    // Fill main form fields
    let filled = 0;
    const setField = (id, val) => {
      const el = document.getElementById(id);
      if (el && val && !el.value) { el.value = val; filled++; }
    };
    setField('f-brand', data.brand);
    setField('f-model', data.model);
    setField('f-ref',   data.ref);
    if (data.type) {
      const typeEl = document.getElementById('f-type');
      if (typeEl) { typeEl.value = data.type; filled++; }
    }

    // Store specs and price for saveWatch
    const specs = {
      calibre: data.calibre || '', cristal: data.cristal || '',
      diametro: data.diametro || '', grosor: data.grosor || '',
      resistencia: data.resistencia || '', reserva: data.reserva || '',
      caja: data.caja || '', brazalete: data.brazalete || '',
      esfera: data.esfera || '',
    };
    window._pendingDbSpecs = specs;
    window._pendingDbPrice = data.precio ? { value: data.precio, note: hostname } : null;
    window._pendingSource  = hostname;

    // Show imported specs preview
    const specSection = document.getElementById('f-specs-section');
    const specEntries = { calibre: data.calibre, cristal: data.cristal, diametro: data.diametro,
      grosor: data.grosor, resistencia: data.resistencia, reserva: data.reserva,
      caja: data.caja, brazalete: data.brazalete, esfera: data.esfera, precio: data.precio };

    let specCount = 0;
    for (const [k, v] of Object.entries(specEntries)) {
      const el = document.getElementById('fi-' + k);
      if (el) { el.textContent = v || '—'; if (v) specCount++; }
    }

    if (specSection && specCount > 0) {
      specSection.style.display = 'block';
      filled += specCount;
    }

    if (filled > 0) {
      if (statusEl) {
        statusEl.style.color = '#4CAF50';
        statusEl.innerHTML = `<i class="ti ti-check"></i> ${filled} campos importados desde ${escHtml(hostname)}`;
      }
      showToast(`${filled} campos importados`);
      document.getElementById('f-brand')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      if (statusEl) { statusEl.style.color = 'var(--gold)'; statusEl.textContent = 'No se encontraron datos. Introduce manualmente.'; }
    }

  } catch {
    if (statusEl) { statusEl.style.color = 'rgba(220,80,80,0.8)'; statusEl.textContent = 'Error de conexión. Inténtalo de nuevo.'; }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-download" aria-hidden="true"></i>'; }
  }
}

window.importFromUrlToWatch = importFromUrlToWatch;

/* ─── Import specs from URL into an EXISTING watch (detail view) ─── */
async function importSpecsFromUrl(watchId) {
  const urlInput = document.getElementById('d-url-input');
  const statusEl = document.getElementById('d-url-status');
  const btn      = document.getElementById('d-url-btn');
  const url      = urlInput?.value?.trim();

  if (!url) {
    if (statusEl) { statusEl.textContent = 'Pega una URL primero'; statusEl.style.color = 'rgba(220,80,80,0.8)'; }
    return;
  }

  let hostname = '';
  try { hostname = new URL(url).hostname.replace('www.', ''); }
  catch { if (statusEl) { statusEl.textContent = 'URL no válida'; statusEl.style.color = 'rgba(220,80,80,0.8)'; } return; }

  if (btn)      { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span>'; }
  if (statusEl) { statusEl.textContent = `Leyendo ${hostname}…`; statusEl.style.color = 'var(--mid)'; }

  try {
    const res = await fetch(`${CONFIG.WORKER_URL}/import-url`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data._blocked || data._empty) {
      if (statusEl) { statusEl.style.color = 'rgba(220,80,80,0.8)'; statusEl.textContent = data._message || 'Sin especificaciones.'; }
      return;
    }

    const w = getWatch(watchId);
    if (!w) return;

    // Merge imported specs (don't overwrite specs the user already filled in manually)
    const existingSpecs = w.specs || {};
    const newSpecs = { ...existingSpecs };
    const specKeys = ['calibre','cristal','diametro','grosor','resistencia','reserva','caja','brazalete','esfera'];
    let updated = 0;
    for (const k of specKeys) {
      if (data[k] && !existingSpecs[k]) { newSpecs[k] = data[k]; updated++; }
    }
    // Movimiento = type + calibre
    if (data.calibre && !existingSpecs.movimiento) {
      newSpecs.movimiento = `${data.type === 'automatic' ? 'Automático' : data.type === 'quartz' ? 'Cuarzo' : 'Manual'}, ${data.calibre}`;
      updated++;
    }

    await updateWatch(watchId, {
      specs:   newSpecs,
      price:   data.precio ? { value: data.precio, note: hostname } : (w.price || null),
      _source: hostname,
    });

    // Refresh the spec cards in place
    renderSpecs(getWatch(watchId));
    if (data.type && data.type !== w.type) await updateWatch(watchId, { type: data.type });

    if (statusEl) {
      statusEl.style.color = '#4CAF50';
      statusEl.textContent = updated > 0
        ? `✓ ${updated} specs actualizadas desde ${hostname}`
        : `✓ Revisado — no había campos nuevos que añadir`;
    }
    if (updated > 0) showToast(`${updated} specs importadas`);

  } catch {
    if (statusEl) { statusEl.style.color = 'rgba(220,80,80,0.8)'; statusEl.textContent = 'Error de conexión.'; }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-download" aria-hidden="true"></i>'; }
  }
}

window.importSpecsFromUrl   = importSpecsFromUrl;
window.renderSpecsImportBtn = renderSpecsImportBtn;
