// build.mjs — genera la web de Rotor en dist/ (portada en 3 idiomas, blog, RSS y sitemap).
// Uso: npm install && node build.mjs     (la GitHub Action lo hace sola en cada cambio)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import es from './content/es.mjs';
import en from './content/en.mjs';
import pt from './content/pt.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const APP_SRC = join(ROOT, '..');                  // el repositorio de la app (privacidad y ayuda salen de ahí)
const OUT = join(ROOT, 'dist');
const ORIGIN = 'https://rotor.pedicode-app.workers.dev';   // la web, servida por Cloudflare como ScudoWeb
const BASE = '/';
const SITE = ORIGIN + BASE;
const APP = ORIGIN + '/app/';                      // la app vive dentro de la web (y la app de Play abre esta dirección)
const appLink = lang => `${APP}?lang=${lang}`;   // the app opens in the language of the page (if you have not chosen one in the app)
const PLAY = '';                                   // ← cuando Rotor esté publicado en Google Play, pon aquí su enlace
const EMAIL = 'pedicode.app@gmail.com';
const LANGS = { es, en, pt };

/* ── utilidades ── */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const write = (rel, data) => { const p = join(OUT, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); };
const hash = rel => createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex').slice(0, 8);
const ASSET_V = { css: hash('assets/css/site.css'), js: hash('assets/js/rotor.js'),
  notice: createHash('sha256').update(readFileSync(join(ROOT, 'assets/js/notice.js'))).update(readFileSync(join(ROOT, '../js/browser-check.js'))).digest('hex').slice(0, 8) };
const url = (path = '') => BASE + path;
const abs = (path = '') => SITE + path;
const fmtDate = (d, lang) => new Date(d + 'T12:00:00Z').toLocaleDateString({ es: 'es-ES', en: 'en-GB', pt: 'pt-PT' }[lang], { day: 'numeric', month: 'long', year: 'numeric' });
const mailBeta = c => `mailto:${EMAIL}?subject=${encodeURIComponent(c.betaSubject)}`;

/* ── logo: el rotor (data-rotor) es lo que gira ── */
const logo = (id, cls = '', tile = true) => `<svg class="${cls}" viewBox="${tile ? '0 0 512 512' : '76 76 360 360'}" aria-hidden="true" focusable="false">
<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E6C98A"/><stop offset="1" stop-color="#B8963E"/></linearGradient></defs>
${tile ? '<rect width="512" height="512" rx="112" fill="#0D0D0D"/>' : ''}
<circle cx="256" cy="256" r="168" fill="none" stroke="url(#${id})" stroke-width="18"/>
<path data-rotor transform="rotate(-35 256 256)" d="M124 256 a132 132 0 0 1 264 0 h-62 a70 70 0 0 0 -140 0 z" fill="url(#${id})"/>
<circle cx="256" cy="256" r="22" fill="url(#${id})"/><circle cx="256" cy="256" r="8" fill="${tile ? '#0D0D0D' : '#0B1220'}"/></svg>`;

/* ── iconos (trazo, estilo Tabler) ── */
const ICON = {
  refresh: '<path d="M20 11a8.1 8.1 0 0 0-15.5-2m-.5-4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4M8 3v4M4 11h16M8 15h2v2H8z"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M5 6v.01M5 12v.01M5 18v.01"/>',
  heart: '<path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6a5 5 0 1 1 7.5 6.6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><circle cx="12" cy="16" r="1"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/>',
  sparkles: '<path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2-2a2 2 0 0 1-2-2a2 2 0 0 1-2 2zm0-12a2 2 0 0 1 2 2a2 2 0 0 1 2-2a2 2 0 0 1-2-2a2 2 0 0 1-2 2zM9 18a6 6 0 0 1 6-6a6 6 0 0 1-6-6a6 6 0 0 1-6 6a6 6 0 0 1 6 6z"/>',
  'wifi-off': '<path d="M12 18h.01M9.17 15.17a4 4 0 0 1 5.66 0M6.34 12.34a8 8 0 0 1 4.16-2.2M13.8 10.2a8 8 0 0 1 3.86 2.14M3.5 9.5a12 12 0 0 1 3.1-2.1M10.4 6.1A12 12 0 0 1 20.5 9.5M3 3l18 18"/>',
};
const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
const shot = (c, name, alt, eager = false) =>
  `<div class="phone"><img src="${url(`assets/img/${c.lang}-${name}.webp`)}" width="540" height="960" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></div>`;

