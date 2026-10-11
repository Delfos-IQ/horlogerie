/**
 * api.js — Cloudflare Worker communication + feature switches
 */

const CONFIG = {
  WORKER_URL: 'https://horlogerie.pedicode-app.workers.dev'
};

/**
 * Feature switches.
 * urlImport: "Importar desde URL" depends on a Groq model that was retired in
 * September 2026. Hidden until the Worker is moved to a supported model.
 */
const FEATURES = {
  urlImport: true,    // needs Worker v12+ (checked at runtime with /health)
  devTools:  false,   // "Exportar a base de datos" in the wishlist (to curate watches_db.json)
};
