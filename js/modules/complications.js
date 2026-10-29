/* ─── Complicaciones: moon phase and accuracy measurement (both free; the accuracy history is Pro) ─── */
import { accuracyStats, addAccuracyReading, getActiveWatch, getWatch, getWatches, hasMoonPhase, moonAt, moonClicks } from '../storage.js';
import { isPro } from '../billing.js';
import { locale, t, tk } from '../i18n.js';
import { escHtml, showToast } from './core.js';
import { fmtRate } from './care.js';
import { bindProTeasers, proTeaser } from './pro.js';
import { openDetail } from './home-detail.js';

const DAY_MS = 86400000;
const PHASE_NAMES = {
  'new': tk('Luna nueva'), 'waxing-crescent': tk('Creciente'), 'first-quarter': tk('Cuarto creciente'),
  'waxing-gibbous': tk('Gibosa creciente'), 'full': tk('Luna llena'), 'waning-gibbous': tk('Gibosa menguante'),
  'last-quarter': tk('Cuarto menguante'), 'waning-crescent': tk('Menguante'),
};
const name = w => `${escHtml(w.brand)} ${escHtml(w.model)}`;
const dayMonth = ms => new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'long' });
const num1 = n => n.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function renderComplications() {
  const box = document.getElementById('complications-body');
  if (!box) return;
  box.innerHTML = `<section class="cx-card cx-moon" id="cx-moon" aria-labelledby="cx-moon-t"></section>
    <section class="cx-card cx-acc" id="cx-acc" aria-labelledby="cx-acc-t"></section>`;
  renderMoon();
  renderAccuracy();
}

/* ══ Moon phase ══ */
/** SVG of the moon as a watch subdial: the lit part drawn as seen from the northern hemisphere,
    and an outer «age of the moon» ring (0–29½ days) with a hand */
export function moonDial(m, size = 148) {
  const c = 74, r = 40, R = 62;
  const f = m.fraction;
  const rx = Math.abs(Math.cos(2 * Math.PI * f)) * r;
  const gibbous = m.illumination > 0.5;
  // Lit area: half the disc on the lit side plus (gibbous) or minus (crescent) the terminator ellipse
  const lit = m.waxing
    ? `M${c} ${c - r} A${r} ${r} 0 0 1 ${c} ${c + r} A${rx} ${r} 0 0 ${gibbous ? 1 : 0} ${c} ${c - r}Z`
    : `M${c} ${c - r} A${r} ${r} 0 0 0 ${c} ${c + r} A${rx} ${r} 0 0 ${gibbous ? 0 : 1} ${c} ${c - r}Z`;
  const ticks = Array.from({ length: 30 }, (_, i) => {
    const a = (i / 29.53) * 2 * Math.PI - Math.PI / 2, long = i % 5 === 0;
    const r1 = R + (long ? 2 : 4), r2 = R + 9;
    return `<line x1="${(c + r1 * Math.cos(a)).toFixed(2)}" y1="${(c + r1 * Math.sin(a)).toFixed(2)}" x2="${(c + r2 * Math.cos(a)).toFixed(2)}" y2="${(c + r2 * Math.sin(a)).toFixed(2)}" class="${long ? 'cx-tick-l' : 'cx-tick'}"/>`;
  }).join('');
  const ha = (m.age / 29.53) * 2 * Math.PI - Math.PI / 2;
  // Age of the moon: a small gold index on the outer ring, as on a moon-age subdial
  const pt = (rr, da = 0) => `${(c + rr * Math.cos(ha + da)).toFixed(2)},${(c + rr * Math.sin(ha + da)).toFixed(2)}`;
  const hand = `<polygon points="${pt(R + 1)} ${pt(R + 10, 0.07)} ${pt(R + 10, -0.07)}" class="cx-hand"/>`;
  const stars = [[30, 46, 1.1], [112, 40, .9], [118, 104, 1.2], [36, 108, .8], [58, 26, .7], [96, 122, .7]]
    .map(([x, y, s]) => `<circle cx="${x}" cy="${y}" r="${s}" class="cx-star"/>`).join('');
  return `<svg class="cx-dial" viewBox="0 0 148 148" width="${size}" height="${size}" role="img" aria-label="${escHtml(t(PHASE_NAMES[m.phase]))}">
    <defs><radialGradient id="cxSky" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#1F2C4C"/><stop offset="1" stop-color="#0B1220"/></radialGradient>
      <radialGradient id="cxLit" cx="40%" cy="38%" r="70%"><stop offset="0" stop-color="#F6EBC8"/><stop offset="1" stop-color="#CDB57A"/></radialGradient></defs>
    <circle cx="${c}" cy="${c}" r="${R + 10}" class="cx-bezel"/>
    <circle cx="${c}" cy="${c}" r="${R}" fill="url(#cxSky)"/>${stars}
    <circle cx="${c}" cy="${c}" r="${r}" class="cx-dark"/>
    ${m.illumination > 0.004 ? `<path d="${lit}" fill="url(#cxLit)"/>` : ''}
    ${ticks}${hand}
  </svg>`;
}