/* ── plantilla común ── */
function page({ c, title, description, path, alternates = {}, body, jsonld = [], ogType = 'website', image }) {
  const alt = Object.entries(alternates).map(([l, p]) => `<link rel="alternate" hreflang="${l}" href="${abs(p)}">`).join('\n');
  const xdef = alternates.es !== undefined ? `<link rel="alternate" hreflang="x-default" href="${abs(alternates.es)}">` : '';
  const img = image || abs(`assets/img/og-${c.lang}.jpg`);
  return `<!doctype html>
<html lang="${c.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${abs(path)}">
${alt}
${xdef}
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="Rotor">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${abs(path)}">
<meta property="og:image" content="${img}">
<meta property="og:locale" content="${c.locale}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0B1220">
<link rel="icon" href="${url('favicon.ico')}" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="${url('assets/img/favicon-32x32.png')}">
<link rel="apple-touch-icon" href="${url('assets/img/apple-touch-icon.png')}">
<link rel="alternate" type="application/rss+xml" title="Rotor · Blog" href="${url('feed.xml')}">
<link rel="preload" href="${url('assets/fonts/jost-latin-400-normal.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${url('assets/fonts/bodoni-moda-latin-400-normal.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${url('assets/css/site.css')}?v=${ASSET_V.css}">
${jsonld.map(j => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
<script src="${url('assets/js/rotor.js')}?v=${ASSET_V.js}" defer></script>
<script type="module" src="${url('assets/js/notice.js')}?v=${ASSET_V.notice}"></script>
</head>
<body>
<a class="skip" href="#main">${{ es: 'Saltar al contenido', en: 'Skip to content', pt: 'Saltar para o conteúdo' }[c.lang]}</a>
${header(c, alternates)}
<div id="browser-notice" class="bn-wrap" hidden></div>
<main id="main">
${body}
</main>
${footer(c)}
${langHint(c, alternates)}
</body>
</html>
`;
}

function header(c, alternates) {
  const home = url(c.path);
  const langs = Object.keys(LANGS).map(l => {
    const target = alternates[l] !== undefined ? alternates[l] : LANGS[l].path;
    return `<a href="${url(target)}" hreflang="${l}" lang="${l}"${l === c.lang ? ' aria-current="true"' : ''}>${l.toUpperCase()}</a>`;
  }).join('');
  return `<header class="top"><div class="wrap">
<a class="brand" href="${home}" aria-label="Rotor">${logo('lg-top')}<span>ROTOR</span></a>
<nav class="nav" aria-label="${c.nav.story}">
<a class="hide-sm" href="${home}#idea">${c.nav.story}</a>
<a class="hide-sm" href="${home}#historia">${c.nav.history}</a>
<a class="hide-sm" href="${home}#funciones">${c.nav.features}</a>
<a class="hide-sm" href="${home}#pro">${c.nav.pro}</a>
<a href="${url(c.path + 'blog/')}">${c.nav.blog}</a>
<span class="lang">${langs}</span>
</nav></div></header>`;
}

function footer(c) {
  return `<footer class="foot"><div class="wrap">
<span>${esc(c.foot.made)}</span>
<nav aria-label="${esc(c.foot.made)}">
<a href="${url(c.privacyUrl)}">${c.foot.privacy}</a>
<a href="${url(c.termsUrl)}">${c.foot.terms}</a>
<a href="${url(c.helpUrl)}">${c.foot.help}</a>
<a href="mailto:${EMAIL}">${c.foot.contact}</a>
<a href="${url('feed.xml')}">${c.foot.rss}</a>
</nav></div></footer>`;
}

