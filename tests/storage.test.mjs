// Pruebas unitarias de la lógica de datos (js/storage.js) en Node, sin navegador.
// Uso: node tests/storage.test.mjs
// Cada caso corre en su propio proceso: así cada uno carga los módulos de
// datos desde cero (los módulos ES no se pueden recargar en el mismo proceso).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cases = [];
const RealDate = Date;
/** Fresh copy of js/storage.js (ES module) with an in-memory localStorage and an optional fixed clock */
async function load(initial = {}, nowTs = null) {
  const store = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  globalThis.window = globalThis;
  globalThis.Date = nowTs === null ? RealDate : class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [nowTs])); }
    static now() { return nowTs; }
  };
  const ctx = await import('../js/storage.js');
  return { ctx, store };
}

let ok = 0, ko = 0;
const t = (name, cond, detail = '') => {
  if (cond) { ok++; console.log('  ✓ ' + name); } else { ko++; console.log('  ✗ ' + name + (detail ? `  [${detail}]` : '')); }
};
const D = 86400000;
const at = (y, m, d, h = 12) => new RealDate(y, m - 1, d, h).getTime();

// ── Carga segura ──
cases.push(async () => {
  const { ctx, store } = await load({ horlogerie_v3: '{esto no es json' });
  t('JSON local dañado: arranca vacío sin perder el original',
    ctx.getWatches().length === 0 && [...store.keys()].some(k => k.startsWith('horlogerie_v3_corrupt_')) &&
    ctx.storageRecovered.includes('horlogerie_v3'));
  const copy = [...store.entries()].find(([k]) => k.startsWith('horlogerie_v3_corrupt_'))[1];
  t('la copia apartada es idéntica al original', copy === '{esto no es json');
});
cases.push(async () => {
  const { ctx } = await load({ horlogerie_v3: JSON.stringify({ no: 'es una lista' }) });
  t('forma incorrecta también se aparta', ctx.storageRecovered.includes('horlogerie_v3'));
});
cases.push(async () => {
  const list = [{ id: 'w1', brand: 'A', model: 'B', history: [] }];
  const { ctx } = await load({ horlogerie_v3: JSON.stringify(list) });
  t('datos correctos se cargan', ctx.getWatches().length === 1 && !ctx.storageRecovered.length);
});

// ── Días de uso ──
cases.push(async () => {
  const { ctx } = await load();
  const w = { id: 'w', history: [{ start: at(2026, 10, 23, 9), end: at(2026, 10, 28, 21) }] };
  const keys = [...ctx.wornDayKeys(w)];
  t('un rango cuenta cada día una vez, también al cambiar la hora (25 oct)', keys.length === 6 && keys[0] === '2026-10-23' && keys[5] === '2026-10-28', keys.join(','));
  const w2 = { id: 'w2', history: [{ start: at(2026, 3, 1, 9), end: at(2026, 3, 1, 11) }, { start: at(2026, 3, 1, 18), end: at(2026, 3, 1, 20) }] };
  t('dos usos el mismo día cuentan como uno', ctx.wornDayKeys(w2).size === 1);
  t('días entre fechas en el cambio de hora de marzo', ctx.calendarDaysBetween(at(2026, 3, 28), at(2026, 3, 30)) === 2);
});

// ── Añadir y quitar días ──
cases.push(async () => {
  const { ctx } = await load();
  ctx.getWatches().push({ id: 'a', brand: 'A', model: 'A', history: [] });
  ctx.addWearDays('a', Date.now() - 9 * D, Date.now() - 7 * D);
  const r = ctx.removeWearDay('a', Date.now() - 8 * D);
  const st = ctx.wearStats(ctx.getWatch('a'));
  t('quitar el día central parte el rango en dos', r === true && st.daysWorn === 2 && ctx.getWatch('a').history.length === 2);
  t('no se pueden apuntar días futuros', ctx.addWearDays('a', Date.now() + 2 * D) === false);
  ctx.getWatch('a').wearStart = Date.now() - D;
  t('no se puede quitar un día de la sesión en curso', ctx.removeWearDay('a', Date.now()) === 'active');
});

// ── «Lo llevé hoy» de madrugada ──
cases.push(async () => {
  const { ctx } = await load({}, at(2026, 10, 12, 0) + 3 * 60000);   // 00:03
  ctx.getWatches().push({ id: 'n', brand: 'N', model: 'N', history: [] });
  const r = ctx.markWornToday('n');
  t('a las 00:03 «Lo llevé hoy» cuenta hoy', r === true && ctx.wornDayKeys(ctx.getWatch('n')).has('2026-10-12'),
    JSON.stringify(ctx.getWatch('n').history));
  t('y no se puede apuntar mañana', ctx.addWearDays('n', at(2026, 10, 13)) === false);
});

