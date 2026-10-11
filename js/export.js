/**
 * export.js — PDF export of the entire watch collection
 * Uses jsPDF 2.5.1 (bundled in js/vendor, MIT) — runs 100% in the browser, offline.
 *
 * generateCollectionPDF()
 *   → one cover page + one full-page card per watch
 *   → each card: photo, specs table, wear history, price
 *   → triggers browser download / share sheet on mobile
 */

import { calendarDaysBetween, getWatches, isSafePhoto, wearIntervals, wearStats } from './storage.js';
import { formatDate, showToast, typeLabel } from './modules/core.js';
import { locale, t } from './i18n.js';

// Paleta «esfera crema» (misma que el tema claro de la app; imprime bien)
export const PDF_DARK    = [251, 248, 241];  // fondo de página  #FBF8F1
export const PDF_DARK2   = [243, 238, 227];  // tarjetas          #F3EEE3
export const PDF_DARK3   = [232, 225, 210];  // líneas y rellenos #E8E1D2
export const PDF_GOLD    = [184, 150, 62];   // #B8963E
export const PDF_GOLD_L  = [126, 97,  24];   // dorado para texto #7E6118
export const PDF_LIGHT   = [30,  27,  22];   // texto             #1E1B16
export const PDF_MID     = [101, 93,  81];   // texto secundario  #655D51
export const PDF_GREEN   = [46,  125, 50];
export const PDF_WHITE   = [250, 248, 244];

export async function generateCollectionPDF() {
  // jsPDF is bundled with the app (js/vendor) and loaded only when needed
  if (typeof window.jspdf === 'undefined') {
    await loadScript('./js/vendor/jspdf-2.5.1.umd.min.js');
  }

  const { jsPDF } = window.jspdf;
  const ws = getWatches();

  if (!ws.length) {
    showToast(t('No hay relojes en la colección'));
    return;
  }

  showToast(t('Generando PDF…'));

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210; // A4 width
  const H = 297; // A4 height

  /* ── Cover page ── */
  drawCover(doc, ws, W, H);

  /* ── One page per watch ── */
  for (let i = 0; i < ws.length; i++) {
    doc.addPage();
    await drawWatchPage(doc, ws[i], i + 1, ws.length, W, H);
  }

  /* ── Summary page ── */
  doc.addPage();
  drawSummaryPage(doc, ws, W, H);

  /* ── Download ── */
  const filename = `${t('rotor-coleccion')}-${new Date().toISOString().slice(0,10)}.pdf`;
  doc.save(filename);
  showToast(t('PDF descargado'));
}

