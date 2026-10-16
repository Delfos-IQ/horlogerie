/* Aviso para Mi Browser, Samsung Internet… o dentro de Instagram & co. Mismo código que la app
   (js/browser-check.js, copiado aquí por build.mjs): «Entendido» lo oculta en web y app a la vez. */
import { mountBrowserNotice } from './browser-check.js';
mountBrowserNotice(document.getElementById('browser-notice'), document.documentElement.lang.slice(0, 2));