function langHint(c, alternates) {
  const tpls = Object.keys(LANGS).filter(l => l !== c.lang).map(l => {
    const target = alternates[l] !== undefined ? alternates[l] : LANGS[l].path;
    return `<template data-for="${l}"><span lang="${l}">${esc(LANGS[l].hint.text)} <a href="${url(target)}" hreflang="${l}">${esc(LANGS[l].hint.link)}</a></span></template>`;
  }).join('');
  return `<div class="lang-hint" data-lang-hint hidden>${tpls}<button type="button" aria-label="×">×</button></div>`;
}

const ctas = (c, small = false) => `<div class="btns">
<a class="btn btn-gold" href="${appLink(c.lang)}">${esc(small ? c.final.cta : c.hero.cta)}</a>
${PLAY ? `<a class="btn btn-line" href="${PLAY}">Google Play</a>` : `<a class="btn btn-line" href="${mailBeta(c)}">${esc(c.hero.cta2)}</a>`}
</div>`;

const card = (p, c) => `<a class="card" href="${url(`blog/${p.slug}/`)}" hreflang="${p.lang}">
<span class="meta">${fmtDate(p.date, p.lang)} · ${p.minutes} ${LANGS[p.lang].blog.min}</span>
<h3>${esc(p.title)}</h3><p>${esc(p.description)}</p></a>`;

/* ── portada ── */
function home(c, posts) {
  const mine = posts.filter(p => p.lang === c.lang).slice(0, 3);
  const alternates = Object.fromEntries(Object.entries(LANGS).map(([l, x]) => [l, x.path]));
  const body = `
<section class="hero"><div class="wrap hero-grid">
  <div>
    <p class="eyebrow">${esc(c.hero.eyebrow)}</p>
    <h1>${esc(c.hero.h1)}</h1>
    <p class="lead">${esc(c.hero.lead)}</p>
    ${ctas(c)}
    <p class="note">${esc(c.hero.note)}</p>
  </div>
  <div class="hero-art" data-rotor-tap>${logo('lg-hero', '', false)}</div>
</div></section>

<section id="idea"><div class="wrap story">
  <div class="prose">
    ${c.story.eyebrow ? `<p class="eyebrow">${esc(c.story.eyebrow)}</p>` : ''}
    <h2>${esc(c.story.h2)}</h2>
    ${c.story.p.map(p => `<p>${esc(p)}</p>`).join('\n    ')}
  </div>
  ${shot(c, '5-historial', c.story.alt)}
</div></section>

<section id="historia" class="alt"><div class="wrap">
  <div class="head"><p class="eyebrow">${esc(c.history.eyebrow)}</p><h2>${esc(c.history.h2)}</h2><p class="lead">${esc(c.history.lead)}</p></div>
  <ol class="timeline">${c.history.items.map(i => `
    <li><span class="t-year">${esc(i.y)}</span><div><h3>${esc(i.h)}</h3><p>${esc(i.p)}</p></div></li>`).join('')}
  </ol>
</div></section>

<section><div class="wrap">
  <div class="head"><p class="eyebrow">${esc(c.dials.eyebrow)}</p><h2>${esc(c.dials.h2)}</h2><p class="lead">${esc(c.dials.lead)}</p></div>
  <div class="dials">${c.dials.items.map(d => `
    <div class="dial-card"><div class="dial d-${d.k}" aria-hidden="true"><i></i></div><h3>${esc(d.h)}</h3><p>${esc(d.p)}</p></div>`).join('')}
  </div>
  <p class="note brands-note">${esc(c.history.note)}</p>
</div></section>

<section class="alt"><div class="wrap">
  <div class="head"><p class="eyebrow">${esc(c.how.eyebrow)}</p><h2>${esc(c.how.h2)}</h2></div>
  <div class="steps">${c.how.steps.map(s => `
    <div class="step">${shot(c, s.img, s.alt)}<div><h3>${esc(s.h)}</h3><p>${esc(s.p)}</p></div></div>`).join('')}
  </div>
</div></section>

<section id="funciones"><div class="wrap">
  <div class="head"><p class="eyebrow">${esc(c.features.eyebrow)}</p><h2>${esc(c.features.h2)}</h2></div>
  <div class="features">${c.features.items.map(f => `
    <div class="feature">${icon(f.icon)}<h3>${esc(f.h)}</h3><p>${esc(f.p)}</p></div>`).join('')}
  </div>
</div></section>

<section class="alt"><div class="wrap split rev">
  <div>
    <p class="eyebrow">${esc(c.privacy.eyebrow)}</p>
    <h2>${esc(c.privacy.h2)}</h2>
    <p class="lead">${esc(c.privacy.lead)}</p>
    <ul class="ticks">${c.privacy.ticks.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    <p class="honest">${esc(c.privacy.honest)}</p>
  </div>
  ${shot(c, '7-nube', c.privacy.alt)}
</div></section>

<section id="pro"><div class="wrap pro">
  <div>
    <p class="eyebrow">${esc(c.pro.eyebrow)}</p>
    <h2>${esc(c.pro.h2)}</h2>
    <div class="price"><b>${esc(c.pro.price)}</b><span>${esc(c.pro.priceNote)}</span></div>
    <ul class="ticks">${c.pro.items.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    <p class="note">${esc(c.pro.buy)}</p>
  </div>
  <div class="shots">${shot(c, '4-mantenimiento-pro', c.pro.alts[0])}${shot(c, '6-valor-pro', c.pro.alts[1])}</div>
</div></section>

<section class="alt"><div class="wrap faq">
  <h2>${esc(c.faq.h2)}</h2>
  ${c.faq.items.map(f => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n  ')}
</div></section>
${mine.length ? `
<section><div class="wrap">
  <div class="head"><p class="eyebrow">${esc(c.blog.eyebrow)}</p><h2>${esc(c.blog.h2)}</h2></div>
  <div class="posts">${mine.map(p => card(p, c)).join('')}</div>
  <p class="more"><a href="${url(c.path + 'blog/')}">${esc(c.blog.all)} →</a></p>
</div></section>` : ''}

<section class="final"><div class="wrap">
  <h2>${esc(c.final.h2)}</h2>
  <p class="lead">${esc(c.final.lead)}</p>
  ${ctas(c, true)}
</div></section>`;

  const jsonld = [{
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Rotor',
    applicationCategory: 'LifestyleApplication', operatingSystem: 'Android, Web',
    url: abs(c.path), inLanguage: ['es', 'en', 'pt'], description: c.meta.description,
    image: abs(`assets/img/og-${c.lang}.jpg`),
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    publisher: { '@type': 'Organization', name: 'Delfos-IQ', email: EMAIL },
  }, {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: c.faq.items.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  }];
  return page({ c, title: c.meta.title, description: c.meta.description, path: c.path, alternates, body, jsonld });
}

