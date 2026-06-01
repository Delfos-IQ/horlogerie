/**
 * api.js — All calls go through your Cloudflare Worker.
 * Set WORKER_URL in config.js or the inline CONFIG object below.
 *
 * Replace WORKER_URL with your actual Cloudflare Worker URL after deploying.
 * Example: https://horlogerie-api.YOUR-SUBDOMAIN.workers.dev
 */

const CONFIG = {
  WORKER_URL: 'https://horlogerie.pedicode-app.workers.dev'
};

/**
 * Identify a watch from a base64 photo.
 * Returns { brand, model, type, confidence } or throws.
 */
async function apiIdentifyWatch(base64Image, mediaType) {
  const res = await fetch(`${CONFIG.WORKER_URL}/identify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Image, mediaType })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch full specs + price for a watch by brand/model/ref.
 * Returns { specs: {...}, price: {...} } or throws.
 */
async function apiFetchDetails(brand, model, ref, type) {
  const res = await fetch(`${CONFIG.WORKER_URL}/details`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brand, model, ref, type })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
