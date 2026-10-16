/**
 * browser-check.js — notice for browsers where Rotor works worse, shared by the app and the website
 * (the website build copies this file to /assets/js/).
 *
 *   - Android browsers other than Chrome (Mi Browser, Samsung Internet, Firefox…): installing,
 *     camera and gallery, the back gesture and reminders work better in Chrome → «Abrir en Chrome».
 *   - Browsers inside other apps (Instagram, Facebook, TikTok…): what is saved there can be lost.
 *
 * «Entendido» hides it for good in that browser (one key per kind of browser).
 * No imports: plain module, texts in es / en / pt here.
 */
const IN_APP = [['Instagram', /Instagram/], ['Facebook', /FBAN|FBAV|FB_IAB/], ['TikTok', /musical_ly|BytedanceWebview|TikTok/],
  ['LinkedIn', /LinkedInApp/], ['Snapchat', /Snapchat/], ['Pinterest', /Pinterest/]];
const ANDROID_OTHERS = [['Mi Browser', /MiuiBrowser|XiaoMi\//], ['Samsung Internet', /SamsungBrowser/], ['Firefox', /Firefox\//],
  ['Opera', /OPR\/|Opera/], ['Huawei Browser', /HuaweiBrowser/], ['UC Browser', /UCBrowser/], ['Vivo Browser', /VivoBrowser/],
  ['HeyTap Browser', /HeyTapBrowser|OppoBrowser/], ['DuckDuckGo', /DuckDuckGo/], ['Brave', /Brave/]];

/** @returns {{ kind: 'inapp'|'android', name: string, android: boolean } | null} */
export function detectBrowser(ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '') {
  const android = /Android/.test(ua);
  const app = IN_APP.find(([, r]) => r.test(ua));
  if (app) return { kind: 'inapp', name: app[0], android };
  if (!android) return null;
  if (/; wv\)/.test(ua)) return { kind: 'inapp', name: '', android };      // a WebView inside some other app
  const other = ANDROID_OTHERS.find(([, r]) => r.test(ua));                 // these also say «Chrome/…»: check first
  return other ? { kind: 'android', name: other[0], android } : null;
}

/** Same page, opened in Chrome (Android intent; falls back to this browser if Chrome is missing) */
export function chromeUrl(href = location.href) {
  const u = new URL(href);
  return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=https;package=com.android.chrome;` +
    `S.browser_fallback_url=${encodeURIComponent(href)};end`;
}

const TEXT = {
  es: { another: 'otra app', androidTitle: 'Rotor va mejor en Chrome',
        android: 'Rotor funciona en {b}, pero instalar la app, la cámara y la galería, el gesto «atrás» y los avisos funcionan mejor en Chrome. Tus relojes se guardan en cada navegador por separado: si cambias, tráelos con tu clave o un código.',
        inappTitle: 'Estás dentro de {b}',
        inapp: 'Lo que guardes aquí puede perderse al cerrar. Abre Rotor en tu navegador (menú ⋯ → «Abrir en el navegador») para instalarlo y guardar tus relojes.',
        open: 'Abrir en Chrome', ok: 'Entendido' },
  en: { another: 'another app', androidTitle: 'Rotor works best in Chrome',
        android: 'Rotor works in {b}, but installing the app, camera and gallery, the back gesture and reminders work better in Chrome. Each browser keeps its own watches: if you switch, bring them over with your key or a code.',
        inappTitle: 'You are inside {b}',
        inapp: 'What you save here may be lost when you close it. Open Rotor in your browser (⋯ menu → «Open in browser») to install it and keep your watches.',
        open: 'Open in Chrome', ok: 'Got it' },
  pt: { another: 'outra app', androidTitle: 'O Rotor funciona melhor no Chrome',
        android: 'O Rotor funciona no {b}, mas instalar a app, a câmara e a galeria, o gesto «voltar» e os avisos funcionam melhor no Chrome. Cada navegador guarda os seus relógios: se mudares, traz-os com a tua chave ou um código.',
        inappTitle: 'Estás dentro do {b}',
        inapp: 'O que guardares aqui pode perder-se ao fechar. Abre o Rotor no teu navegador (menu ⋯ → «Abrir no navegador») para o instalar e guardar os teus relógios.',
        open: 'Abrir no Chrome', ok: 'Entendido' },
};
const KEY = 'rotor_browser_notice';   // «kind:name» already acknowledged

/**
 * Fill `el` with the notice (if this browser needs one and it was not acknowledged).
 * @param {HTMLElement|null} el
 * @param {string} lang 'es' | 'en' | 'pt'
 * @returns {boolean} shown
 */
export function mountBrowserNotice(el, lang = 'es', ua) {
  if (!el) return false;
  const b = detectBrowser(ua);
  if (!b) return false;
  const id = `${b.kind}:${b.name}`;
  try { if (localStorage.getItem(KEY) === id) return false; } catch {}
  const tx = TEXT[lang] || TEXT.es;
  const name = b.name || tx.another;
  const fill = s => s.replace('{b}', name);
  el.textContent = '';
  const box = document.createElement('aside');
  box.className = 'bn';
  box.setAttribute('role', 'note');
  const title = document.createElement('p'); title.className = 'bn-title';
  title.textContent = fill(b.kind === 'inapp' ? tx.inappTitle : tx.androidTitle);
  const text = document.createElement('p'); text.className = 'bn-text';
  text.textContent = fill(b.kind === 'inapp' ? tx.inapp : tx.android);
  const actions = document.createElement('div'); actions.className = 'bn-actions';
  if (b.android) {
    const open = document.createElement('a'); open.className = 'bn-open';
    open.href = chromeUrl(); open.textContent = tx.open;
    actions.append(open);
  }
  const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'bn-ok'; ok.textContent = tx.ok;
  ok.addEventListener('click', () => {
    try { localStorage.setItem(KEY, id); } catch {}
    el.hidden = true; el.textContent = '';
  });
  actions.append(ok);
  box.append(title, text, actions);
  el.append(box);
  el.hidden = false;
  return true;
}