/* ── blog ── */
// Cada artículo es una carpeta: posts/AAAA-MM-DD-titulo/ con es.md, pt.md y/o en.md (y sus fotos en img/).
// Los archivos de una misma carpeta son traducciones entre sí. Fecha y nombre salen de la carpeta;
// «slug:» en la cabecera da otra dirección a una traducción (p. ej. pt: crise-do-quartzo).
function parsePost(dir, file) {
  const rel = `${dir}/${file}`;
  const raw = readFileSync(join(ROOT, 'posts', dir, file), 'utf8').replace(/^\uFEFF/, '');
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) throw new Error(`${rel}: falta la cabecera entre --- y ---`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*([a-zA-Záéíóúñ_]+)\s*:\s*(.*?)\s*$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, '');
  }
  const fm = dir.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
  if (!fm) throw new Error(`posts/${dir}: la carpeta debe llamarse AAAA-MM-DD-titulo-del-articulo`);
  const lang = file.replace(/\.md$/, '');
  if (!LANGS[lang]) throw new Error(`${rel}: el archivo debe llamarse es.md, en.md o pt.md`);
  if (meta.idioma && meta.idioma.slice(0, 2).toLowerCase() !== lang) throw new Error(`${rel}: «idioma: ${meta.idioma}» no coincide con el nombre del archivo`);
  if (!meta.titulo) throw new Error(`${rel}: falta «titulo:»`);
  const slug = (meta.slug || fm[2]).trim();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error(`${rel}: «slug: ${slug}» solo puede llevar minúsculas sin tildes, números y guiones`);
  const words = m[2].split(/\s+/).filter(Boolean).length;
  return {
    file: rel, dir, slug, date: meta.fecha || fm[1], lang, title: meta.titulo,
    description: meta.descripcion || meta.resumen || '', author: meta.autor || 'Rotor',
    ai: /^(s[ií]|yes|true|asistido)$/i.test(meta.ia || ''), draft: /^(s[ií]|yes|true)$/i.test(meta.borrador || ''),
    minutes: Math.max(1, Math.round(words / 220)), md: m[2], translations: {},
  };
}