function renderMoon() {
  const el = document.getElementById('cx-moon');
  if (!el) return;
  const now = Date.now(), m = moonAt(now), clicks = moonClicks(now);
  const mine = getWatches().filter(hasMoonPhase);
  el.innerHTML = `
    <div class="cx-eyebrow" id="cx-moon-t">${t('Fase lunar')}</div>
    <div class="cx-moon-main">
      ${moonDial(m)}
      <div class="cx-moon-txt">
        <div class="cx-big">${t(PHASE_NAMES[m.phase])}</div>
        <div class="cx-sub">${t('Día {d} de 29½', { d: Math.floor(m.age) + 1 })}</div>
        <div class="cx-sub">${t('{p} % iluminada', { p: Math.round(m.illumination * 100) })}</div>
      </div>
    </div>
    <dl class="cx-dates">
      <div><dt>${t('Próxima luna llena')}</dt><dd>${dayMonth(m.nextFull)}</dd></div>
      <div><dt>${t('Próxima luna nueva')}</dt><dd>${dayMonth(m.nextNew)}</dd></div>
    </dl>
    <div class="cx-set">
      <div class="cx-set-h">${t('Ajustar tu reloj')}</div>
      <p>${t('Lleva el disco a luna llena y avanza')} <b class="cx-clicks">${clicks === 1 ? t('1 clic') : t('{n} clics', { n: clicks })}</b>.</p>
      <small>${t('Uno por día desde la luna llena del {d}.', { d: dayMonth(m.lastFull) })}</small>
      ${mine.length ? `<small class="cx-mine"><i class="ti ti-moon" aria-hidden="true"></i> ${t('Con fase lunar en tu colección')}: ${mine.map(name).join(' · ')}</small>` : ''}
    </div>
    <div class="cx-foot">${t('Calculada en tu móvil, sin conexión.')}</div>`;
}

/* ══ Accuracy: tap when the seconds hand reaches 12 ══ */
const SEL_KEY = 'rotor_cx_watch';
let _timer = null;
let _tap = null;            // { ts, minute } after «Ahora»
function pickWatch(ws) {
  let id = null;
  try { id = localStorage.getItem(SEL_KEY); } catch {}
  return ws.find(w => w.id === id) || getActiveWatch() || ws.find(w => w.type !== 'quartz') || ws[0];
}
function stopClock() { clearInterval(_timer); _timer = null; }
function startClock(el) {
  stopClock();
  const tick = () => {
    if (!document.getElementById('view-complications')?.classList.contains('active') || !el.isConnected) { stopClock(); return; }
    const d = new Date();
    el.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    el.dataset.tenth = String(Math.floor(d.getMilliseconds() / 100));
  };
  tick();
  _timer = setInterval(tick, 50);
}

function renderAccuracy() {
  const el = document.getElementById('cx-acc');
  if (!el) return;
  const ws = getWatches();
  if (!ws.length) {
    el.innerHTML = `<div class="cx-eyebrow" id="cx-acc-t">${t('Precisión')}</div>
      <p class="cx-empty">${t('Añade un reloj a tu colección para medir cuánto adelanta o atrasa.')}</p>`;
    return;
  }
  const w = pickWatch(ws);
  el.innerHTML = `
    <div class="cx-eyebrow" id="cx-acc-t">${t('Precisión')}</div>
    <label class="cx-label" for="cx-watch">${t('Reloj')}</label>
    <select class="form-input form-select cx-select" id="cx-watch">${ws.map(x => `<option value="${escHtml(x.id)}"${x.id === w.id ? ' selected' : ''}>${name(x)}</option>`).join('')}</select>
    <div id="cx-acc-stage"></div>`;
  el.querySelector('#cx-watch').addEventListener('change', e => {
    try { localStorage.setItem(SEL_KEY, e.target.value); } catch {}
    _tap = null;
    renderStage(e.target.value);
  });
  renderStage(w.id);
}

function lastRateText(w) {
  const st = accuracyStats(w);
  if (st.last === null) return '';
  return `<div class="cx-prev">${t('Última media de este reloj')}: <b>${fmtRate(st.avg ?? st.last, w.type === 'quartz')}</b></div>`;
}