/* ════════════════════════════════════════
   COVER PAGE
════════════════════════════════════════ */
export function drawCover(doc, ws, W, H) {
  // Background
  doc.setFillColor(...PDF_DARK);
  doc.rect(0, 0, W, H, 'F');

  // Top gold line
  doc.setFillColor(...PDF_GOLD);
  doc.rect(0, 0, W, 2, 'F');

  // Logo / title
  doc.setTextColor(...PDF_GOLD_L);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(42);
  doc.text('ROTOR', W / 2, 80, { align: 'center', charSpace: 5 });

  doc.setFillColor(...PDF_GOLD);
  doc.rect(W / 2 - 30, 88, 60, 0.5, 'F');

  doc.setTextColor(...PDF_MID);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(t('Colección Personal de Relojes'), W / 2, 97, { align: 'center', charSpace: 1.5 });

  // Stats block
  const totalSessions = ws.reduce((a, w) => a + wearStats(w).sessions, 0);
  const totalDays     = ws.reduce((a, w) => a + wearStats(w).daysWorn, 0);
  const autoCount  = ws.filter(w => w.type === 'automatic').length;
  const quartzCount = ws.filter(w => w.type === 'quartz').length;

  const stats = [
    { label: t('Relojes'),       value: String(ws.length) },
    { label: t('Automáticos'),   value: String(autoCount) },
    { label: t('Cuarzo'),        value: String(quartzCount) },
    { label: t('Días de uso'),   value: String(totalDays) },
    { label: t('Sesiones'),      value: String(totalSessions) },
  ];

  const bw = 34, bh = 28, bx0 = (W - stats.length * bw - (stats.length - 1) * 4) / 2;
  stats.forEach((s, i) => {
    const bx = bx0 + i * (bw + 4);
    const by = 118;
    doc.setFillColor(...PDF_DARK2);
    roundedRect(doc, bx, by, bw, bh, 2, PDF_DARK2);
    doc.setDrawColor(...PDF_GOLD);
    doc.setLineWidth(0.3);
    doc.roundedRect(bx, by, bw, bh, 2, 2, 'S');
    doc.setTextColor(...PDF_GOLD_L);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(s.value, bx + bw / 2, by + 12, { align: 'center' });
    doc.setTextColor(...PDF_MID);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(s.label.toUpperCase(), bx + bw / 2, by + 21, { align: 'center', charSpace: 0.8 });
  });

  // Watch list index
  let cy = 170;
  doc.setTextColor(...PDF_GOLD);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(t('ÍNDICE DE RELOJES'), W / 2, cy, { align: 'center', charSpace: 2 });
  cy += 6;
  doc.setFillColor(...PDF_GOLD);
  doc.rect(W / 2 - 20, cy, 40, 0.3, 'F');
  cy += 8;

  ws.forEach((w, i) => {
    const px = 40;
    const active = !!w.wearStart;
    doc.setFillColor(...PDF_DARK2);
    doc.rect(px, cy - 4, W - px * 2, 8, 'F');
    if (active) { doc.setFillColor(...PDF_GREEN); doc.circle(px + 3, cy, 1.5, 'F'); }
    doc.setTextColor(...PDF_GOLD_L);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`${i + 1}.`, px + 8, cy + 0.5);
    doc.setTextColor(...PDF_LIGHT);
    doc.setFont('helvetica', 'normal');
    doc.text(`${w.brand} ${w.model}${w.ref ? ` · ${w.ref}` : ''}`, px + 16, cy + 0.5);
    doc.setTextColor(...PDF_MID);
    doc.setFontSize(7.5);
    const typeStr = typeLabel(w.type);
    doc.text(typeStr, W - px - 2, cy + 0.5, { align: 'right' });
    cy += 10;
  });

  // Footer
  doc.setTextColor(...PDF_MID);
  doc.setFontSize(8);
  doc.text(`${t('Generado el')} ${new Date().toLocaleDateString(locale(), { day:'2-digit', month:'long', year:'numeric' })}`, W / 2, H - 12, { align: 'center' });
  doc.setFillColor(...PDF_GOLD);
  doc.rect(0, H - 2, W, 2, 'F');
}