const ORDER = ['es', 'pt', 'en'];
function loadPosts() {
  const base = join(ROOT, 'posts');
  const out = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    if (!entry.isDirectory()) {
      if (entry.name.endsWith('.md')) throw new Error(`posts/${entry.name}: cada artículo va en su carpeta (posts/AAAA-MM-DD-titulo/es.md). Mira posts/_plantilla/`);
      continue;
    }
    const group = readdirSync(join(base, entry.name)).filter(f => f.endsWith('.md')).map(f => parsePost(entry.name, f))
      .sort((a, b) => ORDER.indexOf(a.lang) - ORDER.indexOf(b.lang));
    for (const p of group) for (const q of group) if (q !== p) p.translations[q.lang] = q.slug;
    out.push(...group);
  }
  return out;
}

function renderMd(md, dir) {
  let html = marked.parse(md, { gfm: true });
  html = html.replace(/<img src="(?:\.\/)?img\//g, `<img loading="lazy" decoding="async" src="${url(`blog/img/${dir}/`)}`)
             .replace(/<img (?!loading)/g, '<img loading="lazy" decoding="async" ')
             .replace(/<a href="(https?:\/\/(?!delfos-iq\.github\.io)[^"]+)"/g, '<a href="$1" rel="noopener" target="_blank"');
  return html;
}

function postPage(p, posts) {
  const c = LANGS[p.lang];
  const path = `blog/${p.slug}/`;
  const alternates = { [p.lang]: path };
  for (const [l, slug] of Object.entries(p.translations)) if (posts.some(x => x.slug === slug)) alternates[l] = `blog/${slug}/`;
  const body = `<article class="article">
<p class="meta"><a href="${url(c.path + 'blog/')}">${esc(c.blog.back)}</a></p>
<h1>${esc(p.title)}</h1>
<p class="meta"><span>${c.blog.by} ${esc(p.author)}</span><time datetime="${p.date}">${fmtDate(p.date, p.lang)}</time><span>${p.minutes} ${c.blog.min}</span></p>
<div class="body">${renderMd(p.md, p.dir)}</div>
${p.ai ? `<p class="ai-note">${esc(c.blog.ai)}</p>` : ''}
<aside class="post-cta"><h2>${esc(c.blog.ctaH)}</h2><p>${esc(c.blog.ctaP)}</p>
<div class="btns"><a class="btn btn-gold" href="${appLink(p.lang)}">${esc(c.final.cta)}</a></div></aside>
</article>`;
  const jsonld = [{
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: p.description,
    datePublished: p.date, inLanguage: p.lang, url: abs(path), mainEntityOfPage: abs(path),
    author: { '@type': p.author === 'Rotor' ? 'Organization' : 'Person', name: p.author },
    publisher: { '@type': 'Organization', name: 'Rotor · Delfos-IQ' }, image: abs(`assets/img/og-${p.lang}.jpg`),
  }];
  return page({ c, title: `${p.title} · Rotor`, description: p.description || c.blog.description, path, alternates, body, jsonld, ogType: 'article' });
}

function blogIndex(c, posts) {
  const mine = posts.filter(p => p.lang === c.lang);
  const alternates = Object.fromEntries(Object.entries(LANGS).map(([l, x]) => [l, x.path + 'blog/']));
  const chips = Object.entries(LANGS).map(([l, x]) =>
    `<a href="${url(x.path + 'blog/')}" hreflang="${l}"${l === c.lang ? ' aria-current="page"' : ''}>${{ es: 'Español', en: 'English', pt: 'Português' }[l]} (${posts.filter(p => p.lang === l).length})</a>`).join('');
  const body = `<section class="page-head"><div class="wrap">
<p class="eyebrow">${esc(c.blog.eyebrow)}</p><h1>${esc(c.blog.title)}</h1><p class="lead">${esc(c.blog.lead)}</p>
<nav class="filters" aria-label="${esc(c.blog.title)}">${chips}</nav>
${mine.length ? `<div class="posts">${mine.map(p => card(p, c)).join('')}</div>` : `<p class="note">${esc(c.blog.empty)}</p>`}
</div></section>`;
  return page({ c, title: `${c.blog.title} · ${c.blog.h2}`, description: c.blog.description, path: c.path + 'blog/', alternates, body });
}

function rss(posts) {
  const items = posts.slice(0, 30).map(p => `<item><title>${esc(p.title)}</title><link>${abs(`blog/${p.slug}/`)}</link><guid>${abs(`blog/${p.slug}/`)}</guid>
<pubDate>${new Date(p.date + 'T08:00:00Z').toUTCString()}</pubDate><description>${esc(p.description)}</description><language>${p.lang}</language></item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Rotor · Blog</title><link>${SITE}</link><description>${esc(es.blog.description)}</description>
${items}
</channel></rss>
`;
}

function sitemap(posts) {
  const today = new Date().toISOString().slice(0, 10);
  const group = (paths) => paths.map(([l, p]) => `<url><loc>${abs(p)}</loc><lastmod>${today}</lastmod>
${paths.map(([l2, p2]) => `<xhtml:link rel="alternate" hreflang="${l2}" href="${abs(p2)}"/>`).join('')}</url>`).join('\n');
  const homes = Object.entries(LANGS).map(([l, x]) => [l, x.path]);
  const blogs = Object.entries(LANGS).map(([l, x]) => [l, x.path + 'blog/']);
  const legal = [LEGAL.filter(x => x.group === 'privacy'), LEGAL.filter(x => x.group === 'help'), TERMS].map(l => group(l.map(x => [x.lang, x.file]))).join('\n');
  const postUrls = posts.map(p => `<url><loc>${abs(`blog/${p.slug}/`)}</loc><lastmod>${p.date}</lastmod></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${group(homes)}
${group(blogs)}
${legal}
${postUrls}
</urlset>
`;
}


/* ── páginas legales y de ayuda ──
   Privacidad y ayuda son las mismas páginas que enlaza la app (raíz del repositorio): se toma su
   contenido y se presenta con el diseño de la web. Los términos viven en web/legal/*.md. */
const LEGAL = [
  { file: 'privacidad.html', lang: 'es', group: 'privacy' }, { file: 'privacy.html', lang: 'en', group: 'privacy' }, { file: 'privacidade.html', lang: 'pt', group: 'privacy' },
  { file: 'ayuda.html', lang: 'es', group: 'help' }, { file: 'help.html', lang: 'en', group: 'help' }, { file: 'ajuda-pt.html', lang: 'pt', group: 'help' },
];
const TERMS = [{ file: 'terminos.html', lang: 'es', src: 'terminos.md' }, { file: 'terms.html', lang: 'en', src: 'terms.md' }, { file: 'termos.html', lang: 'pt', src: 'termos.md' }];
const groupAlternates = list => Object.fromEntries(list.map(x => [x.lang, x.file]));

function legalPages() {
  const out = [];
  for (const group of ['privacy', 'help']) {
    const list = LEGAL.filter(x => x.group === group);
    for (const it of list) {
      const raw = readFileSync(join(APP_SRC, it.file), 'utf8');
      const title = (raw.match(/<title>([^<]*)<\/title>/) || [])[1] || 'Rotor';
      let main = (raw.match(/<main>([\s\S]*?)<\/main>/) || [])[1] || '';
      main = main.replace(/ style="[^"]*"/g, "").replace(/href="\.\/"/g, `href="${appLink(it.lang)}"`)
                 .replace(/href="\.\/((?:privacidad|privacy|privacidade|ayuda|help|ajuda-pt)\.html)"/g, (m, f) => `href="${url(f)}"`);
      const c = LANGS[it.lang];
      const desc = (main.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').match(/[^.]{40,200}\./) || [c.meta.description])[0].trim();
      out.push([it.file, page({ c, title, description: desc, path: it.file, alternates: groupAlternates(list), body: `<article class="article legal">${main}</article>` })]);
    }
  }
  for (const it of TERMS) {
    const raw = readFileSync(join(ROOT, 'legal', it.src), 'utf8');
    const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    const title = (m[1].match(/titulo:\s*(.*)/) || [])[1].trim();
    const c = LANGS[it.lang];
    out.push([it.file, page({ c, title: `${title} · Rotor`, description: (m[1].match(/descripcion:\s*(.*)/) || [])[1].trim(),
      path: it.file, alternates: groupAlternates(TERMS), body: `<article class="article legal"><h1>${esc(title)}</h1>${marked.parse(m[2])}</article>` })]);
  }
  return out;
}

/* ── construir ── */
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(ROOT, 'assets'), join(OUT, 'assets'), { recursive: true });
cpSync(join(ROOT, 'favicon.ico'), join(OUT, 'favicon.ico'));
cpSync(join(APP_SRC, 'js/browser-check.js'), join(OUT, 'assets/js/browser-check.js'));   // the notice shared with the app
for (const d of readdirSync(join(ROOT, 'posts'))) {
  const img = join(ROOT, 'posts', d, 'img');
  if (!d.startsWith('_') && existsSync(img)) cpSync(img, join(OUT, 'blog/img', d), { recursive: true });
}

const today = new Date().toISOString().slice(0, 10);
const all = loadPosts();
const posts = all.filter(p => !p.draft && p.date <= today).sort((a, b) => b.date.localeCompare(a.date));
const slugs = new Set();
for (const p of posts) { if (slugs.has(p.slug)) throw new Error(`Hay dos artículos con el mismo nombre: ${p.slug}`); slugs.add(p.slug); }

for (const c of Object.values(LANGS)) {
  write(c.path + 'index.html', home(c, posts));
  write(c.path + 'blog/index.html', blogIndex(c, posts));
}
for (const p of posts) write(`blog/${p.slug}/index.html`, postPage(p, posts));
for (const [file, html] of legalPages()) write(file, html);
write('feed.xml', rss(posts));
write('sitemap.xml', sitemap(posts));
write('404.html', page({ c: es, title: 'Página no encontrada · Rotor', description: 'Esta página no existe.', path: '404.html',
  body: `<section class="page-head"><div class="wrap"><h1>Esta página no existe</h1><p class="lead">Puede que el enlace esté mal o que el artículo se haya movido.</p>
<div class="btns"><a class="btn btn-gold" href="${url()}">Ir a la portada</a><a class="btn btn-line" href="${url('blog/')}">Ver el blog</a></div></div></section>` }));

/* ── la app, en /app/ (la misma que GitHub Pages; sus rutas son relativas) ── */
const APP_FILES = ['index.html', 'ayuda.html', 'help.html', 'ajuda-pt.html', 'privacidad.html', 'privacy.html', 'privacidade.html',
  'licencias.html', 'manifest.json', 'sw.js', 'version.json', 'watches_db.json', 'favicon.ico', 'css', 'js', 'icons', 'brand'];
for (const f of APP_FILES) cpSync(join(APP_SRC, f), join(OUT, 'app', f), { recursive: true });

/* ── Digital Asset Links: la app de Play demuestra que esta web es suya (sin esto, se ve la barra del navegador) ── */
const links = JSON.parse(readFileSync(join(APP_SRC, 'docs/play/assetlinks.json'), 'utf8'));
const FP = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const ready = links.every(l => l.target.sha256_cert_fingerprints.every(f => FP.test(f)));
if (ready) write('.well-known/assetlinks.json', JSON.stringify(links, null, 2));
else console.log('· assetlinks.json sin publicar: faltan las huellas SHA-256 en docs/play/assetlinks.json');

const pending = all.filter(p => p.draft || p.date > today).map(p => `${p.file} (${p.draft ? 'borrador' : 'programado para ' + p.date})`);
console.log(`✓ Web generada en dist/: 3 portadas, la app en /app/, ${posts.length} artículo(s)` + (pending.length ? `; sin publicar: ${pending.join(', ')}` : ''));
