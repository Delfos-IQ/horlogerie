/**
 * billing.js — Rotor Pro: one-time purchase through Google Play.
 *
 * Inside the Play app (Trusted Web Activity with Play Billing on) Chrome offers the
 * Digital Goods API and the Play payment method:
 *   1. getDetails → the localised price set in Play Console.
 *   2. PaymentRequest('https://play.google.com/billing') → Play's purchase sheet → token.
 *   3. The Worker (/v2/pro/verify) checks the token with Google and acknowledges it.
 *   4. The app remembers it on this device; listPurchases restores it after a reinstall
 *      or on another phone with the same Google account.
 * In a normal browser there is no Play: Pro can't be bought there (the app says so).
 *
 * The check is on the device, so a determined user could switch Pro on by hand. That is
 * accepted for a one-off 9,99 € purchase: the server check stops casual token reuse,
 * and nothing secret or shared depends on Pro.
 */
import { CONFIG } from './api.js';
import { locale } from './i18n.js';

export const PRO_SKU = 'rotor_pro';
export const PLAY_BILLING = 'https://play.google.com/billing';
const PRO_KEY = 'rotor_pro_v1';
const RECHECK_MS = 3 * 86400000;

/** @type {{ active?: boolean, token?: string, orderId?: string, verifiedAt?: number, pending?: boolean }} */
let state = readState();
const listeners = new Set();

function readState() {
  try { const s = JSON.parse(localStorage.getItem(PRO_KEY) || 'null'); return s && typeof s === 'object' ? s : {}; } catch { return {}; }
}
function writeState(s) {
  state = s;
  try { localStorage.setItem(PRO_KEY, JSON.stringify(s)); } catch {}
  listeners.forEach(fn => { try { fn(isPro()); } catch {} });
}
export function isPro() { return !!state.active; }
export function proInfo() { return { ...state }; }
/** Called whenever Pro is switched on or off */
export function onProChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** The Play billing service, or null outside the Play app */
export async function billingService() {
  if (typeof window === 'undefined' || !('getDigitalGoodsService' in window)) return null;
  try { return await window.getDigitalGoodsService(PLAY_BILLING); } catch { return null; }
}

/** { available, price } — price formatted in the user's language, from Play */
export async function proOffer() {
  const svc = await billingService();
  if (!svc) return { available: false, price: null };
  try {
    const [d] = await svc.getDetails([PRO_SKU]);
    if (!d) return { available: false, price: null };
    const price = new Intl.NumberFormat(locale(), { style: 'currency', currency: d.price.currency }).format(Number(d.price.value));
    return { available: true, price };
  } catch { return { available: false, price: null }; }
}

async function verify(token) {
  const res = await fetch(`${CONFIG.WORKER_URL}/v2/pro/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku: PRO_SKU, token }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function activate(token, r) {
  writeState({ active: true, token, orderId: r.orderId || '', verifiedAt: Date.now() });
}

/** Opens Play's purchase sheet. → 'ok' | 'pending' | 'cancelled' | 'failed' */
export async function buyPro() {
  if (!(await billingService()) || typeof PaymentRequest === 'undefined') return 'failed';
  const request = new PaymentRequest(
    [{ supportedMethods: PLAY_BILLING, data: { sku: PRO_SKU } }],
    { total: { label: 'Total', amount: { currency: 'EUR', value: '0' } } });   // Play shows its own price
  let response;
  try { response = await request.show(); }
  catch (e) { return e?.name === 'AbortError' ? 'cancelled' : 'failed'; }
  const token = response.details?.purchaseToken || response.details?.token;
  try {
    const r = await verify(token);
    await response.complete(r.ok || r.pending ? 'success' : 'fail');
    if (r.ok) { activate(token, r); return 'ok'; }
    if (r.pending) { writeState({ pending: true, token }); return 'pending'; }
    return 'failed';
  } catch (e) {
    try { await response.complete('fail'); } catch {}
    throw e;
  }
}

/**
 * Looks for the purchase in the Play account (reinstall, new phone) and re-checks
 * the one we have. → 'ok' | 'pending' | 'none'
 * A refunded purchase switches Pro off; being offline never does.
 */
export async function restorePro() {
  const svc = await billingService();
  if (!svc) return isPro() ? 'ok' : 'none';
  const list = await svc.listPurchases();
  const p = list.find(x => x.itemId === PRO_SKU);
  const token = p?.purchaseToken || state.token;
  if (!token) return 'none';
  const r = await verify(token);
  if (r.ok) { activate(token, r); return 'ok'; }
  if (r.pending) { writeState({ pending: true, token }); return 'pending'; }
  if (r.revoked || r.invalid) writeState({});
  return 'none';
}

/** At start: quietly re-check now and then (only inside the Play app) */
export async function recheckPro() {
  if (!(await billingService())) return;
  if (isPro() && Date.now() - (state.verifiedAt || 0) < RECHECK_MS && !state.pending) return;
  try { await restorePro(); } catch { /* offline: keep what we have */ }
}