// ── Fusión con la nube ──
cases.push(async () => {
  const { ctx } = await load();
  const local = [{ id: '1', updatedAt: 200, model: 'local' }, { id: '2', updatedAt: 100 }, { id: '3', updatedAt: 100 }];
  const cloud = [{ id: '1', updatedAt: 100, model: 'cloud' }, { id: '4', updatedAt: 100 }];
  // 2 estaba sincronizado y ya no está en la nube (borrado en otro dispositivo); 3 es nuevo aquí
  const r = ctx.mergeById(local, cloud, ['1', '2'], []);
  const ids = r.items.map(x => x.id).sort().join(',');
  t('fusión: gana el más reciente, llegan los nuevos de la nube y se respetan los borrados', ids === '1,3,4' &&
    r.items.find(x => x.id === '1').model === 'local', ids);
  const r2 = ctx.mergeById([], [{ id: '9', updatedAt: 1 }], [], ['9']);
  t('fusión: lo borrado aquí no vuelve desde la nube', r2.items.length === 0);
});

// ── Saneado ──
cases.push(async () => {
  const { ctx } = await load();
  const w = ctx.sanitizeWatch({ id: 'x', brand: '<img src=x onerror=alert(1)>', model: 'M', photo: 'javascript:alert(1)', sourceUrl: 'javascript:alert(1)' });
  t('saneado: foto y enlace peligrosos se descartan', w && !w.photo && !w.sourceUrl);
  t('saneado: sin id no entra', ctx.sanitizeWatch({ brand: 'A' }) === null);
});

// ── Rotor Pro: mantenimiento, precisión, correas, valor ──
cases.push(async () => {
  const now = at(2026, 6, 15);
  const { ctx } = await load({}, now);
  const w = await ctx.addWatch({ brand: 'Seiko', model: 'SPB', type: 'automatic' });
  t('revisión: se apunta y actualiza «última revisión»', ctx.addServiceEntry(w.id, { date: at(2026, 5, 1), kind: 'service', cost: 180, note: 'Limpieza' })
    && ctx.getWatch(w.id).lastService === at(2026, 5, 1));
  ctx.addServiceEntry(w.id, { date: at(2025, 1, 1), kind: 'service', cost: 20 });
  t('una revisión más antigua no retrocede la fecha', ctx.getWatch(w.id).lastService === at(2026, 5, 1));
  t('coste total de mantenimiento', ctx.serviceCost(ctx.getWatch(w.id)) === 200);
  t('tipo de intervención desconocido: no entra', !ctx.addServiceEntry(w.id, { date: at(2026, 5, 2), kind: 'magia' }));
  const id0 = ctx.getWatch(w.id).serviceLog[0].id;
  t('el historial va de más reciente a más antiguo y se borra por id',
    ctx.getWatch(w.id).serviceLog[0].date === at(2026, 5, 1) && ctx.deleteServiceEntry(w.id, id0) && ctx.getWatch(w.id).serviceLog.length === 1);
});
cases.push(async () => {
  const { ctx } = await load();
  const w = await ctx.addWatch({ brand: 'Seiko', model: 'SPB', type: 'automatic' });
  const t0 = at(2026, 6, 1, 9);
  ctx.addAccuracyReading(w.id, { ts: t0, offset: 0 });
  ctx.addAccuracyReading(w.id, { ts: t0 + 4 * D, offset: 20 });            // +5 s/d
  ctx.addAccuracyReading(w.id, { ts: t0 + 5 * D, offset: 23, setAfter: true }); // +3 s/d, then set right
  ctx.addAccuracyReading(w.id, { ts: t0 + 7 * D, offset: -2 });            // −1 s/d from 0
  const st = ctx.accuracyStats(ctx.getWatch(w.id));
  const r = st.rates.map(x => Math.round(x.rate * 10) / 10);
  t('precisión: s/día entre lecturas, y tras ponerlo en hora cuenta desde 0', r.join(',') === '5,3,-1', r.join(','));
  t('media de las 3 últimas ponderada por días ((20+3−2)/7 = 3)', Math.round(st.avg * 10) / 10 === 3, String(st.avg));
  t('lecturas absurdas (más de un día) no entran', !ctx.addAccuracyReading(w.id, { ts: t0, offset: 100000 }));
});
cases.push(async () => {
  const { ctx } = await load();
  const w = await ctx.addWatch({ brand: 'A', model: 'B' });
  const s1 = ctx.addStrap(w.id, { name: 'Acero original', width: '20 mm' });
  const s2 = ctx.addStrap(w.id, { name: 'NATO gris' });
  t('correas: la primera queda puesta', s1.fitted === true && !s2.fitted);
  ctx.fitStrap(w.id, s2.id);
  const st = ctx.getWatch(w.id).straps;
  t('poner otra quita la anterior', st.find(x => x.id === s2.id).fitted && !st.find(x => x.id === s1.id).fitted);
  ctx.deleteStrap(w.id, s2.id);
  t('al borrar la puesta, pasa a la siguiente', ctx.getWatch(w.id).straps[0].fitted === true);
});
cases.push(async () => {
  const { ctx } = await load();
  const ws = [
    { id: '1', brand: 'Seiko', model: 'A', type: 'automatic', purchasePrice: 400, currentValue: 500, serviceLog: [{ id: 's', date: 1, kind: 'service', cost: 100 }] },
    { id: '2', brand: 'Casio', model: 'B', type: 'quartz', purchasePrice: 100 },
    { id: '3', brand: 'Seiko', model: 'C', type: 'automatic' },
  ];
  const v = ctx.collectionValue(ws, w => ({ 1: 10, 2: 20, 3: 0 })[w.id]);
  t('valor: pagado, valor actual (sin valor usa el precio) y cambio', v.paid === 500 && v.value === 600 && Math.abs(v.change - 0.2) < 1e-9);
  t('coste por uso de la colección incluye mantenimiento ((500+100)/30)', v.perWear === 20, String(v.perWear));
  t('por marca, de mayor a menor', v.byBrand[0][0] === 'Seiko' && v.byBrand[0][1] === 500);
});
cases.push(async () => {
  const { ctx } = await load();
  const w = ctx.sanitizeWatch({ id: 'x', brand: 'A', model: 'B', serial: 'SN1', currentValue: 300,
    serviceLog: [{ id: 'ok', date: 5, kind: 'service', cost: 10 }, { date: 5, kind: 'hack' }],
    accuracy: [{ ts: 1, offset: 2 }, { ts: 2, offset: 'x' }], straps: [{ name: 'NATO', fitted: true }, { name: '' }] });
  t('saneado Pro: se conservan los datos válidos y se descartan los malos',
    w.serial === 'SN1' && w.currentValue === 300 && w.serviceLog.length === 1 && w.accuracy.length === 1 && w.straps.length === 1 && w.straps[0].fitted);
});

