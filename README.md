# Horlogerie

PWA para gestionar una colección de relojes: qué relojes tienes, cuándo te pusiste cada uno, cuál toca ahora y su ficha técnica. Pensada para coleccionistas de homenajes y microbrands (Berny, Pagani Design, San Martin, Steeldive…).

- **App:** https://delfos-iq.github.io/horlogerie/
- **API:** Cloudflare Worker `https://horlogerie.pedicode-app.workers.dev`

## Estructura

```
horlogerie/
├── index.html              Única página de la app (vistas, modales, registro del SW)
├── manifest.json           Manifest PWA (scope /horlogerie/)
├── sw.js                   Service worker: red primero para la app, caché para fuentes/iconos
├── version.json            ÚNICA fuente de la versión (ver "Publicar una versión")
├── watches_db.json         Base local de modelos que usa el autocompletado
├── css/app.css
├── icons/                  Iconos PWA y favicons
├── js/
│   ├── db.js               Carga y búsqueda en watches_db.json
│   ├── storage.js          Datos: metadatos en localStorage, fotos en IndexedDB, lista de deseos
│   ├── api.js              URL del Worker y FEATURES (interruptores de funciones)
│   ├── sync.js             Copia en la nube opcional: fusión por elemento, envío diferencial
│   ├── export.js           Exportación a PDF (jsPDF)
│   ├── vendor/             qrcode-generator 1.4.4 (MIT): QR del ID generado en el dispositivo
│   └── modules/
│       ├── core.js         Estado, utilidades, navegación y gesto atrás de Android
│       ├── home-detail.js  Colección, recomendación y ficha del reloj
│       ├── modals.js       Alta/edición de relojes y búsqueda en la base
│       ├── history.js      Ranking por categorías e historial por reloj
│       ├── settings.js     Estadísticas, copias JSON, tamaño en la nube, inicio de la app
│       ├── wishlist.js     Lista de deseos
│       ├── session.js      ID de sesión, QR e importación de sesión
│       ├── updates.js      Aviso de nueva versión (APP_VERSION)
│       └── url-import.js   Importar especificaciones desde una URL (vía Worker)
├── worker/
│   ├── index.js            Cloudflare Worker: /sync/*, /import-url, /health
│   └── wrangler.toml
├── data/                   Fuente de la base de modelos (Excel y su exportación JSON)
├── tests/
│   ├── worker-harness.mjs  Ejecuta el Worker real en Node con KV en memoria
│   └── e2e_sync.py         Pruebas de sincronización con varios "dispositivos" (Playwright)
└── tools/
    └── bump-version.mjs    Propaga la versión de version.json al resto de archivos
```

Los scripts se cargan en orden desde `index.html` (sin bundler ni build). El orden importa: `db → storage → api → sync → export → modules/*`.

## Desarrollo local

Cualquier servidor estático sirve, pero la app espera estar bajo `/horlogerie/`:

```bash
mkdir -p /tmp/srv && ln -sfn "$PWD" /tmp/srv/horlogerie
python3 -m http.server 8080 -d /tmp/srv
# → http://localhost:8080/horlogerie/
```

Desde `localhost` el Worker real rechaza las peticiones (CORS limitado a `delfos-iq.github.io`); la app funciona en local sin nube.

### Pruebas de sincronización

`tests/e2e_sync.py` abre varios navegadores (dispositivos A, B, C, D) contra el Worker real ejecutado en Node con un KV en memoria, y comprueba fusión, borrados entre dispositivos, conflictos, copias con fotos, migración, cambio de llave y borrado de la nube. Instrucciones en la cabecera del archivo. Antes de publicar un cambio en `storage.js`, `sync.js` o el Worker, deben pasar todas.

## Publicar una versión

1. Fijar la versión y las notas (se muestran en el aviso de actualización):
   ```bash
   node tools/bump-version.mjs 2.1.4 "Qué cambia en una frase"
   ```
   Actualiza `version.json`, `APP_VERSION` en `updates.js`, los `?v=` de `index.html` y la caché y la lista `SHELL` de `sw.js`.
2. Comprobar que todo coincide: `node tools/bump-version.mjs --check`
3. Commit con mensaje descriptivo y `git push`. GitHub Pages publica la rama `main`.

Si añades un archivo JS o CSS nuevo, inclúyelo también en la lista `SHELL` de `sw.js` para que funcione sin conexión.

## Worker (Cloudflare)

```bash
cd worker
npx wrangler deploy
```

Secretos (Cloudflare → Workers → horlogerie → Settings → Variables and Secrets):

| Variable | Uso | Obligatoria |
|---|---|---|
| `GROQ_API_KEY` | `/import-url` (hoy desactivada en la app) | No: desde la v11 la sincronización funciona sin ella |
| `EBAY_APP_ID`, `EBAY_CERT_ID` | Precios de eBay | No |

Versión actual: **v11**. La app detecta la versión con `/health`: con v11 envía el ID de sesión en la cabecera `X-Horlogerie-User` y sincroniza la lista de deseos; con v10 sigue funcionando (ID por query, lista de deseos solo en copias JSON).

Enlace KV: variable `HORLOGERIE_KV` → namespace `HORLOGERIE`. El `id` del namespace en `wrangler.toml` sigue siendo un marcador; cópialo desde el panel de Cloudflare antes de desplegar con Wrangler.

## Datos del usuario

- **En el dispositivo:** relojes en `localStorage` (`horlogerie_v3`), fotos en IndexedDB (`horlogerie_photos`), lista de deseos en `localStorage` (`horlogerie_wishlist_v1`).
- **En la nube (opcional, apagada por defecto en instalaciones nuevas):** KV con clave `user:{uuid}:watches` que guarda `{ watches, wishlist, updatedAt }`. El UUID de Ajustes es la única llave: quien lo tenga puede leer y borrar la colección. Desde Ajustes se puede cambiar la llave o borrar los datos de la nube.
- **Fusión:** cada reloj y deseo lleva `updatedAt`. Al sincronizar gana la copia modificada más recientemente; los borrados viajan como lápidas (`horlogerie_tombstones_v1`).
- **Copia de seguridad:** Ajustes → Copia de seguridad (JSON, formato v3): relojes con fotos, historial y lista de deseos. Restaurar combina con lo que ya hay; no borra nada.

## Estado y plan

Auditoría y plan de mejoras hacia Google Play: fases F0–F5.
- F0 (orden del repositorio): v2.1.3.
- F1 (datos seguros): v2.2.0. Pendiente de desplegar el Worker v11.
