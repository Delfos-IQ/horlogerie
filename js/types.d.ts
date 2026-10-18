/**
 * Tipos del modelo de datos de Rotor. Solo documentación y comprobación
 * (tsc --checkJs sobre js/data); no se carga en el navegador.
 */

/** A wear interval: from start to end, in ms. Each calendar day touched counts as one day worn. */
interface HistoryEntry { start: number; end: number; /** real time on the wrist (put on → taken off), not a logged day */ timed?: boolean }

interface Watch {
  id: string;
  brand: string;
  model: string;
  ref?: string;
  type: 'automatic' | 'quartz' | 'manual';
  notes?: string;
  specs: Partial<Record<'calibre' | 'movimiento' | 'cristal' | 'brazalete' | 'esfera' | 'caja' | 'resistencia' | 'reserva' | 'diametro' | 'grosor' | 'asas', string>>;
  price?: { value: string; note?: string } | null;
  history: HistoryEntry[];
  /** Wearing now since this time (only one watch at a time) */
  wearStart: number | null;
  favorite?: boolean;
  /** «Familia»: diver, chrono, gmt, pilot, field, dress, sport, other (data/families.js) */
  family?: string;
  /** false = out of rotation (not recommended) */
  rotation?: boolean;
  purchasePrice?: number | null;
  purchaseDate?: number | null;
  lastService?: number | null;
  batteryChanged?: number | null;
  sourceUrl?: string;
  /** Rotor Pro */
  serial?: string;
  currentValue?: number;
  serviceLog?: ServiceEntry[];
  accuracy?: AccuracyReading[];
  straps?: Strap[];
  /** In memory only (photos live in IndexedDB) */
  photo?: string | null;
  created: number;
  updatedAt?: number;
  _source?: string;
  _warning?: string;
}

interface ServiceEntry { id: string; date: number; kind: 'service' | 'battery' | 'strap' | 'polish' | 'repair' | 'other'; cost?: number; note?: string }
/** offset: seconds fast (+) or slow (−) at ts; setAfter: the watch was put right after this reading */
interface AccuracyReading { ts: number; offset: number; setAfter?: boolean }
interface Strap { id: string; name: string; material?: string; width?: string; note?: string; fitted?: boolean }

interface WishlistItem {
  id: string;
  brand: string;
  model: string;
  ref?: string;
  type?: Watch['type'];
  priority?: 'high' | 'medium' | 'low';
  precio?: string;
  notas?: string;
  specs?: Watch['specs'];
  sourceUrl?: string;
  created: number;
  updatedAt?: number;
}

interface WearStats {
  daysWorn: number;
  daysWorn90: number;
  sessions: number;
  lastWorn: number | null;
  daysSinceLast: number | null;
  active: boolean;
  /** hours on the wrist, from timed sessions (put on → taken off) and the one in progress */
  hoursWorn: number;
  costPerWear: number | null;
}