// ── Avisos (plan que lee el service worker) ──
cases.push(async () => {
  const now = at(2026, 10, 12);
  const { ctx } = await load({}, now);
  const { buildPlan } = await import('../js/reminders.js');
  const ws = [
    { id: 'q', brand: 'Casio', model: 'Duro', type: 'quartz', batteryChanged: at(2024, 9, 1), history: [], created: at(2024, 1, 1) },
    { id: 'm', brand: 'Seiko', model: 'SPB', type: 'automatic', lastService: at(2023, 1, 1), purchaseDate: at(2020, 1, 1), history: [{ start: at(2026, 10, 1, 9), end: at(2026, 10, 1, 20) }], created: at(2020, 1, 1) },
    { id: 'o', brand: 'Orient', model: 'B', type: 'automatic', rotation: false, history: [], created: at(2025, 1, 1) },
  ];
  const plan = buildPlan(ws, now);
  const by = k => plan.find(p => p.key.startsWith(k));
  t('pila: a los 24 meses del último cambio', by('battery:q').dueAt === at(2026, 9, 1));
  t('revisión: a los 5 años de la última (no de la compra)', by('service:m').dueAt === at(2028, 1, 1));
  t('olvidado: 30 días después del último uso', by('idle:m').dueAt === ctx.wearStats(ws[1], now).lastWorn + 30 * D && by('idle:m').dueAt > now);
  t('fuera de rotación: sin aviso de olvido', !by('idle:o'));
  t('la clave cambia con una revisión nueva (vuelve a avisar dentro de 5 años)', buildPlan([{ ...ws[1], lastService: at(2026, 6, 1) }], now).find(p => p.kind === 'service').key !== by('service:m').key);
});

if (process.env.CASE !== undefined) {
  await cases[Number(process.env.CASE)]();
  console.log(`#RESULT ${ok} ${ko}`);
  process.exit(ko ? 1 : 0);
} else {
  let total = 0, bad = 0;
  for (let i = 0; i < cases.length; i++) {
    let out;
    try { out = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, CASE: String(i) }, encoding: 'utf8' }); }
    catch (e) { out = e.stdout || ''; if (!/#RESULT/.test(out)) { console.log(`  ✗ caso ${i} falló al cargar\n${e.stderr || e.message}`); bad++; total++; continue; } }
    process.stdout.write(out.replace(/#RESULT.*\n?/, ''));
    const [, o, k] = out.match(/#RESULT (\d+) (\d+)/);
    total += +o + +k; bad += +k;
  }
  console.log(`--- ${total - bad}/${total} OK`);
  process.exit(bad ? 1 : 0);
}
