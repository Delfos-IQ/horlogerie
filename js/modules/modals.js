/* ─── ADD / EDIT MODAL ─── */
function openAddModal() {
  editingWatchId = null;
  editingPhotoData = null;
  window._pendingDbSpecs = null;
  window._pendingDbPrice = null;
  document.getElementById('modal-title-text').textContent = 'Añadir Reloj';
  document.getElementById('modal-save-btn').textContent   = 'Guardar';
  document.getElementById('f-brand').value  = '';
  document.getElementById('f-model').value  = '';
  document.getElementById('f-ref').value    = '';
  document.getElementById('f-type').value   = 'automatic';
  document.getElementById('f-notes').value  = '';
  document.getElementById('photo-preview').style.display = 'none';
  const dbSec = document.getElementById('db-search-section');
  if (dbSec) dbSec.style.display = 'block';
  const dbInput = document.getElementById('db-search-input');
  if (dbInput) dbInput.value = '';
  const dbRes = document.getElementById('db-search-results');
  if (dbRes) dbRes.style.display = 'none';
  resetDbHint();
  document.getElementById('add-modal').style.display = 'flex';
  dbLoad(); // preload the database
}

function resetDbHint() {
  const hint = document.getElementById('db-hint');
  if (hint) hint.innerHTML = '<i class="ti ti-database" style="color:var(--gold);"></i> Berny · Pagani Design · San Martin · Cadisen · OBLVLO · Seagull · CIGA Design · Carnival · Reef Tiger · Steeldive';
}

function openEditModal(id) {
  const w = getWatch(id);
  if (!w) return;
  editingWatchId   = id;
  editingPhotoData = w.photo || null;
  window._pendingDbSpecs = null;
  window._pendingDbPrice = null;
  document.getElementById('modal-title-text').textContent = 'Editar Reloj';
  document.getElementById('modal-save-btn').textContent   = 'Actualizar';
  document.getElementById('f-brand').value  = w.brand;
  document.getElementById('f-model').value  = w.model;
  document.getElementById('f-ref').value    = w.ref || '';
  document.getElementById('f-type').value   = w.type;
  document.getElementById('f-notes').value  = w.notes || '';
  const prev = document.getElementById('photo-preview');
  if (w.photo) { prev.src = w.photo; prev.style.display = 'block'; }
  else { prev.style.display = 'none'; }
  const dbSec = document.getElementById('db-search-section');
  if (dbSec) dbSec.style.display = 'none'; // hide DB search when editing
  document.getElementById('add-modal').style.display = 'flex';
}

function closeAddModal() {
  document.getElementById('add-modal').style.display = 'none';
}
function closeModalIfOutside(e) {
  if (e.target.id === 'add-modal') closeAddModal();
}

/* ─── Photo upload ─── */
function openPhotoSheet() {
  document.getElementById('photo-sheet').style.display = 'flex';
}
function closePhotoSheet() {
  document.getElementById('photo-sheet').style.display = 'none';
}
function closePhotoSheetIfOutside(e) {
  if (e.target.id === 'photo-sheet') closePhotoSheet();
}
function choosePhotoSource(source) {
  closePhotoSheet();
  document.getElementById(source === 'camera' ? 'photo-input-camera' : 'photo-input-library').click();
}

function handlePhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  // Reset input so same file can be re-selected
  e.target.value = '';
  const reader = new FileReader();
  reader.onload = ev => {
    compressPhoto(ev.target.result, 900).then(resized => {
      editingPhotoData = resized;
      const prev = document.getElementById('photo-preview');
      prev.src = resized; prev.style.display = 'block';
    });
  };
  reader.readAsDataURL(file);
}

/* ─── DB Search ─── */
function handleDbSearch(query) {
  const resultsEl = document.getElementById('db-search-results');
  if (!query || query.length < 2) { resultsEl.style.display = 'none'; return; }
  const results = dbSearch(query, 6);
  if (!results.length) { resultsEl.style.display = 'none'; return; }

  resultsEl.innerHTML = results.map((w, i) => `
    <div class="db-result-item" data-idx="${i}">
      <div class="db-result-main">
        <span class="db-result-brand">${escHtml(w.brand)}</span>
        <span class="db-result-model">${escHtml(w.model)}</span>
      </div>
      <div class="db-result-sub">${w.ref ? escHtml(w.ref)+' · ' : ''}${escHtml(w.specs?.calibre || '')}${w.price?.value ? ' · '+escHtml(w.price.value) : ''}</div>
    </div>`).join('');
  resultsEl.style.display = 'block';

  resultsEl.querySelectorAll('.db-result-item').forEach((el, i) => {
    el.addEventListener('click', () => applyDbResult(results[i]));
  });
}

function applyDbResult(w) {
  document.getElementById('f-brand').value = w.brand;
  document.getElementById('f-model').value = w.model;
  document.getElementById('f-ref').value   = w.ref || '';
  document.getElementById('f-type').value  = w.type;
  document.getElementById('db-search-results').style.display = 'none';
  document.getElementById('db-search-input').value = `${w.brand} ${w.model}`;
  const hint = document.getElementById('db-hint');
  if (hint) hint.innerHTML = `<i class="ti ti-check" style="color:#4CAF50;"></i> <strong>${escHtml(w.brand)} ${escHtml(w.model)}</strong> — specs encontradas`;
  window._pendingDbSpecs = w.specs;
  window._pendingDbPrice = w.price;
  showToast(`${w.brand} ${w.model} seleccionado`);
}

/* ─── Save watch ─── */
async function saveWatch() {
  const brand = document.getElementById('f-brand').value.trim();
  const model = document.getElementById('f-model').value.trim();
  const ref   = document.getElementById('f-ref').value.trim();
  const type  = document.getElementById('f-type').value;
  const notes = document.getElementById('f-notes').value.trim();
  if (!brand) { showToast('Introduce la marca'); return; }
  if (!model) { showToast('Introduce el modelo'); return; }

  const btn = document.getElementById('modal-save-btn');
  btn.disabled = true; btn.textContent = 'Guardando…';

  try {
    if (editingWatchId) {
      await updateWatch(editingWatchId, { brand, model, ref, type, notes, photo: editingPhotoData });
      if (window._pendingDbSpecs) {
        await updateWatch(editingWatchId, { specs: window._pendingDbSpecs, price: window._pendingDbPrice || {value:'',note:''}, _source:'local_db' });
      }
      closeAddModal();
      showToast('Reloj actualizado');
      openDetail(editingWatchId);
    } else {
      const newW = await addWatch({ brand, model, ref, type, notes, photo: editingPhotoData });
      if (window._pendingDbSpecs && newW) {
        await updateWatch(newW.id, { specs: window._pendingDbSpecs, price: window._pendingDbPrice || {value:'',note:''}, _source:'local_db' });
      }
      window._pendingDbSpecs = null;
      window._pendingDbPrice = null;
      closeAddModal();
      showToast(`${brand} ${model} añadido`);
      renderHome();
    }
  } finally {
    btn.disabled = false;
    btn.textContent = editingWatchId ? 'Actualizar' : 'Guardar';
  }
}

