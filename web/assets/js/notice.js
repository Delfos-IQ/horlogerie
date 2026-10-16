/* Aviso para Mi Browser, Samsung Internet… o dentro de Instagram & co. Mismo código que la app
   (js/browser-check.js, copiado aquí por build.mjs): «Entendido» lo oculta un mes en web y app a la vez. */
import { fillBrowserLine, mountBrowserNotice } from './browser-check.js';
const lang = document.documentElement.lang.slice(0, 2);
mountBrowserNotice(document.getElementById('browser-notice'), lang);     // vuelve cada 30 días tras «Entendido»
fillBrowserLine(document.getElementById('browser-foot'), lang, { label: true });   // y queda siempre en el pie
