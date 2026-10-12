/**
 * reminders.js — Rotor Pro: maintenance and rotation reminders as phone notifications.
 *
 * Nothing leaves the phone. The app writes a small plan to IndexedDB
 * (rotor_reminders): one item per reminder with the date it becomes due and its
 * text already in the user's language. The service worker wakes up now and then
 * (Periodic Background Sync, Chrome on Android with the app installed), reads the
 * plan and shows what is due and not shown yet. Without background sync the
 * reminders still appear inside the app, as before.
 *
 * Reminders:
 *   battery  quartz: 24 months after the last battery change
 *   service  mechanical: 5 years after the last service (or the purchase)
 *   idle     a watch in rotation that has gone 30 days without wrist time
 *            (all of them in one notification, so it never floods)
 */
import { BATTERY_MONTHS, SERVICE_YEARS, dayKey, getWatches, wearStats } from './storage.js';
import { isPro } from './billing.js';
import { t } from './i18n.js';

export const REMINDER_DB = 'rotor_reminders';
export const SYNC_TAG = 'rotor-reminders';
const PREF_KEY = 'rotor_reminders_on';
const DAY = 86400000;
export const IDLE_DAYS = 30;

const addMonths = (ts, n) => { const d = new Date(ts); d.setMonth(d.getMonth() + n); return d.getTime(); };

/**
 * The reminders of a collection, with the moment each one becomes due. Pure.
 * @param {Watch[]} ws @param {number} [now]
 * @returns {{ key: string, dueAt: number, kind: 'battery'|'service'|'idle', watchId: string, title: string, body: string }[]}
 */
export function buildPlan(ws, now = Date.now()) {
  const out = [];
  for (const w of ws) {
    const name = `${w.brand} ${w.model}`;
    if (w.type === 'quartz' && typeof w.batteryChanged === 'number') {
      out.push({ key: `battery:${w.id}:${w.batteryChanged}`, dueAt: addMonths(w.batteryChanged, BATTERY_MONTHS), kind: 'battery',
        watchId: w.id, title: name, body: t('Toca revisar la pila: lleva unos 2 años puesta.') });
    }
    if (w.type !== 'quartz') {
      const ref = typeof w.lastService === 'number' ? w.lastService : typeof w.purchaseDate === 'number' ? w.purchaseDate : null;
      if (ref !== null) out.push({ key: `service:${w.id}:${ref}`, dueAt: addMonths(ref, SERVICE_YEARS * 12), kind: 'service',
        watchId: w.id, title: name, body: t('Toca revisión: han pasado unos 5 años.') });
    }
    if (w.rotation !== false && !w.wearStart) {
      const st = wearStats(w, now);
      const last = st.lastWorn ?? w.created ?? now;
      out.push({ key: `idle:${w.id}:${dayKey(last)}`, dueAt: last + IDLE_DAYS * DAY, kind: 'idle',
        watchId: w.id, title: name, body: t('{w} lleva un mes en la caja.', { w: name }) });
    }
  }
  return out;
}

/** The texts the service worker needs to group idle watches (in the active language) */
export function digestTexts() {
  return { title: t('Relojes olvidados'), many: t('{n} relojes llevan más de un mes en la caja. Toca para ver cuál te toca.') };
}

/* ─── IndexedDB (same tiny store the service worker reads) ─── */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(REMINDER_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kvPut(key, value) {
  const db = await openDB();
  await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(value, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  db.close();
}
export async function kvGet(key) {
  const db = await openDB();
  const v = await new Promise(res => { const g = db.transaction('kv').objectStore('kv').get(key); g.onsuccess = () => res(g.result); g.onerror = () => res(undefined); });
  db.close();
  return v;
}

/* ─── State ─── */
export function remindersOn() { try { return localStorage.getItem(PREF_KEY) === '1'; } catch { return false; } }
function setOn(v) { try { if (v) localStorage.setItem(PREF_KEY, '1'); else localStorage.removeItem(PREF_KEY); } catch {} }

/** What this phone can do */
export function reminderSupport() {
  const notifications = typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
  const background = notifications && typeof ServiceWorkerRegistration !== 'undefined' && 'periodicSync' in ServiceWorkerRegistration.prototype;
  return { notifications, background, permission: notifications ? Notification.permission : 'denied' };
}

/** Rewrite the plan the service worker reads (or empty it when off) */
export async function syncReminderPlan() {
  if (typeof indexedDB === 'undefined') return;
  const on = remindersOn() && isPro() && reminderSupport().permission === 'granted';
  try {
    await kvPut('plan', on ? { items: buildPlan(getWatches()), digest: digestTexts(), url: location.pathname, updatedAt: Date.now() } : { items: [] });
  } catch { /* private mode: no reminders */ }
}

/** Ask for permission and register the background check → 'on' | 'denied' | 'unsupported' */
export async function enableReminders() {
  const sup = reminderSupport();
  if (!sup.notifications) return 'unsupported';
  const perm = sup.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  setOn(true);
  try {
    const reg = await navigator.serviceWorker.ready;
    if (sup.background) {
      const status = await navigator.permissions?.query({ name: /** @type {any} */ ('periodic-background-sync') }).catch(() => null);
      if (!status || status.state === 'granted') await /** @type {any} */ (reg).periodicSync.register(SYNC_TAG, { minInterval: 12 * 3600 * 1000 });
    }
  } catch { /* the plan is still written; the app shows reminders when opened */ }
  await syncReminderPlan();
  return 'on';
}
export async function disableReminders() {
  setOn(false);
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) await /** @type {any} */ (reg).periodicSync.unregister(SYNC_TAG);
  } catch {}
  await syncReminderPlan();
}
