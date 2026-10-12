/**
 * insurance.js — Rotor Pro: watch inventory in PDF for an insurance policy.
 *
 * Page 1: holder (optional, typed when exporting, never stored), totals and a
 * table with reference, serial number, purchase date, price paid and current
 * value. Then one page per watch: photo, identification, purchase, key specs and
 * the maintenance log. Values are the owner's own: the PDF says so.
 */
import { getWatches, photoSrc, serviceCost } from './storage.js';
import { formatDate, showToast, typeLabel } from './modules/core.js';
import { drawNoPhoto, loadScript, photoToSquareJpeg, PDF_DARK, PDF_DARK2, PDF_DARK3, PDF_GOLD, PDF_GOLD_L, PDF_LIGHT, PDF_MID } from './export.js';
import { locale, money, t, tk } from './i18n.js';

const W = 210, H = 297, M = 14;
// jsPDF's built-in fonts are WinAnsi: no narrow spaces or rare symbols
const pdfText = s => String(s ?? '').replace(/[   ]/g, ' ').replace(/[^\x20-\x7E -ÿ€–—‘’“”•…]/g, '');
const amount = v => (typeof v === 'number' && v > 0 ? pdfText(money(v, { decimals: 0 })) : '—');

export const KIND_LABELS = { service: tk('Revisión'), battery: tk('Cambio de pila'), strap: tk('Correa'), polish: tk('Pulido'), repair: tk('Reparación'), other: tk('Otro') };

