# Rotor (antes Horlogerie)

PWA para gestionar una colección de relojes. El nombre visible es **Rotor**; la URL (`/horlogerie/`), las claves de datos, el repositorio y el Worker conservan el nombre original para no romper instalaciones ni datos.

 qué relojes tienes, cuándo te pusiste cada uno, cuál toca ahora, su ficha técnica, el coste por uso y los avisos de pila y revisión. Pensada para coleccionistas de homenajes y microbrands (Berny, Pagani Design, San Martin, Steeldive…). Funciona sin conexión y no carga nada de terceros.

- **App:** https://delfos-iq.github.io/horlogerie/
- **API:** Cloudflare Worker `https://horlogerie.pedicode-app.workers.dev`

## Estructura

```
horlogerie/
├── index.html              Única página de la app (vistas, modales, registro del SW)
├── privacidad.html         Política de privacidad pública (enlazada en Ajustes y en Play)
├── ayuda.html              Ayuda: nube, clave de recuperación, vincular y reinstalar
├── licencias.html          Licencias de terceros (MIT y OFL)
├── brand/                  Logo maestro (rotor-icon.svg) y símbolo sin fondo (rotor-symbol.svg)
├── manifest.json           Manifest PWA (scope /horlogerie/)
├── sw.js                   Service worker: red primero para la app, caché para fuentes/iconos
├── version.json            ÚNICA fuente de la versión (ver "Publicar una versión")
├── watches_db.json         Base local de modelos que usa el autocompletado
├── css/
│   ├── app.css
│   ├── fonts.css + fonts/  Bodoni Moda y Jost (OFL), solo latín
│   └── icons.css + icons/  Subconjunto de Tabler Icons (lo genera tools/build-icons.py)
├── icons/                  Iconos PWA y favicons
├── js/
│   ├── db.js               Carga y búsqueda en watches_db.json
│   ├── storage.js          Datos: relojes, fotos (IndexedDB), lista de deseos, registro de uso
│   │                       por días (wearStats), avisos de mantenimiento, fusión y copias
│   ├── api.js              URL del Worker y FEATURES (interruptores de funciones)
│   ├── sync.js             Copia en la nube opcional: fusión por elemento, envío diferencial
│   ├── export.js           Exportación a PDF (jsPDF)
│   ├── vendor/             qrcode-generator 1.4.4 y jsPDF 2.5.1 (MIT)
│   └── modules/
│       ├── core.js         Estado, utilidades, navegación y gesto atrás de Android
│       ├── home-detail.js  Colección, recomendación y ficha del reloj
│       ├── modals.js       Alta/edición de relojes y búsqueda en la base
│       ├── history.js      Calendario, ranking top 10 y detalle por reloj (filtro por año)
│       ├── settings.js     Estadísticas, copias JSON, tamaño en la nube, inicio de la app
│       ├── wishlist.js     Lista de deseos
│       ├── session.js      Clave de recuperación, vincular dispositivos y recuperar
│       ├── updates.js      Aviso de nueva versión (APP_VERSION)
│       └── url-import.js   Importar especificaciones desde una URL (vía Worker)
├── worker/
│   ├── index.js            Cloudflare Worker: /sync/*, /import-url, /health
│   └── wrangler.toml
├── data/                   Fuente de la base de modelos (Excel y su exportación JSON)
├── docs/play/              Todo lo necesario para publicar en Google Play (guía, ficha, capturas)
├── .github/workflows/      Pruebas en cada push y despliegue automático del Worker
├── tests/
│   ├── worker-harness.mjs  Ejecuta el Worker real en Node con KV en memoria
│   ├── e2e_sync.py         Sincronización con varios "dispositivos" (Playwright)
│   ├── e2e_wear.py         Registro de uso, recomendación, PDF y funcionamiento sin terceros
│   ├── e2e_import_history.py  Rellenar desde un enlace, calendario, ranking y «Por reloj»
│   └── e2e_cloud.py        Clave corta, vincular dispositivos, recuperar, avisos y Ajustes
└── tools/
    ├── bump-version.mjs    Propaga la versión de version.json al resto de archivos
    ├── build-icons.py      Regenera el subconjunto de iconos (ejecutar al usar un icono nuevo)
    ├── build-brand.py      Genera iconos PNG y favicon desde brand/rotor-icon.svg
    └── play-screenshots.py Capturas de la ficha de Play con una colección de ejemplo
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

### Pruebas

`tests/e2e_sync.py` abre varios navegadores (dispositivos A, B, C, D) contra el Worker real ejecutado en Node con un KV en memoria, y comprueba fusión, borrados entre dispositivos, conflictos, copias con fotos, migración, cambio de llave y borrado de la nube. Instrucciones en la cabecera del archivo. `tests/e2e_wear.py` comprueba el registro de uso por días, la recomendación, los avisos, el PDF y que la app no pide nada fuera de su dominio. GitHub Actions ejecuta ambas en cada push (`.github/workflows/tests.yml`).

### Iconos

La app usa un subconjunto de Tabler Icons. Si añades una clase `ti-*` nueva, ejecuta `python3 tools/build-icons.py` (requiere `pip install fonttools brotli`): si no, el icono se verá en blanco.

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
| `EBAY_APP_ID`, `EBAY_CERT_ID` | Precios de eBay | No |

Versión actual: **v13**: claves cortas de recuperación, vinculación con código de 6 caracteres (`/pair/create`, `/pair/claim`) y `/import-url` **sin IA**: descarga la página que indica el usuario y devuelve el texto con la ficha (JSON-LD, tablas, líneas); la app la lee con `js/spec-parser.js` (pruebas: `node tests/spec-parser.test.mjs`). El texto pegado se lee en el dispositivo. `GROQ_API_KEY` ya no se usa: puedes borrarla de Cloudflare. Variable opcional: `IMPORT_DAILY_CAP` (lecturas de página al día, 300 por defecto).

Desde la v11: La app detecta la versión con `/health`: con v11 envía el ID de sesión en la cabecera `X-Horlogerie-User` y sincroniza la lista de deseos; con v10 sigue funcionando (ID por query, lista de deseos solo en copias JSON).

Enlace KV: variable `HORLOGERIE_KV` → namespace `HORLOGERIE`. El `id` del namespace en `wrangler.toml` sigue siendo un marcador; cópialo desde el panel de Cloudflare antes de desplegar con Wrangler.

## Datos del usuario

- **En el dispositivo:** relojes en `localStorage` (`horlogerie_v3`), fotos en IndexedDB (`horlogerie_photos`), lista de deseos en `localStorage` (`horlogerie_wishlist_v1`).
- **En la nube (opcional, apagada por defecto en instalaciones nuevas):** KV con clave `user:{clave}:watches` que guarda `{ watches, wishlist, updatedAt }`. La clave de recuperación es la única llave: quien la tenga puede leer y borrar la colección. Desde la v2.8 (con Worker v13) es de 16 caracteres Crockford base32 (`7KQ2-M4XR-9TBW-2HNF`, 80 bits); las claves UUID anteriores siguen valiendo. «Vincular otro dispositivo» guarda `pair:{CÓDIGO}` → clave durante 10 minutos, de un solo uso.
- **Registro de uso:** `history` guarda intervalos `{start, end}` y `wearStart` la sesión en curso. Los «días de uso» son días de calendario distintos (`wornDayKeys`): dos horas cuentan como un día y dos usos el mismo día, como uno.
- **Campos por reloj (v2.3):** `favorite`, `rotation` (false = fuera de rotación), `purchasePrice`, `purchaseDate`, `lastService`, `batteryChanged`.
- **Fusión:** cada reloj y deseo lleva `updatedAt`. Al sincronizar gana la copia modificada más recientemente; los borrados viajan como lápidas (`horlogerie_tombstones_v1`).
- **Copia de seguridad:** Ajustes → Copia de seguridad (JSON, formato v3): relojes con fotos, historial y lista de deseos. Restaurar combina con lo que ya hay; no borra nada.

## Estado y plan

Auditoría y plan de mejoras hacia Google Play: fases F0–F5.
- F0 (orden del repositorio): v2.1.3.
- F1 (datos seguros): v2.2.0. Worker v11 desplegado.
- F2 (calidad) y F3 (producto): v2.3.0.
- F4 (Play): materiales listos en `docs/play/`; faltan los pasos con la cuenta de Play.
