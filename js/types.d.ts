/**
 * Tipos del modelo de datos de Rotor. Solo documentación y comprobación
 * (tsc --checkJs sobre js/data); no se carga en el navegador.
 */

/** A wear interval: from start to end, in ms. Each calendar day touched counts as one day worn. */
interface HistoryEntry { start: number; end: number }

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
  /** false = out of rotation (not recommended) */
  rotation?: boolean;
  purchasePrice?: number | null;
  purchaseDate?: number | null;
  lastService?: number | null;
  batteryChanged?: number | null;
  sourceUrl?: string;
  /** In memory only (photos live in IndexedDB) */
  photo?: string | null;
  created: number;
  updatedAt?: number;
  _source?: string;
  _warning?: string;
}

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
  costPerWear: number | null;
}
