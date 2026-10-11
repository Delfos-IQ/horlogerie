/**
 * api.js — Cloudflare Worker communication + feature switches
 */

const CONFIG = {
  WORKER_URL: 'https://horlogerie.pedicode-app.workers.dev'
};

/**
 * Feature switches.
 * urlImport: "Rellenar desde un enlace" (no AI: js/spec-parser.js reads the
 * page text the Worker v13 downloads, or text pasted by the user).
 */
const FEATURES = {
  urlImport: true,    // needs Worker v12+ (checked at runtime with /health)
  devTools:  false,   // "Exportar a base de datos" in the wishlist (to curate watches_db.json)
};
