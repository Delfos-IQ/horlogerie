# Rotor · web (portada, blog, privacidad, términos y ayuda)

Funciona igual que ScudoWeb: esta carpeta vive en el mismo repositorio que la app y Cloudflare
la publica sola en **https://rotor.pedicode-app.workers.dev** cada vez que hay un cambio en `main`
(tarda 1–2 minutos). La app va dentro, en **https://rotor.pedicode-app.workers.dev/app/**: es la
dirección que abre la app de Google Play. `build.mjs` copia la app de la raíz del repositorio a
`dist/app/` y publica `dist/.well-known/assetlinks.json` (desde `docs/play/assetlinks.json`) cuando
tiene las huellas de la firma. Si algún día pones un dominio propio a la web, la app sigue en esta
dirección: el dominio puede caducar sin romper la app.

- `content/es.mjs`, `en.mjs`, `pt.mjs` — textos de la portada.
- `posts/` — artículos del blog, una carpeta por artículo con un archivo por idioma.
- `legal/` — términos de uso. La privacidad y la ayuda se toman de las páginas de la app
  (`privacidad.html`, `ayuda.html`… en la raíz del repositorio), para no tener dos versiones.
- `build.mjs` — lo junta todo en `dist/`. Configuración de Cloudflare: `../wrangler.toml`.

## Publicar un artículo

Cada artículo es **una carpeta** con un archivo por idioma:

```
posts/
  2026-10-19-crisis-del-cuarzo/     ← fecha + nombre del artículo
    es.md                           ← /blog/crisis-del-cuarzo/
    pt.md                           ← /blog/crise-do-quartzo/   (con «slug: crise-do-quartzo»)
    en.md                           ← /blog/the-quartz-crisis/  (con «slug: the-quartz-crisis»)
    img/                            ← las fotos de este artículo (opcional)
```

1. En GitHub, entra en **`web/posts/`** y pulsa **Add file → Create new file**
   (también desde la app de GitHub en el móvil).
2. Nombre: **`AAAA-MM-DD-titulo-con-guiones/es.md`** (al escribir la `/` GitHub crea la carpeta),
   por ejemplo `2026-11-03-como-limpiar-un-brazalete/es.md`.
   La dirección será `/blog/como-limpiar-un-brazalete/`.
3. Copia la cabecera de **`posts/_plantilla/es.md`**, rellénala y escribe debajo.
4. **Commit changes**. En 1–2 minutos está publicado.

```
---
titulo: Cómo limpiar un brazalete de acero
descripcion: Una o dos frases. Es lo que se ve en Google y al compartir el enlace.
autor: Dani
ia: no                # «sí» añade la nota «escrito con ayuda de IA»
borrador: sí          # opcional: mientras ponga «sí», no se publica
slug: otro-nombre     # opcional: otra dirección (útil en las traducciones)
fecha: 2026-11-10     # opcional: si no, la de la carpeta
---
```

- **Idioma:** lo da el nombre del archivo (`es.md`, `pt.md` o `en.md`).
- **Traducciones:** basta con poner el otro idioma en la misma carpeta; se enlazan solas.
  Dale su propia dirección con `slug:` (mejor para Google que una dirección en español).
- **Fecha futura:** el artículo no sale hasta esa fecha. El workflow «Publicar artículos
  programados» (`.github/workflows/blog-programado.yml`) mira cada mañana si hay alguno con la
  fecha de hoy y, si lo hay, sube un commit vacío para que Cloudflare publique la web.
- **Fotos:** súbelas a `img/` dentro de la carpeta del artículo (.webp o .jpg, menos de 300 KB)
  y úsalas así: `![Descripción de la foto](img/brazalete.webp)`.

| Escribes | Sale |
|---|---|
| `## Subtítulo` | un subtítulo |
| `**negrita**` · `*cursiva*` | **negrita** · *cursiva* |
| `[texto](https://enlace)` | un enlace |
| `- punto` | una lista |
| `> cita` | una cita destacada |

## Cuando Rotor esté en Google Play

Pon su enlace en `PLAY` dentro de `build.mjs`: el botón «Probarlo en Android» pasa a ser
«Google Play» en todas las páginas.

## Vista previa en tu ordenador

```
cd web && npm install && npm run preview      # http://localhost:8090/
```

## Para que Google la encuentre

Da de alta `https://rotor.pedicode-app.workers.dev/` en Google Search Console y envía
`https://rotor.pedicode-app.workers.dev/sitemap.xml`.
