/**
 * export.js — PDF export of the entire watch collection
 * Uses jsPDF (loaded from CDN) — runs 100% in the browser, no server needed.
 *
 * generateCollectionPDF()
 *   → one cover page + one full-page card per watch
 *   → each card: photo, specs table, wear history, price
 *   → triggers browser download / share sheet on mobile
 */

const PDF_DARK    = [13,  13,  13];   // #0D0D0D
const PDF_DARK2   = [26,  26,  26];   // #1A1A1A
const PDF_DARK3   = [42,  42,  42];   // #2A2A2A
const PDF_GOLD    = [184, 150, 62];   // #B8963E
const PDF_GOLD_L  = [212, 175, 106];  // #D4AF6A
const PDF_LIGHT   = [232, 226, 216];  // #E8E2D8
const PDF_MID     = [120, 120, 120];
const PDF_GREEN   = [76,  175, 80];
const PDF_WHITE   = [250, 248, 244];

async function generateCollectionPDF() {
  // Dynamic load jsPDF from CDN if not already present
  if (typeof window.jspdf === 'undefined') {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  }

  const { jsPDF } = window.jspdf;
  const ws = getWatches();

  if (!ws.length) {
    showToast('No hay relojes en la colección');
    return;
  }

  showToast('Generando PDF…');

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
  const filename = `horlogerie-coleccion-${new Date().toISOString().slice(0,10)}.pdf`;
  doc.save(filename);
  showToast('PDF descargado');
}

/* ════════════════════════════════════════
   COVER PAGE
════════════════════════════════════════ */
function drawCover(doc, ws, W, H) {
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
  doc.text('HORLOGERIE', W / 2, 80, { align: 'center', charSpace: 5 });

  doc.setFillColor(...PDF_GOLD);
  doc.rect(W / 2 - 30, 88, 60, 0.5, 'F');

  doc.setTextColor(...PDF_MID);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('Colección Personal de Relojes', W / 2, 97, { align: 'center', charSpace: 1.5 });

  // Stats block
  const totalSessions = ws.reduce((a, w) => a + (w.history?.length || 0) + (w.wearStart ? 1 : 0), 0);
  const totalDays     = ws.reduce((a, w) => {
    const all = [...(w.history || [])];
    if (w.wearStart) all.push({ start: w.wearStart, end: Date.now() });
    return a + all.reduce((s, i) => s + Math.max(1, Math.ceil((i.end - i.start) / 86400000)), 0);
  }, 0);
  const autoCount  = ws.filter(w => w.type === 'automatic').length;
  const quartzCount = ws.filter(w => w.type === 'quartz').length;
  const manualCount = ws.filter(w => w.type === 'manual').length;

  const stats = [
    { label: 'Relojes',       value: String(ws.length) },
    { label: 'Automáticos',   value: String(autoCount) },
    { label: 'Cuarzo',        value: String(quartzCount) },
    { label: 'Días de uso',   value: String(totalDays) },
    { label: 'Sesiones',      value: String(totalSessions) },
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
  doc.text('ÍNDICE DE RELOJES', W / 2, cy, { align: 'center', charSpace: 2 });
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
    const typeStr = w.type === 'automatic' ? 'Auto' : w.type === 'quartz' ? 'Quartz' : 'Manual';
    doc.text(typeStr, W - px - 2, cy + 0.5, { align: 'right' });
    cy += 10;
  });

  // Footer
  doc.setTextColor(...PDF_MID);
  doc.setFontSize(8);
  doc.text(`Generado el ${new Date().toLocaleDateString('es-ES', { day:'2-digit', month:'long', year:'numeric' })}`, W / 2, H - 12, { align: 'center' });
  doc.setFillColor(...PDF_GOLD);
  doc.rect(0, H - 2, W, 2, 'F');
}

