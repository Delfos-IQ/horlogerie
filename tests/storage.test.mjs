// Pruebas unitarias de la lógica de datos (js/storage.js) en Node, sin navegador.
// Uso: node tests/storage.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function load(initial = {}) {
  const store = new Map(Object.entries(initial));
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  const ctx = { console, localStorage, navigator: {}, Date, Math, JSON, Map, Set, Promise, setTimeout, clearTimeout };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../js/storage.js', import.meta.url), 'utf8'), ctx, { filename: 'storage.js' });
  return { ctx, store };
}

let ok = 0, ko = 0;
const t = (name, cond, detail = '') => {
  if (cond) { ok++; console.log('  ✓ ' + name); } else { ko++; console.log('  ✗ ' + name + (detail ? `  [${detail}]` : '')); }
};
const D = 86400000;
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

// ── Carga segura ──
{
  const { ctx, store } = load({ horlogerie_v3: '{esto no es json' });
  t('JSON local dañado: arranca vacío sin perder el original',
    ctx.getWatches().length === 0 && [...store.keys()].some(k => k.startsWith('horlogerie_v3_corrupt_')) &&
    ctx.storageRecovered.includes('horlogerie_v3'));
  const copy = [...store.entries()].find(([k]) => k.startsWith('horlogerie_v3_corrupt_'))[1];
  t('la copia apartada es idéntica al original', copy === '{esto no es json');
}
{
  const { ctx } = load({ horlogerie_v3: JSON.stringify({ no: 'es una lista' }) });
  t('forma incorrecta también se aparta', ctx.storageRecovered.includes('horlogerie_v3'));
}
{
  const list = [{ id: 'w1', brand: 'A', model: 'B', history: [] }];
  const { ctx } = load({ horlogerie_v3: JSON.stringify(list) });
  t('datos correctos se cargan', ctx.getWatches().length === 1 && !ctx.storageRecovered.length);
}

// ── Días de uso ──
{
  const { ctx } = load();
  const w = { id: 'w', history: [{ start: at(2026, 10, 23, 9), end: at(2026, 10, 28, 21) }] };
  const keys = [...ctx.wornDayKeys(w)];
  t('un rango cuenta cada día una vez, también al cambiar la hora (25 oct)', keys.length === 6 && keys[0] === '2026-10-23' && keys[5] === '2026-10-28', keys.join(','));
  const w2 = { id: 'w2', history: [{ start: at(2026, 3, 1, 9), end: at(2026, 3, 1, 11) }, { start: at(2026, 3, 1, 18), end: at(2026, 3, 1, 20) }] };
  t('dos usos el mismo día cuentan como uno', ctx.wornDayKeys(w2).size === 1);
  t('días entre fechas en el cambio de hora de marzo', ctx.calendarDaysBetween(at(2026, 3, 28), at(2026, 3, 30)) === 2);
}

// ── Añadir y quitar días ──
{
  const { ctx } = load();
  ctx.getWatches().push({ id: 'a', brand: 'A', model: 'A', history: [] });
  ctx.addWearDays('a', Date.now() - 9 * D, Date.now() - 7 * D);
  const r = ctx.removeWearDay('a', Date.now() - 8 * D);
  const st = ctx.wearStats(ctx.getWatch('a'));
  t('quitar el día central parte el rango en dos', r === true && st.daysWorn === 2 && ctx.getWatch('a').history.length === 2);
  t('no se pueden apuntar días futuros', ctx.addWearDays('a', Date.now() + 2 * D) === false);
  ctx.getWatch('a').wearStart = Date.now() - D;
  t('no se puede quitar un día de la sesión en curso', ctx.removeWearDay('a', Date.now()) === 'active');
}

// ── Fusión con la nube ──
{
  const { ctx } = load();
  const local = [{ id: '1', updatedAt: 200, model: 'local' }, { id: '2', updatedAt: 100 }, { id: '3', updatedAt: 100 }];
  const cloud = [{ id: '1', updatedAt: 100, model: 'cloud' }, { id: '4', updatedAt: 100 }];
  // 2 estaba sincronizado y ya no está en la nube (borrado en otro dispositivo); 3 es nuevo aquí
  const r = ctx.mergeById(local, cloud, ['1', '2'], []);
  const ids = r.items.map(x => x.id).sort().join(',');
  t('fusión: gana el más reciente, llegan los nuevos de la nube y se respetan los borrados', ids === '1,3,4' &&
    r.items.find(x => x.id === '1').model === 'local', ids);
  const r2 = ctx.mergeById([], [{ id: '9', updatedAt: 1 }], [], ['9']);
  t('fusión: lo borrado aquí no vuelve desde la nube', r2.items.length === 0);
}

// ── Saneado ──
{
  const { ctx } = load();
  const w = ctx.sanitizeWatch({ id: 'x', brand: '<img src=x onerror=alert(1)>', model: 'M', photo: 'javascript:alert(1)', sourceUrl: 'javascript:alert(1)' });
  t('saneado: foto y enlace peligrosos se descartan', w && !w.photo && !w.sourceUrl);
  t('saneado: sin id no entra', ctx.sanitizeWatch({ brand: 'A' }) === null);
}

console.log(`--- ${ok}/${ok + ko} OK`);
process.exit(ko ? 1 : 0);