export async function generateInsurancePDF({ holder = '' } = {}) {
  const ws = getWatches();
  if (!ws.length) { showToast(t('No hay relojes en la colección')); return null; }
  if (typeof window.jspdf === 'undefined') await loadScript('./js/vendor/jspdf-2.5.1.umd.min.js');
  showToast(t('Generando PDF…'));
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const today = new Date().toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });

  const page = () => {
    doc.setFillColor(...PDF_DARK); doc.rect(0, 0, W, H, 'F');
    doc.setFillColor(...PDF_GOLD); doc.rect(0, 0, W, 1.5, 'F');
    doc.setTextColor(...PDF_MID); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text(pdfText(t('Valores declarados por el propietario. Generado con Rotor el {d}.', { d: today })), W / 2, H - 6, { align: 'center' });
  };

  /* ── Summary ── */
  page();
  let y = 24;
  doc.setTextColor(...PDF_GOLD_L); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text(pdfText(t('INVENTARIO DE RELOJES')), M, y, { charSpace: 2 });
  y += 9;
  doc.setTextColor(...PDF_LIGHT); doc.setFontSize(20);
  doc.text(pdfText(t('Para la póliza de seguro')), M, y);
  y += 8;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...PDF_MID);
  if (holder) { doc.text(pdfText(`${t('Titular')}: ${holder}`), M, y); y += 5.5; }
  doc.text(pdfText(`${t('Fecha')}: ${today}`), M, y);
  y += 10;

  const paid = ws.reduce((s, w) => s + (w.purchasePrice > 0 ? w.purchasePrice : 0), 0);
  const value = ws.reduce((s, w) => s + (w.currentValue > 0 ? w.currentValue : w.purchasePrice > 0 ? w.purchasePrice : 0), 0);
  const boxes = [[t('Relojes'), String(ws.length)], [t('Pagado'), amount(paid)], [t('Valor declarado'), amount(value)]];
  const bw = (W - 2 * M - 8) / 3;
  boxes.forEach(([l, v], i) => {
    const x = M + i * (bw + 4);
    doc.setFillColor(...PDF_DARK2); doc.roundedRect(x, y, bw, 20, 2, 2, 'F');
    doc.setDrawColor(...PDF_GOLD); doc.setLineWidth(0.3); doc.roundedRect(x, y, bw, 20, 2, 2, 'S');
    doc.setTextColor(...PDF_GOLD_L); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text(pdfText(v), x + bw / 2, y + 10, { align: 'center' });
    doc.setTextColor(...PDF_MID); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text(pdfText(l.toUpperCase()), x + bw / 2, y + 16, { align: 'center', charSpace: 0.6 });
  });
  y += 30;

  const cols = [M, M + 7, M + 64, M + 92, M + 124, M + 148, M + 166];
  const head = ['#', t('Reloj'), t('Ref.'), t('Nº de serie'), t('Compra'), t('Pagado'), t('Valor')];
  const header = () => {
    doc.setFillColor(...PDF_DARK3); doc.rect(M, y - 4.5, W - 2 * M, 7, 'F');
    doc.setTextColor(...PDF_GOLD_L); doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
    head.forEach((h, i) => doc.text(pdfText(h.toUpperCase()), cols[i] + 1, y));
    y += 7;
  };
  header();
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  ws.forEach((w, i) => {
    if (y > H - 20) { doc.addPage(); page(); y = 20; header(); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); }
    const cell = (s, max) => doc.splitTextToSize(pdfText(s || '—'), max)[0];
    doc.setTextColor(...PDF_MID); doc.text(String(i + 1), cols[0] + 1, y);
    doc.setTextColor(...PDF_LIGHT);
    doc.text(cell(`${w.brand} ${w.model}`, 55), cols[1] + 1, y);
    doc.setTextColor(...PDF_MID);
    doc.text(cell(w.ref, 26), cols[2] + 1, y);
    doc.text(cell(w.serial, 30), cols[3] + 1, y);
    doc.text(w.purchaseDate ? pdfText(new Date(w.purchaseDate).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' })) : '—', cols[4] + 1, y);
    doc.setTextColor(...PDF_LIGHT);
    doc.text(amount(w.purchasePrice), cols[5] + 1, y);
    doc.text(amount(w.currentValue || w.purchasePrice), cols[6] + 1, y);
    doc.setDrawColor(...PDF_DARK3); doc.setLineWidth(0.2); doc.line(M, y + 2.5, W - M, y + 2.5);
    y += 7.5;
  });
  y += 4;
  if (y < H - 30) {
    doc.setTextColor(...PDF_MID); doc.setFontSize(7.5);
    const note = doc.splitTextToSize(pdfText(t('«Valor» es el valor actual que indicó el propietario; si no lo indicó, el precio pagado. Guarda junto a este documento las facturas y certificados de cada reloj.')), W - 2 * M);
    doc.text(note, M, y);
  }

  /* ── One page per watch ── */
  for (const w of ws) {
    doc.addPage(); page();
    let cy = 20;
    doc.setTextColor(...PDF_GOLD_L); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text(pdfText(w.brand.toUpperCase()), M, cy, { charSpace: 2 });
    cy += 8;
    doc.setTextColor(...PDF_LIGHT); doc.setFontSize(18);
    doc.text(pdfText(w.model), M, cy);
    cy += 8;

    const ph = 70;
    const jpeg = photoSrc(w.id) ? await photoToSquareJpeg(photoSrc(w.id), 700) : null;
    if (jpeg) {
      try { doc.addImage(jpeg, 'JPEG', M, cy, ph, ph, undefined, 'MEDIUM'); doc.setDrawColor(...PDF_GOLD); doc.setLineWidth(0.4); doc.rect(M, cy, ph, ph, 'S'); }
      catch { drawNoPhoto(doc, M, cy, ph, ph); }
    } else drawNoPhoto(doc, M, cy, ph, ph);

    const rows = [
      [t('Referencia'), w.ref], [t('Nº de serie'), w.serial], [t('Tipo'), typeLabel(w.type)],
      [t('Calibre'), w.specs?.calibre], [t('Caja'), w.specs?.caja], [t('Diámetro'), w.specs?.diametro],
      [t('Cristal'), w.specs?.cristal],
      [t('Fecha de compra'), w.purchaseDate ? formatDate(w.purchaseDate) : ''],
      [t('Precio pagado'), w.purchasePrice ? amount(w.purchasePrice) : ''],
      [t('Valor actual'), w.currentValue ? amount(w.currentValue) : ''],
      [t('Última revisión'), w.lastService ? formatDate(w.lastService) : ''],
    ].filter(([, v]) => v);
    let ry = cy + 3;
    const rx = M + ph + 8;
    rows.forEach(([l, v]) => {
      doc.setTextColor(...PDF_MID); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      doc.text(pdfText(l.toUpperCase()), rx, ry, { charSpace: 0.4 });
      doc.setTextColor(...PDF_LIGHT); doc.setFontSize(10);
      doc.text(doc.splitTextToSize(pdfText(v), W - rx - M)[0], rx, ry + 4.5);
      ry += 10;
    });
    cy = Math.max(cy + ph, ry) + 8;

    const log = (w.serviceLog || []).slice(0, 12);
    if (log.length) {
      doc.setTextColor(...PDF_GOLD_L); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.text(pdfText(t('HISTORIAL DE MANTENIMIENTO')), M, cy, { charSpace: 1.2 });
      cy += 6;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      for (const e of log) {
        if (cy > H - 20) break;
        doc.setTextColor(...PDF_MID); doc.text(pdfText(formatDate(e.date)), M, cy);
        doc.setTextColor(...PDF_LIGHT);
        doc.text(doc.splitTextToSize(pdfText(t(KIND_LABELS[e.kind]) + (e.note ? ` · ${e.note}` : '')), 110)[0], M + 32, cy);
        if (typeof e.cost === 'number') doc.text(pdfText(money(e.cost, { decimals: 0 })), W - M, cy, { align: 'right' });
        cy += 6;
      }
      const sc = serviceCost(w);
      if (sc) { doc.setTextColor(...PDF_MID); doc.setFontSize(8); doc.text(pdfText(`${t('Total en mantenimiento')}: ${amount(sc)}`), W - M, cy + 1, { align: 'right' }); cy += 8; }
    }
    if (w.notes && cy < H - 30) {
      doc.setTextColor(...PDF_GOLD_L); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.text(pdfText(t('NOTAS')), M, cy + 2, { charSpace: 1.2 });
      doc.setTextColor(...PDF_LIGHT); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.text(doc.splitTextToSize(pdfText(w.notes), W - 2 * M).slice(0, 8), M, cy + 8);
    }
  }

  const filename = `${t('rotor-inventario-seguro')}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
  showToast(t('PDF descargado'));
  return filename;
}