/* ════════════════════════════════════════
   WATCH PAGE
════════════════════════════════════════ */
async function drawWatchPage(doc, w, pageNum, total, W, H) {
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
    doc.text(`Ref. ${w.ref}`, 14, cy + 7);
    cy += 7;
  }
  cy += 5;

  // Type badge
  const typeLabel = w.type === 'automatic' ? 'AUTOMÁTICO' : w.type === 'quartz' ? 'CUARZO' : 'CUERDA MANUAL';
  doc.setFillColor(...PDF_DARK3);
  doc.roundedRect(14, cy - 4, 30, 6, 1.5, 1.5, 'F');
  doc.setDrawColor(...PDF_GOLD);
  doc.setLineWidth(0.3);
  doc.roundedRect(14, cy - 4, 30, 6, 1.5, 1.5, 'S');
  doc.setTextColor(...PDF_GOLD_L);
  doc.setFontSize(6.5);
  doc.text(typeLabel, 29, cy + 0.2, { align: 'center', charSpace: 0.8 });
  cy += 8;

  // Gold separator
  doc.setFillColor(...PDF_GOLD);
  doc.rect(14, cy, W - 28, 0.3, 'F');
  cy += 6;

  /* ── Photo (left column) ── */
  const photoW = 72, photoH = 72;
  const photoX = 14;
  const photoY = cy;

  if (w.photo) {
    try {
      doc.setFillColor(...PDF_DARK2);
      doc.roundedRect(photoX, photoY, photoW, photoH, 3, 3, 'F');
      doc.addImage(w.photo, 'JPEG', photoX, photoY, photoW, photoH, undefined, 'MEDIUM');
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
    { k: 'calibre',     l: 'Calibre' },
    { k: 'movimiento',  l: 'Movimiento' },
    { k: 'cristal',     l: 'Cristal' },
    { k: 'brazalete',   l: 'Brazalete' },
    { k: 'esfera',      l: 'Esfera' },
    { k: 'caja',        l: 'Caja' },
    { k: 'resistencia', l: 'Agua' },
    { k: 'reserva',     l: 'Reserva' },
    { k: 'diametro',    l: 'Diámetro' },
    { k: 'grosor',      l: 'Grosor' },
  ].filter(s => specs[s.k]);

  if (specDefs.length) {
    doc.setTextColor(...PDF_GOLD);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('ESPECIFICACIONES', specX, sy + 4, { charSpace: 1.5 });
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
    doc.text('Sin especificaciones.', specX, sy + 10);
    doc.setFontSize(7);
    doc.text('Usa "Buscar información" en la app.', specX, sy + 18);
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
    doc.text('PRECIO DE MERCADO', 20, cy + 5, { charSpace: 1 });
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
    const d = Math.max(1, Math.ceil((Date.now() - w.wearStart) / 86400000));
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
    doc.text('PUESTO ACTUALMENTE', 25, cy + 7, { charSpace: 1 });
    doc.setTextColor(...PDF_LIGHT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Día ${d} · Desde el ${formatDate(w.wearStart)}`, W - 20, cy + 7, { align: 'right' });
    cy += 18;
  }

  /* ── History ── */
  const allIntervals = [...(w.history || [])];
  if (w.wearStart) allIntervals.push({ start: w.wearStart, end: Date.now(), active: true });

  if (allIntervals.length) {
    doc.setTextColor(...PDF_GOLD);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('HISTORIAL DE USO', 14, cy + 4, { charSpace: 1.5 });
    cy += 8;

    const totalSess = allIntervals.length;
    const totalD    = allIntervals.reduce((a, i) => a + Math.max(1, Math.ceil(((i.end || Date.now()) - i.start) / 86400000)), 0);

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
    doc.text('SESIONES', 14 + (W - 28) / 4, cy + 7 + 5, { align: 'center', charSpace: 0.8 });
    doc.text('DÍAS TOTALES', 14 + (W - 28) * 3 / 4 + 2, cy + 7 + 5, { align: 'center', charSpace: 0.8 });
    cy += 18;

    // Last 8 intervals (most recent first)
    const recent = [...allIntervals].reverse().slice(0, 8);
    recent.forEach((interval, idx) => {
      if (cy > H - 20) return;
      const d2 = Math.max(1, Math.ceil(((interval.end || Date.now()) - interval.start) / 86400000));
      const bg = idx % 2 === 0 ? PDF_DARK2 : PDF_DARK3;
      doc.setFillColor(...bg);
      doc.rect(14, cy - 3, W - 28, 7, 'F');
      doc.setTextColor(interval.active ? PDF_GREEN : PDF_MID);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', interval.active ? 'bold' : 'normal');
      doc.text(formatDate(interval.start), 18, cy + 1.5);
      doc.setTextColor(...PDF_MID);
      doc.text('→', 70, cy + 1.5, { align: 'center' });
      doc.text(interval.active ? 'hoy' : formatDate(interval.end), 80, cy + 1.5);
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
      doc.text('NOTAS', 14, cy, { charSpace: 1.5 });
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
  doc.text('Horlogerie · Colección Personal', W / 2, H - 5, { align: 'center' });
}

/* ════════════════════════════════════════
   SUMMARY PAGE
════════════════════════════════════════ */
function drawSummaryPage(doc, ws, W, H) {
  doc.setFillColor(...PDF_DARK);
  doc.rect(0, 0, W, H, 'F');
  doc.setFillColor(...PDF_GOLD);
  doc.rect(0, 0, W, 1.5, 'F');

  let cy = 22;
  doc.setTextColor(...PDF_GOLD_L);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('RESUMEN DE COLECCIÓN', W / 2, cy, { align: 'center', charSpace: 3 });
  cy += 4;
  doc.setFillColor(...PDF_GOLD);
  doc.rect(W / 2 - 25, cy, 50, 0.3, 'F');
  cy += 10;

  // Table header
  const cols = [14, 50, 90, 120, 148, 175];
  const headers = ['RELOJ', 'REFERENCIA', 'TIPO', 'CALIBRE', 'DÍAS', 'PRECIO'];
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
    const allIntervals = [...(w.history || [])];
    if (w.wearStart) allIntervals.push({ start: w.wearStart, end: Date.now() });
    const totalD = allIntervals.reduce((a, iv) =>
      a + Math.max(1, Math.ceil(((iv.end || Date.now()) - iv.start) / 86400000)), 0);

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

    const typeStr = w.type === 'automatic' ? 'Auto' : w.type === 'quartz' ? 'Quartz' : 'Manual';
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
  doc.text(`Horlogerie · ${new Date().toLocaleDateString('es-ES', { day:'2-digit', month:'long', year:'numeric' })}`, W / 2, H - 5, { align: 'center' });
}

/* ════════════════════════════════════════
   HELPERS
════════════════════════════════════════ */

function drawNoPhoto(doc, x, y, w, h) {
  doc.setFillColor(...PDF_DARK2);
  doc.roundedRect(x, y, w, h, 3, 3, 'F');
  doc.setDrawColor(...PDF_GOLD);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, h, 3, 3, 'S');
  doc.setTextColor(...PDF_MID);
  doc.setFontSize(22);
  doc.text('⌚', x + w / 2, y + h / 2 + 4, { align: 'center' });
  doc.setFontSize(7);
  doc.text('Sin foto', x + w / 2, y + h / 2 + 12, { align: 'center' });
}

function roundedRect(doc, x, y, w, h, r, fillColor) {
  doc.setFillColor(...fillColor);
  doc.roundedRect(x, y, w, h, r, r, 'F');
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

window.generateCollectionPDF = generateCollectionPDF;