function renderStage(id) {
  const st = document.getElementById('cx-acc-stage');
  const w = getWatch(id);
  if (!st || !w) return;
  if (!_tap) {
    st.innerHTML = `
      <div class="cx-clock" aria-live="off"><span id="cx-time">--:--:--</span><small>${t('Hora del móvil')}</small></div>
      <p class="cx-how">${t('Mira el segundero y toca justo cuando pase por las 12.')}</p>
      <button class="cx-now" id="cx-now">${t('Ahora')}</button>
      ${lastRateText(w)}
      ${historyLink(w)}
      <p class="cx-note">${t('Rotor usa la hora del móvil, que se sincroniza por red. Tu tiempo de reacción se repite en cada medición, así que el ritmo en segundos al día sale bien.')}</p>`;
    startClock(st.querySelector('#cx-time'));
    st.querySelector('#cx-now').addEventListener('click', () => {
      const ts = Date.now();
      _tap = { ts, minute: Math.round(ts / 60000) * 60000, id };
      stopClock();
      renderStage(id);
    });
    bindHistory(st, w);
    return;
  }
  // Result: which minute did the watch show? (nearest one proposed)
  const tap = _tap;
  const offset = (tap.minute - tap.ts) / 1000;            // + = the watch is ahead
  const quartz = w.type === 'quartz';
  // Rate against the latest saved reading (same rule as the Pro history: at least 12 h apart)
  const prev = [...(w.accuracy || [])].sort((a, b) => a.ts - b.ts).filter(r => r.ts < tap.ts).pop();
  const days = prev ? (tap.ts - prev.ts) / DAY_MS : 0;
  const rate = prev && days >= 0.5 ? { rate: (offset - (prev.setAfter ? 0 : prev.offset)) / days } : null;
  const hm = new Date(tap.minute);
  st.innerHTML = `
    <div class="cx-minute">
      <span>${t('Tu reloj marcaba')}</span>
      <div class="cx-stepper">
        <button class="cx-step" id="cx-minus" aria-label="${t('Un minuto menos')}"><i class="ti ti-minus" aria-hidden="true"></i></button>
        <b>${String(hm.getHours()).padStart(2, '0')}:${String(hm.getMinutes()).padStart(2, '0')}:00</b>
        <button class="cx-step" id="cx-plus" aria-label="${t('Un minuto más')}"><i class="ti ti-plus" aria-hidden="true"></i></button>
      </div>
    </div>
    <div class="cx-result">
      <div class="cx-offset">${offset > 0 ? '+' : offset < 0 ? '−' : '±'}${num1(Math.abs(offset))} s</div>
      <div class="cx-sub">${Math.abs(offset) < 0.05 ? t('en hora exacta') : offset > 0 ? t('adelanta respecto a la hora exacta') : t('atrasa respecto a la hora exacta')}</div>
      ${rate ? `<div class="cx-rate">${fmtRate(rate.rate, quartz)}<small>${t('desde tu medición del {d}', { d: dayMonth(prev.ts) })}</small></div>`
        : `<div class="cx-sub2">${t('Vuelve a medirlo dentro de uno o varios días y verás cuántos segundos gana o pierde al día.')}</div>`}
    </div>
    <label class="check-row"><input type="checkbox" id="cx-set"> ${t('Después lo pongo en hora')}</label>
    <div class="cx-actions">
      <button class="modal-btn modal-btn-cancel" id="cx-again">${t('Repetir')}</button>
      <button class="modal-btn modal-btn-save" id="cx-save">${t('Guardar medición')}</button>
    </div>
    ${historyLink(w)}`;
  st.querySelector('#cx-minus').addEventListener('click', () => { tap.minute -= 60000; renderStage(id); });
  st.querySelector('#cx-plus').addEventListener('click', () => { tap.minute += 60000; renderStage(id); });
  st.querySelector('#cx-again').addEventListener('click', () => { _tap = null; renderStage(id); });
  st.querySelector('#cx-save').addEventListener('click', () => {
    if (!addAccuracyReading(id, { ts: tap.ts, offset, setAfter: st.querySelector('#cx-set').checked })) {
      showToast(t('No se ha podido guardar')); return;
    }
    _tap = null;
    showToast(t('Medición guardada'));
    renderStage(id);
  });
  bindHistory(st, w);
}

/* The history of every reading, with averages: Rotor Pro (it lives in the watch's Mantenimiento tab) */
function historyLink(w) {
  const n = (w.accuracy || []).length;
  if (isPro()) {
    return n ? `<button class="cx-link" id="cx-history"><i class="ti ti-chart-line" aria-hidden="true"></i> ${t('Ver el historial de precisión')} (${n})<i class="ti ti-chevron-right" aria-hidden="true"></i></button>` : '';
  }
  return `<div class="cx-pro">${proTeaser(t('Historial de precisión'), t('Todas las mediciones de cada reloj y su media en segundos al día.'), 'ti-chart-line')}</div>`;
}
function bindHistory(root, w) {
  root.querySelector('#cx-history')?.addEventListener('click', () => openDetail(w.id, 'maint'));
  bindProTeasers(root);
}
