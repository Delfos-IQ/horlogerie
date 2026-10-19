/**
 * ready.js — Run code once the page is ready, even if that moment has already passed.
 *
 * Since v2.24 the language dictionary is loaded with a top-level await, so modules can
 * finish evaluating after DOMContentLoaded or load have fired: a plain listener would
 * then never run (v2.24.0 bug: in English and Portuguese the service worker, the cloud
 * sync at start and the update check did not run). Always use these instead.
 */
/** @param {() => void} fn after DOMContentLoaded */
export function onReady(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
  else queueMicrotask(fn);
}
/** @param {() => void} fn after the load event */
export function onLoad(fn) {
  if (document.readyState === 'complete') queueMicrotask(fn);
  else window.addEventListener('load', fn, { once: true });
}
