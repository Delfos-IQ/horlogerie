# Rotor · web (portada, blog, privacidad, términos y ayuda)

Funciona igual que ScudoWeb: esta carpeta vive en el mismo repositorio que la app y Cloudflare
la publica sola en **https://rotor.pedicode-app.workers.dev** cada vez que hay un cambio en `main`
(tarda 1–2 minutos). La app va dentro, en **https://rotor.pedicode-app.workers.dev/app/**: es la
dirección que abre la app de Google Play. `build.mjs` copia la app de la raíz del repositorio a
`dist/app/` y publica `dist/.well-known/assetlinks.json` (desde `docs/play/assetlinks.json`) cuando
tiene las huellas de la firma. Si algún día pones un dominio propio a la web, la app sigue en esta
dirección: el dominio puede caducar sin romper la app.

- `content/es.mjs`, `en.mjs`, `pt.mjs` — textos de la portada.
- `posts/` — artículos del blog, uno por archivo.
- `legal/` — términos de uso. La privacidad y la ayuda se toman de las páginas de la app
  (`privacidad.html`, `ayuda.html`… en la raíz del repositorio), para no tener dos versiones.
- `build.mjs` — lo junta todo en `dist/`. Configuración de Cloudflare: `../wrangler.toml`.

## Publicar un artículo

1. En GitHub, entra en **`web/posts/`** y pulsa **Add file → Create new file**
   (también desde la app de GitHub en el móvil).
2. Nombre: **`AAAA-MM-DD-titulo-con-guiones.md`**, por ejemplo `2026-11-03-como-limpiar-un-brazalete.md`.
   La dirección será `/blog/como-limpiar-un-brazalete/`.
3. Copia la cabecera de **`posts/_plantilla.md`**, rellénala y escribe debajo.
4. **Commit changes**. En 1–2 minutos está publicado.

```
---
titulo: Cómo limpiar un brazalete de acero
descripcion: Una o dos frases. Es lo que se ve en Google y al compartir el enlace.
idioma: es            # es, en o pt
autor: Dani
ia: no                # «sí» añade la nota «escrito con ayuda de IA»
borrador: sí          # opcional: mientras ponga «sí», no se publica
---
```

- **Fecha futura:** el artículo no sale hasta esa fecha, y se publica en el primer despliegue
  a partir de ese día (cualquier cambio en el repositorio lo despliega).
  El workflow «Publicar artículos programados» (`.github/workflows/blog-programado.yml`) lo hace
  solo: cada mañana, si hay un artículo con la fecha de hoy, sube un commit vacío para desplegar.
- **Traducciones:** si escribes el mismo artículo en otro idioma, añade en ambos
  `traducciones: en=slug-en, pt=slug-pt`.
- **Fotos:** súbelas a `posts/img/` (.webp o .jpg, menos de 300 KB) y úsalas así:
  `![Descripción de la foto](img/brazalete.webp)`.

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
