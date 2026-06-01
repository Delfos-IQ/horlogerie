# Horlogerie — Gestión de Colección de Relojes

PWA móvil para gestionar tu colección de relojes, con identificación por foto e información de internet.

```
horlogerie/
├── pwa/                  ← La app (se despliega en GitHub Pages)
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   ├── css/app.css
│   ├── js/
│   │   ├── storage.js
│   │   ├── api.js        ← Apunta a tu Worker
│   │   └── app.js
│   └── icons/            ← Añade icon-192.png e icon-512.png
└── worker/               ← Cloudflare Worker (backend)
    ├── index.js
    └── wrangler.toml
```

---

## Paso 1 — Crear el repositorio en GitHub

1. Crea un repositorio nuevo en GitHub, por ejemplo `horlogerie`
2. Sube todos los archivos de este proyecto:
```bash
git init
git add .
git commit -m "init: horlogerie app"
git remote add origin https://github.com/TU_USUARIO/horlogerie.git
git push -u origin main
```

---

## Paso 2 — Activar GitHub Pages

1. Ve a tu repositorio → **Settings → Pages**
2. En **Source**, selecciona **GitHub Actions**
3. El workflow `.github/workflows/deploy.yml` se ejecutará automáticamente en cada push
4. Tu app estará en: `https://TU_USUARIO.github.io/horlogerie/`

> ⚠️ Si GitHub Pages usa subdirectorio, edita `manifest.json` y cambia `"start_url": "/horlogerie/"`.

---

## Paso 3 — Añadir iconos PWA

Crea dos imágenes PNG con fondo oscuro (`#0D0D0D`) y el texto "H" en dorado:
- `pwa/icons/icon-192.png` (192×192 px)
- `pwa/icons/icon-512.png` (512×512 px)

Puedes generarlos en [favicon.io](https://favicon.io/favicon-generator/) o similar.

---

## Paso 4 — Desplegar el Cloudflare Worker

### 4a. Instalar Wrangler
```bash
npm install -g wrangler
wrangler login
```

### 4b. Desplegar
```bash
cd worker
wrangler deploy
```

Esto te dará una URL del tipo:
`https://horlogerie-api.TU_SUBDOMINIO.workers.dev`

### 4c. Añadir secrets en el dashboard de Cloudflare

Ve a **Workers & Pages → horlogerie-api → Settings → Variables and Secrets**:

| Variable | Valor |
|---|---|
| `GROQ_API_KEY` | Tu clave de [console.groq.com](https://console.groq.com) |
| `ALLOWED_ORIGIN` | `https://TU_USUARIO.github.io` |

> Marca `GROQ_API_KEY` como **Secret** (cifrado).

---

## Paso 5 — Conectar la PWA con el Worker

Edita `pwa/js/api.js` y cambia la URL:

```js
const CONFIG = {
  WORKER_URL: 'https://horlogerie-api.TU_SUBDOMINIO.workers.dev'
};
```

Haz commit y push — GitHub Actions desplegará automáticamente.

---

## Paso 6 — Instalar la app en el móvil

### iPhone (Safari)
1. Abre `https://TU_USUARIO.github.io/horlogerie/` en Safari
2. Pulsa el botón **Compartir** → **Añadir a pantalla de inicio**

### Android (Chrome)
1. Abre la URL en Chrome
2. Chrome mostrará automáticamente el banner de instalación
3. O pulsa el menú → **Instalar app**

---

## API Groq gratuita

El plan gratuito de Groq incluye:
- **14.400 requests/día** con LLaMA 4 Scout
- **30 requests/minuto**
- Sin tarjeta de crédito necesaria

Regístrate en [console.groq.com](https://console.groq.com).

---

## Funcionalidades

- 📸 **Identificación por foto** — Groq LLaMA 4 Scout Vision identifica marca, modelo y referencia
- 🔍 **Specs completas** — Calibre, cristal, brazalete, esfera, caja, resistencia al agua, reserva de marcha, diámetro
- 💶 **Precio de mercado** — Estimación nuevo/segundamano con contexto
- ⌚ **Gestión de uso** — Registra cuándo te pones cada reloj
- 📅 **Historial completo** — Intervalos por mes y año
- 📱 **PWA offline** — Funciona sin internet después de la primera carga
- 💾 **Datos locales** — Todo en el dispositivo, sin servidor propio
