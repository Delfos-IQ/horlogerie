async function importFromUrl() {
  const urlInput  = document.getElementById('wl-url-input');
  const statusEl  = document.getElementById('wl-url-status');
  const btn       = document.getElementById('wl-url-btn');
  const url       = urlInput?.value?.trim();

  if (!url) { if (statusEl) { statusEl.textContent = 'Pega una URL de producto primero'; statusEl.style.color = 'rgba(220,80,80,0.8)'; } return; }

  // Basic URL validation
  try { new URL(url); } catch {
    if (statusEl) { statusEl.textContent = 'URL no válida'; statusEl.style.color = 'rgba(220,80,80,0.8)'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner"></span>'; }
  if (statusEl) { statusEl.textContent = 'Leyendo página…'; statusEl.style.color = 'var(--mid)'; }

  // Detect store for user feedback
  const host = (() => { try { return new URL(url).hostname.replace('www.',''); } catch { return ''; } })();
  const isGroqRoute = ['amazon','aliexpress','ebay'].some(s => host.includes(s));
  if (isGroqRoute && statusEl) {
    statusEl.textContent = `Usando IA para leer ${host}… (puede tardar 5-10s)`;
  }

  try {
    const res = await fetch(`${CONFIG.WORKER_URL}/import-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data._blocked) {
      if (statusEl) {
        statusEl.style.color = 'rgba(220,80,80,0.8)';
        statusEl.textContent = data._message || 'No se pudo leer la página. Introduce los datos manualmente.';
      }
      return;
    }

    // Fill form fields with extracted data
    let filled = 0;
    const set = (id, val) => { const el = document.getElementById(id); if (el && val) { el.value = val; filled++; } };

    set('wl-brand',      data.brand);
    set('wl-model',      data.model);
    set('wl-ref',        data.ref);
    set('wl-precio',     data.precio);
    set('wl-notas',      data.notas);
    set('wl-calibre',    data.calibre);
    set('wl-cristal',    data.cristal);
    set('wl-diametro',   data.diametro);
    set('wl-grosor',     data.grosor);
    set('wl-resistencia',data.resistencia);
    set('wl-reserva',    data.reserva);
    set('wl-caja',       data.caja);
    set('wl-brazalete',  data.brazalete);
    set('wl-esfera',     data.esfera);

    if (data.type && document.getElementById('wl-type')) {
      document.getElementById('wl-type').value = data.type; filled++;
    }

    if (filled > 0) {
      if (statusEl) {
        statusEl.style.color = '#4CAF50';
        statusEl.innerHTML = `<i class="ti ti-check"></i> ${filled} campos importados desde ${escHtml(data._source || host)}. Revisa y ajusta si es necesario.`;
      }
      showToast(`${filled} campos importados`);
      // Scroll down to brand field
      document.getElementById('wl-brand')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      if (statusEl) {
        statusEl.style.color = 'var(--gold)';
        statusEl.textContent = 'No se encontraron especificaciones. Introduce los datos manualmente.';
      }
    }
  } catch (e) {
    if (statusEl) {
      statusEl.style.color = 'rgba(220,80,80,0.8)';
      statusEl.textContent = 'Error: ' + e.message;
    }
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-download"></i>'; }
}

window.importFromUrl = importFromUrl;