/* ════════════════════════════════════════
   WATCH PAGE
════════════════════════════════════════ */
export async function drawWatchPage(doc, w, pageNum, total, W, H) {
  // Background
  doc.setFillColor(...PDF_DARK);
  doc.rect(0, 0, W, H, 'F');
  doc.setFillColor(...PDF_GOLD);
  doc.rect(0, 0, W, 1.5, 'F');

  // Page number
  doc.setTextColor(...PDF_MID);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`${pageNum} / ${total}`, W - 12, 8, { align: 'right' });

  // Brand & Model header
  let cy = 18;
  doc.setTextColor(...PDF_GOLD_L);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(w.brand.toUpperCase(), 14, cy, { charSpace: 2 });
  cy += 7;
  doc.setTextColor(...PDF_LIGHT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(w.model, 14, cy);
  if (w.ref) {
    doc.setTextColor(...PDF_MID);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`${t('Ref.')} ${w.ref}`, 14, cy + 7);
    cy += 7;
  }
  cy += 5;

  // Type badge
  const typeTag = (w.type === 'manual' ? t('Cuerda manual') : typeLabel(w.type)).toUpperCase();
  doc.setFillColor(...PDF_DARK3);
  doc.roundedRect(14, cy - 4, 30, 6, 1.5, 1.5, 'F');
  doc.setDrawColor(...PDF_GOLD);
  doc.setLineWidth(0.3);
  doc.roundedRect(14, cy - 4, 30, 6, 1.5, 1.5, 'S');
  doc.setTextColor(...PDF_GOLD_L);
  doc.setFontSize(6.5);
  doc.text(typeTag, 29, cy + 0.2, { align: 'center', charSpace: 0.8 });
  cy += 8;

  // Gold separator
  doc.setFillColor(...PDF_GOLD);
  doc.rect(14, cy, W - 28, 0.3, 'F');
  cy += 6;

  /* ── Photo (left column) ── */
  const photoW = 72, photoH = 72;
  const photoX = 14;
  const photoY = cy;

  const jpeg = isSafePhoto(w.photo) ? await photoToSquareJpeg(w.photo, 600) : null;
  if (jpeg) {
    try {
      doc.setFillColor(...PDF_DARK2);
      doc.roundedRect(photoX, photoY, photoW, photoH, 3, 3, 'F');
      doc.addImage(jpeg, 'JPEG', photoX, photoY, photoW, photoH, undefined, 'MEDIUM');
      // Rounded border
      doc.setDrawColor(...PDF_GOLD);
      doc.setLineWidth(0.4);
      doc.roundedRect(photoX, photoY, photoW, photoH, 3, 3, 'S');
    } catch(e) {
      drawNoPhoto(doc, photoX, photoY, photoW, photoH);
    }
  } else {
    drawNoPhoto(doc, photoX, photoY, photoW, photoH);
  }

  /* ── Specs (right column) ── */
  const specX = photoX + photoW + 8;
  const specW = W - specX - 14;
  let sy = photoY;

  const specs = w.specs || {};
  const specDefs = [
    { k: 'calibre',     l: t('Calibre') },
    { k: 'movimiento',  l: t('Movimiento') },
    { k: 'cristal',     l: t('Cristal') },
    { k: 'brazalete',   l: t('Brazalete') },
    { k: 'esfera',      l: t('Esfera') },
    { k: 'caja',        l: t('Caja') },
    { k: 'resistencia', l: t('Agua') },
    { k: 'reserva',     l: t('Reserva') },
    { k: 'diametro',    l: t('Diámetro') },
    { k: 'grosor',      l: t('Grosor') },
    { k: 'asas',        l: t('Entre asas') },
  ].filter(s => specs[s.k]);

  if (specDefs.length) {
    doc.setTextColor(...PDF_GOLD);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(t('ESPECIFICACIONES'), specX, sy + 4, { charSpace: 1.5 });
    sy += 8;

    specDefs.forEach(s => {
      doc.setFillColor(...PDF_DARK2);
      doc.rect(specX, sy - 3, specW, 8, 'F');
      doc.setTextColor(...PDF_MID);
      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'normal');
      doc.text(s.l.toUpperCase(), specX + 2, sy + 1.5, { charSpace: 0.5 });
      doc.setTextColor(...PDF_LIGHT);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      const val = doc.splitTextToSize(specs[s.k], specW - 4);
      doc.text(val[0], specX + specW - 2, sy + 1.5, { align: 'right' });
      sy += 9;
    });
  } else {
    doc.setTextColor(...PDF_MID);
    doc.setFontSize(8);
    doc.text(t('Sin especificaciones.'), specX, sy + 10);
    doc.setFontSize(7);
    doc.text(t('Se añaden tocando cada campo en la ficha.'), specX, sy + 18);
  }

  cy = photoY + photoH + 8;

  /* ── Price ── */
  if (w.price?.value) {
    doc.setFillColor(...PDF_DARK2);
    doc.roundedRect(14, cy, W - 28, 16, 2, 2, 'F');
    doc.setDrawColor(...PDF_GOLD);
    doc.setLineWidth(0.3);
    doc.roundedRect(14, cy, W - 28, 16, 2, 2, 'S');
    doc.setTextColor(...PDF_GOLD);
    doc.setFontSize(7);
    doc.text(t('PRECIO DE MERCADO'), 20, cy + 5, { charSpace: 1 });
    doc.setTextColor(...PDF_LIGHT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(w.price.value, 20, cy + 12);
    if (w.price.note) {
      doc.setTextColor(...PDF_MID);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      const note = doc.splitTextToSize(w.price.note, W - 28 - 12);
      doc.text(note[0], W - 20, cy + 12, { align: 'right' });
    }
    cy += 22;
  }

  /* ── Wear status ── */
  if (w.wearStart) {
    const d = calendarDaysBetween(w.wearStart, Date.now()) + 1;
    doc.setFillColor(76, 175, 80, 0.1);
    doc.setFillColor(20, 40, 20);
    doc.roundedRect(14, cy, W - 28, 12, 2, 2, 'F');
    doc.setDrawColor(...PDF_GREEN);
    doc.setLineWidth(0.3);
    doc.roundedRect(14, cy, W - 28, 12, 2, 2, 'S');
    doc.setFillColor(...PDF_GREEN);
    doc.circle(20, cy + 6, 2, 'F');
    doc.setTextColor(...PDF_GREEN);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(t('PUESTO ACTUALMENTE'), 25, cy + 7, { charSpace: 1 });
    doc.setTextColor(...PDF_LIGHT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`${t('Día {n}', { n: d })} · ${t('Desde el {d}', { d: formatDate(w.wearStart) })}`, W - 20, cy + 7, { align: 'right' });
    cy += 18;
  }

  /* ── History ── */
  const allIntervals = wearIntervals(w);

  if (allIntervals.length) {
    doc.setTextColor(...PDF_GOLD);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(t('HISTORIAL DE USO'), 14, cy + 4, { charSpace: 1.5 });
    cy += 8;

    const wst       = wearStats(w);
    const totalSess = wst.sessions;
    const totalD    = wst.daysWorn;

    // Mini stats
    doc.setFillColor(...PDF_DARK2);
    doc.rect(14, cy, (W - 28) / 2 - 2, 10, 'F');
    doc.rect(14 + (W - 28) / 2 + 2, cy, (W - 28) / 2 - 2, 10, 'F');
    doc.setTextColor(...PDF_GOLD_L);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(String(totalSess), 14 + (W - 28) / 4, cy + 7, { align: 'center' });
    doc.text(String(totalD),    14 + (W - 28) * 3 / 4 + 2, cy + 7, { align: 'center' });
    doc.setTextColor(...PDF_MID);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text(t('SESIONES'), 14 + (W - 28) / 4, cy + 7 + 5, { align: 'center', charSpace: 0.8 });
    doc.text(t('DÍAS DE USO'), 14 + (W - 28) * 3 / 4 + 2, cy + 7 + 5, { align: 'center', charSpace: 0.8 });
    cy += 18;

    // Last 8 intervals (most recent first)
    const recent = [...allIntervals].reverse().slice(0, 8);
    recent.forEach((interval, idx) => {
      if (cy > H - 20) return;
      const d2 = calendarDaysBetween(interval.start, interval.end || Date.now()) + 1;
      const bg = idx % 2 === 0 ? PDF_DARK2 : PDF_DARK3;
      doc.setFillColor(...bg);
      doc.rect(14, cy - 3, W - 28, 7, 'F');
      doc.setTextColor(...(interval.active ? PDF_GREEN : PDF_MID));
      doc.setFontSize(7.5);
      doc.setFont('helvetica', interval.active ? 'bold' : 'normal');
      doc.text(formatDate(interval.start), 18, cy + 1.5);
      doc.setTextColor(...PDF_MID);
      doc.text('→', 70, cy + 1.5, { align: 'center' });
      doc.text(interval.active ? t('hoy') : formatDate(interval.end), 80, cy + 1.5);
      doc.setTextColor(...PDF_LIGHT);
      doc.setFont('helvetica', 'bold');
      doc.text(`${d2}d`, W - 20, cy + 1.5, { align: 'right' });
      cy += 8;
    });

    if (allIntervals.length > 8) {
      doc.setTextColor(...PDF_MID);
      doc.setFontSize(7);
      doc.text(`+ ${allIntervals.length - 8} sesiones anteriores`, W / 2, cy + 3, { align: 'center' });
    }
  }

  /* ── Notes ── */
  if (w.notes && w.notes.trim()) {
    cy += 6;
    if (cy < H - 24) {
      doc.setTextColor(...PDF_GOLD);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(t('NOTAS'), 14, cy, { charSpace: 1.5 });
      cy += 5;
      doc.setFillColor(...PDF_DARK2);
      const lines = doc.splitTextToSize(w.notes, W - 32);
      const noteH = Math.min(lines.length * 4.5 + 6, 24);
      doc.rect(14, cy, W - 28, noteH, 'F');
      doc.setTextColor(...PDF_LIGHT);
      doc.setFontSize(8);
      lines.slice(0, 4).forEach((line, i) => {
        doc.text(line, 18, cy + 5 + i * 4.5);
      });
    }
  }

  /* ── Footer ── */
  doc.setFillColor(...PDF_GOLD);
  doc.rect(0, H - 1.5, W, 1.5, 'F');
  doc.setTextColor(...PDF_MID);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(t('Rotor · Colección personal'), W / 2, H - 5, { align: 'center' });
}

