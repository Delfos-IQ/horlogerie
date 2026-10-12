/* ─── Rotor Pro on the watch page: maintenance log, accuracy and straps; collection value ─── */
import { SERVICE_KINDS, accuracyStats, addAccuracyReading, addServiceEntry, addStrap, collectionValue, deleteAccuracyReading,
  deleteServiceEntry, deleteStrap, fitStrap, getWatch, getWatches, isSafePhoto, serviceCost, wearStats } from '../storage.js';
import { isPro } from '../billing.js';
import { locale, money, t } from '../i18n.js';
import { escHtml, formatDate, showToast } from './core.js';
import { openSheet, showConfirm } from './sheet.js';
import { bindProTeasers, proMark, proTeaser } from './pro.js';
import { KIND_LABELS, generateInsurancePDF } from '../insurance.js';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fromDate = v => { const [y, m, d] = (v || '').split('-').map(Number); return y ? new Date(y, m - 1, d, 12).getTime() : null; };
/** «+3,2 s/día» in the active language */
export function fmtRate(r, quartz = false) {
  if (r === null || r === undefined) return '—';
  const v = quartz ? r * 30 : r;
  const n = Math.abs(v) < 10 ? v.toLocaleString(locale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : Math.round(v).toLocaleString(locale());
  return `${v > 0 ? '+' : v < 0 ? '' : '±'}${n} ${quartz ? t('s/mes') : t('s/día')}`;
}

/* ══ Maintenance tab: log and accuracy ══ */
export function renderCare(w, el, refresh) {
  if (!el) return;
  if (!isPro()) {
    el.innerHTML = proTeaser(t('Historial de mantenimiento'), t('Revisiones, pilas y reparaciones con su coste; los avisos se ajustan solos.'), 'ti-tool')
      + proTeaser(t('Precisión'), t('Apunta cuánto adelanta o atrasa y verás sus segundos al día.'), 'ti-clock');
    bindProTeasers(el);
    return;
  }
  const log = w.serviceLog || [];
  const st = accuracyStats(w);
  const quartz = w.type === 'quartz';
  const readings = [...(w.accuracy || [])].reverse().slice(0, 8);
  el.innerHTML = `
    <div class="section-title">${t('Historial de mantenimiento')} ${proMark()}</div>
    ${log.length ? `<div class="care-list">${log.map(e => `
      <div class="care-row">
        <div class="care-main"><b>${t(KIND_LABELS[e.kind])}</b><small>${formatDate(e.date)}${e.note ? ' · ' + escHtml(e.note) : ''}</small></div>
        ${typeof e.cost === 'number' ? `<span class="care-val">${money(e.cost)}</span>` : ''}
        <button class="care-del" data-del-service="${escHtml(e.id)}" aria-label="${t('Borrar')}"><i class="ti ti-trash" aria-hidden="true"></i></button>
      </div>`).join('')}</div>
      ${serviceCost(w) ? `<div class="care-total">${t('Total en mantenimiento')}: <b>${money(serviceCost(w))}</b></div>` : ''}`
      : `<div class="care-empty">${t('Aún no has apuntado ninguna intervención.')}</div>`}
    <button class="chip-btn" id="care-add-service"><i class="ti ti-plus" aria-hidden="true"></i> ${t('Apuntar intervención')}</button>

    <div class="section-title mt-14">${t('Precisión')} ${proMark()}</div>
    ${st.rates.length ? `<div class="usage-grid care-acc">
        <div class="usage-cell"><div class="usage-val">${fmtRate(st.avg, quartz)}</div><div class="usage-label">${t('Media reciente')}</div></div>
        <div class="usage-cell"><div class="usage-val">${fmtRate(st.last, quartz)}</div><div class="usage-label">${t('Última medida')}</div></div>
      </div>` : `<div class="care-empty">${readings.length ? t('Apunta otra lectura dentro de unos días para ver cuántos segundos gana o pierde.') : t('Compara la hora del reloj con una hora exacta y apunta cuántos segundos adelanta o atrasa. Con dos lecturas separadas unos días verás su precisión.')}</div>`}
    ${readings.length ? `<div class="care-list">${readings.map(r => `
      <div class="care-row">
        <div class="care-main"><b>${r.offset > 0 ? '+' : ''}${r.offset.toLocaleString(locale())} s</b><small>${new Date(r.ts).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${r.setAfter ? ' · ' + t('puesto en hora') : ''}</small></div>
        <button class="care-del" data-del-acc="${r.ts}" aria-label="${t('Borrar')}"><i class="ti ti-trash" aria-hidden="true"></i></button>
      </div>`).join('')}</div>` : ''}
    <button class="chip-btn" id="care-add-acc"><i class="ti ti-clock-plus" aria-hidden="true"></i> ${t('Apuntar desviación')}</button>`;

  el.querySelector('#care-add-service').addEventListener('click', () => openServiceSheet(w.id, refresh));
  el.querySelector('#care-add-acc').addEventListener('click', () => openAccuracySheet(w.id, refresh));
  el.querySelectorAll('[data-del-service]').forEach(b => b.addEventListener('click', () =>
    showConfirm(t('¿Borrar esta intervención?'), t('Se quitará del historial de mantenimiento.'), () => {
      deleteServiceEntry(w.id, b.dataset.delService); refresh();
    }, { okLabel: t('Borrar') })));
  el.querySelectorAll('[data-del-acc]').forEach(b => b.addEventListener('click', () => {
    deleteAccuracyReading(w.id, Number(b.dataset.delAcc)); refresh();
  }));
}

export function openServiceSheet(id, done) {
  const w = getWatch(id);
  if (!w) return;
  const kinds = SERVICE_KINDS.filter(k => !(k === 'battery' && w.type !== 'quartz'));
  const { $, close } = openSheet({
    label: t('Apuntar intervención'),
    html: `<div class="modal-title">${t('Apuntar intervención')}</div>
      <div class="form-grid-2">
        <div class="form-field"><label class="form-label" for="sv-date">${t('Fecha')}</label>
          <input class="form-input" type="date" id="sv-date" value="${today()}" max="${today()}"></div>
        <div class="form-field"><label class="form-label" for="sv-kind">${t('Tipo')}</label>
          <select class="form-input form-select" id="sv-kind">${kinds.map(k => `<option value="${k}">${t(KIND_LABELS[k])}</option>`).join('')}</select></div>
      </div>
      <div class="form-field"><label class="form-label" for="sv-cost">${t('Coste')}</label>
        <input class="form-input" id="sv-cost" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0"></div>
      <div class="form-field"><label class="form-label" for="sv-note">${t('Nota')}</label>
        <input class="form-input" id="sv-note" maxlength="300" placeholder="${t('Taller, qué se hizo…')}"></div>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-cancel" data-close>${t('Cancelar')}</button>
        <button class="modal-btn modal-btn-save" id="sv-save">${t('Guardar')}</button>
      </div>`,
  });
  $('#sv-save').addEventListener('click', () => {
    const raw = $('#sv-cost').value.trim().replace(',', '.');
    const cost = raw === '' ? null : Number(raw);
    if (cost !== null && (!isFinite(cost) || cost < 0)) { showToast(t('El precio debe ser un número')); return; }
    const ok = addServiceEntry(id, { date: fromDate($('#sv-date').value), kind: $('#sv-kind').value, cost, note: $('#sv-note').value.trim() });
    if (!ok) { showToast(t('Elige una fecha')); return; }
    close(); showToast(t('Intervención apuntada')); done?.();
  });
}

export function openAccuracySheet(id, done) {
  const { $, close } = openSheet({
    label: t('Apuntar desviación'),
    html: `<div class="modal-title">${t('Apuntar desviación')}</div>
      <div class="sheet-text">${t('Compara el reloj con una hora exacta (la del móvil sirve) y apunta la diferencia en segundos.')}</div>
      <div class="form-grid-2">
        <div class="form-field"><label class="form-label" for="ac-sign">${t('El reloj')}</label>
          <select class="form-input form-select" id="ac-sign"><option value="1">${t('adelanta')}</option><option value="-1">${t('atrasa')}</option></select></div>
        <div class="form-field"><label class="form-label" for="ac-sec">${t('Segundos')}</label>
          <input class="form-input" id="ac-sec" type="number" inputmode="decimal" min="0" step="0.5" value="0"></div>
      </div>
      <label class="check-row"><input type="checkbox" id="ac-set"> ${t('Después lo he puesto en hora')}</label>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-cancel" data-close>${t('Cancelar')}</button>
        <button class="modal-btn modal-btn-save" id="ac-save">${t('Guardar')}</button>
      </div>`,
  });
  setTimeout(() => $('#ac-sec')?.select(), 60);
  $('#ac-save').addEventListener('click', () => {
    const sec = Number($('#ac-sec').value.replace(',', '.'));
    if (!isFinite(sec) || sec < 0) { showToast(t('Escribe los segundos')); return; }
    addAccuracyReading(id, { ts: Date.now(), offset: sec * Number($('#ac-sign').value), setAfter: $('#ac-set').checked });
    close(); showToast(t('Lectura apuntada')); done?.();
  });
}

/* ══ Ficha tab: straps ══ */
export function renderStraps(w, el, refresh) {
  if (!el) return;
  if (!isPro()) { el.innerHTML = proTeaser(t('Correas'), t('Las correas de cada reloj y cuál lleva puesta.'), 'ti-link'); bindProTeasers(el); return; }
  const st = w.straps || [];
  el.innerHTML = `<div class="section-title">${t('Correas')} ${proMark()}</div>
    ${st.length ? `<div class="care-list">${st.map(s => `
      <div class="care-row${s.fitted ? ' on' : ''}">
        <div class="care-main"><b>${escHtml(s.name)}</b><small>${[s.material, s.width, s.note].filter(Boolean).map(escHtml).join(' · ')}</small></div>
        ${s.fitted ? `<span class="care-tag">${t('Puesta')}</span>` : `<button class="chip-btn care-fit" data-fit="${escHtml(s.id)}">${t('Poner')}</button>`}
        <button class="care-del" data-del-strap="${escHtml(s.id)}" aria-label="${t('Borrar')}"><i class="ti ti-trash" aria-hidden="true"></i></button>
      </div>`).join('')}</div>` : `<div class="care-empty">${t('Apunta las correas que tienes para este reloj.')}</div>`}
    <button class="chip-btn" id="care-add-strap"><i class="ti ti-plus" aria-hidden="true"></i> ${t('Añadir correa')}</button>`;
  el.querySelector('#care-add-strap').addEventListener('click', () => openStrapSheet(w.id, refresh));
  el.querySelectorAll('[data-fit]').forEach(b => b.addEventListener('click', () => { fitStrap(w.id, b.dataset.fit); refresh(); }));
  el.querySelectorAll('[data-del-strap]').forEach(b => b.addEventListener('click', () => { deleteStrap(w.id, b.dataset.delStrap); refresh(); }));
}
export function openStrapSheet(id, done) {
  const w = getWatch(id);
  const { $, close } = openSheet({
    label: t('Añadir correa'),
    html: `<div class="modal-title">${t('Añadir correa')}</div>
      <div class="form-field"><label class="form-label" for="sp-name">${t('Nombre')}</label>
        <input class="form-input" id="sp-name" maxlength="80" placeholder="${t('NATO gris, piel marrón…')}"></div>
      <div class="form-grid-2">
        <div class="form-field"><label class="form-label" for="sp-mat">${t('Material')}</label>
          <input class="form-input" id="sp-mat" maxlength="60"></div>
        <div class="form-field"><label class="form-label" for="sp-width">${t('Ancho')}</label>
          <input class="form-input" id="sp-width" maxlength="20" value="${escHtml(w?.specs?.asas || '')}" placeholder="20 mm"></div>
      </div>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-cancel" data-close>${t('Cancelar')}</button>
        <button class="modal-btn modal-btn-save" id="sp-save">${t('Guardar')}</button>
      </div>`,
  });
  setTimeout(() => $('#sp-name')?.focus(), 60);
  $('#sp-save').addEventListener('click', () => {
    if (!addStrap(id, { name: $('#sp-name').value, material: $('#sp-mat').value.trim(), width: $('#sp-width').value.trim() })) {
      showToast(t('Escribe un nombre')); return;
    }
    close(); showToast(t('Correa añadida')); done?.();
  });
}

/* ══ Historial → Valor ══ */
export function renderValue(el, openWatch) {
  if (!el) return;
  if (!isPro()) {
    el.innerHTML = proTeaser(t('Valor de la colección'), t('Lo que pagaste, lo que vale hoy y el coste real por uso.'), 'ti-chart-bar');
    bindProTeasers(el);
    return;
  }
  const ws = getWatches();
  const v = collectionValue(ws, w => wearStats(w).daysWorn);
  if (!v.priced) {
    el.innerHTML = `<div class="history-empty">${t('Añade el precio que pagaste en cada reloj (Editar → Compra y mantenimiento) para ver el valor de tu colección.')}</div>`;
    return;
  }
  const pct = v.change === null ? '' : `${v.change >= 0 ? '+' : ''}${Math.round(v.change * 100)} %`;
  const max = v.byBrand[0]?.[1] || 1;
  const rows = ws.map(w => ({ w, paid: w.purchasePrice || 0, val: w.currentValue || w.purchasePrice || 0, st: wearStats(w), sc: serviceCost(w) }))
    .sort((a, b) => b.val - a.val);
  el.innerHTML = `
    <div class="value-hero">
      <div class="value-label">${t('Valor de la colección')}</div>
      <div class="value-big">${money(v.value, { decimals: 0 })}</div>
      <div class="value-sub">${t('Pagaste {p}', { p: money(v.paid, { decimals: 0 }) })}${pct ? ` · <span class="${v.change >= 0 ? 'c-ok' : 'c-danger'}">${pct}</span>` : ''}</div>
    </div>
    <div class="usage-grid">
      <div class="usage-cell"><div class="usage-val">${v.perWear === null ? '—' : money(v.perWear)}</div><div class="usage-label">${t('Coste por uso')}</div></div>
      <div class="usage-cell"><div class="usage-val">${money(v.service, { decimals: 0 })}</div><div class="usage-label">${t('En mantenimiento')}</div></div>
    </div>
    ${v.priced < v.count ? `<div class="care-empty">${t('{n} de {m} relojes tienen precio. Los demás no cuentan.', { n: v.priced, m: v.count })}</div>` : ''}
    <div class="section-title mt-14">${t('Por marca')}</div>
    <div class="value-bars">${v.byBrand.slice(0, 8).map(([b, x]) => `
      <div class="value-bar"><span class="vb-name">${escHtml(b)}</span><span class="vb-track"><span style="width:${Math.max(3, Math.round(x / max * 100))}%"></span></span><span class="vb-val">${money(x, { decimals: 0 })}</span></div>`).join('')}
    </div>
    <div class="section-title mt-14">${t('Por reloj')}</div>
    <div class="care-list">${rows.map(r => `
      <button class="care-row value-row" data-wid="${escHtml(r.w.id)}">
        ${isSafePhoto(r.w.photo) ? `<img class="cal-chip" src="${r.w.photo}" alt="" style="--s:34px">` : ''}
        <div class="care-main"><b>${escHtml(r.w.brand)} ${escHtml(r.w.model)}</b>
          <small>${r.paid ? t('Pagado {p}', { p: money(r.paid, { decimals: 0 }) }) : t('Sin precio')}${r.st.daysWorn && r.paid ? ' · ' + t('{c} por uso', { c: money((r.paid + r.sc) / r.st.daysWorn) }) : ''}</small></div>
        <span class="care-val">${r.val ? money(r.val, { decimals: 0 }) : '—'}</span>
      </button>`).join('')}</div>
    <div class="care-empty">${t('«Valor» es el que indicas en cada reloj; si no lo indicas, cuenta lo que pagaste.')}</div>`;
  el.querySelectorAll('[data-wid]').forEach(b => b.addEventListener('click', () => openWatch(b.dataset.wid)));
}

/* ══ Ajustes → Exportar → Inventario para el seguro ══ */
export function openInsuranceSheet() {
  const { $, close } = openSheet({
    label: t('Inventario para el seguro'),
    html: `<div class="modal-title">${t('Inventario para el seguro')} ${proMark()}</div>
      <div class="sheet-text">${t('Un PDF con cada reloj: foto, referencia, número de serie, fecha y precio de compra, valor actual y mantenimiento. Revisa que cada reloj tenga esos datos (Editar → Compra y mantenimiento).')}</div>
      <div class="form-field"><label class="form-label" for="in-holder">${t('Titular (opcional)')}</label>
        <input class="form-input" id="in-holder" maxlength="80" autocomplete="name"></div>
      <div class="sheet-hint">${t('El nombre solo se escribe en el PDF: Rotor no lo guarda.')}</div>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-cancel" data-close>${t('Cancelar')}</button>
        <button class="modal-btn modal-btn-save" id="in-go">${t('Crear PDF')}</button>
      </div>`,
  });
  $('#in-go').addEventListener('click', async () => {
    const holder = $('#in-holder').value.trim();
    close();
    try { await generateInsurancePDF({ holder }); } catch (e) { showToast(t('No se pudo crear el PDF: {e}', { e: e.message })); }
  });
}
