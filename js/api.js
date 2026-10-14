/**
 * api.js — Cloudflare Worker communication + feature switches
 */
import { t } from './i18n.js';

export const CONFIG = {
  WORKER_URL: 'https://horlogerie.pedicode-app.workers.dev'
};

/**
 * Feature switches.
 * urlImport: "Rellenar desde un enlace" (no AI: js/spec-parser.js reads the
 * page text the Worker v13 downloads, or text pasted by the user).
 */
export const FEATURES = {
  urlImport: true,    // needs Worker v12+ (checked at runtime with /health)
};

/** Error text from a Worker reply. The service worker answers 'Offline' when the server
 *  cannot be reached (no connection, or the server refused this address). */
export function apiError(data) {
  return data?.error === 'Offline' ? t('No se pudo conectar con el servidor de Rotor. Revisa la conexión e inténtalo de nuevo.') : data?.error;
}
/** Message for a caught error: a failed fetch (no network, or the server refused this address) gets a clear text */
export function errText(e) {
  return e instanceof TypeError ? apiError({ error: 'Offline' }) : (e?.message || String(e));
}