/* ════════════════════════════════════════
   SUMMARY PAGE
════════════════════════════════════════ */
export function drawSummaryPage(doc, ws, W, H) {
  doc.setFillColor(...PDF_DARK);
  doc.rect(0, 0, W, H, 'F');
  doc.setFillColor(...PDF_GOLD);
  doc.rect(0, 0, W, 1.5, 'F');

  let cy = 22;
  doc.setTextColor(...PDF_GOLD_L);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(t('RESUMEN DE COLECCIÓN'), W / 2, cy, { align: 'center', charSpace: 3 });
  cy += 4;
  doc.setFillColor(...PDF_GOLD);
  doc.rect(W / 2 - 25, cy, 50, 0.3, 'F');
  cy += 10;

  // Table header
  const cols = [14, 50, 90, 120, 148, 175];
  const headers = [t('RELOJ'), t('REFERENCIA'), t('TIPO'), t('CALIBRE'), t('DÍAS'), t('PRECIO')];
  doc.setFillColor(...PDF_DARK2);
  doc.rect(14, cy - 4, W - 28, 9, 'F');
  doc.setTextColor(...PDF_GOLD);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  headers.forEach((h, i) => {
    doc.text(h, cols[i], cy + 1.5, { charSpace: 0.8 });
  });
  cy += 7;
  doc.setFillColor(...PDF_GOLD);
  doc.rect(14, cy - 2, W - 28, 0.3, 'F');
  cy += 2;

  // Rows
  ws.forEach((w, i) => {
    if (cy > H - 30) return;
    const totalD = wearStats(w).daysWorn;

    doc.setFillColor(...(i % 2 === 0 ? PDF_DARK2 : PDF_DARK3));
    doc.rect(14, cy - 3.5, W - 28, 9, 'F');

    if (w.wearStart) {
      doc.setFillColor(...PDF_GREEN);
      doc.rect(14, cy - 3.5, 2, 9, 'F');
    }

    doc.setTextColor(...PDF_LIGHT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const name = `${w.brand} ${w.model}`;
    doc.text(doc.splitTextToSize(name, 34)[0], cols[0] + 4, cy + 1.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_MID);
    doc.text(w.ref || '—', cols[1], cy + 1.5);

    const typeStr = typeLabel(w.type);
    doc.text(typeStr, cols[2], cy + 1.5);

    doc.setTextColor(...PDF_LIGHT);
    const cal = (w.specs?.calibre || '—').slice(0, 22);
    doc.text(cal, cols[3], cy + 1.5);

    doc.setTextColor(...PDF_GOLD_L);
    doc.setFont('helvetica', 'bold');
    doc.text(String(totalD), cols[4], cy + 1.5);

    doc.setTextColor(...PDF_LIGHT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    if (w.price?.value) {
      const price = w.price.value.split('·')[0].trim().slice(0, 20);
      doc.text(price, cols[5], cy + 1.5);
    } else {
      doc.setTextColor(...PDF_MID);
      doc.text('—', cols[5], cy + 1.5);
    }

    cy += 10;
  });

  // Footer
  doc.setFillColor(...PDF_GOLD);
  doc.rect(0, H - 1.5, W, 1.5, 'F');
  doc.setTextColor(...PDF_MID);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(`Rotor · ${new Date().toLocaleDateString(locale(), { day:'2-digit', month:'long', year:'numeric' })}`, W / 2, H - 5, { align: 'center' });
}

/* ════════════════════════════════════════
   HELPERS
════════════════════════════════════════ */

export function drawNoPhoto(doc, x, y, w, h) {
  doc.setFillColor(...PDF_DARK2);
  doc.roundedRect(x, y, w, h, 3, 3, 'F');
  doc.setDrawColor(...PDF_GOLD);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, h, 3, 3, 'S');
  // Drawn dial (helvetica has no watch glyph)
  const cx = x + w / 2, cyy = y + h / 2 - 2, r = Math.min(w, h) * 0.18;
  doc.setDrawColor(...PDF_MID);
  doc.setLineWidth(0.5);
  doc.circle(cx, cyy, r, 'S');
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6, r1 = r * (i % 3 ? 0.82 : 0.72);
    doc.line(cx + r1 * Math.sin(a), cyy - r1 * Math.cos(a), cx + r * 0.9 * Math.sin(a), cyy - r * 0.9 * Math.cos(a));
  }
  doc.line(cx, cyy, cx - r * 0.45, cyy - r * 0.3);
  doc.line(cx, cyy, cx + r * 0.38, cyy - r * 0.62);
  doc.setTextColor(...PDF_MID);
  doc.setFontSize(7);
  doc.text(t('Sin foto'), x + w / 2, y + h / 2 + r + 4, { align: 'center' });
}

export function roundedRect(doc, x, y, w, h, r, fillColor) {
  doc.setFillColor(...fillColor);
  doc.roundedRect(x, y, w, h, r, r, 'F');
}

/**
 * jsPDF 2.5 cannot read WebP (the format photos are stored in) and stretches
 * non-square images. Re-encode as a centre-cropped square JPEG.
 */
export function photoToSquareJpeg(dataUrl, size = 600) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
      const c = document.createElement('canvas');
      c.width = c.height = Math.min(size, side);
      const g = c.getContext('2d');
      g.fillStyle = '#E8E1D2'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, sx, sy, side, side, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// formatDate is defined in core.js (loaded after this file)
export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

