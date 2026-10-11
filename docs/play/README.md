# Publicar Rotor en Google Play

Guía paso a paso para empaquetar la PWA (nombre visible: **Rotor**; la URL sigue siendo `/horlogerie/`) como app Android (TWA, *Trusted Web Activity*) y publicarla. La app sigue viviendo en `https://delfos-iq.github.io/horlogerie/`: la TWA es un envoltorio que la abre a pantalla completa, sin barra del navegador. Cada `git push` actualiza también la app de Play, sin volver a subir nada (salvo cambios del envoltorio).

Material listo en esta carpeta:

| Archivo | Para qué |
|---|---|
| `ficha.md` | Título, descripciones (ES y PT) y respuestas del cuestionario de contenido |
| `seguridad-datos.md` | Respuestas del formulario «Seguridad de los datos» |
| `capturas/` | 5 capturas de pantalla 1080×1918 y el gráfico destacado 1024×500 |
| `assetlinks.json` | Plantilla del archivo que demuestra que la web y la app son tuyas |
| `twa-manifest.json` | Configuración para Bubblewrap (alternativa a PWABuilder) |
| `../../privacidad.html` | Política de privacidad pública: `https://delfos-iq.github.io/horlogerie/privacidad.html` |

Para regenerar las capturas: `python3 tools/play-screenshots.py` (con la app servida en local).

---

## 0. Antes de empezar (pendiente)

- [ ] Poner un email de contacto en `privacidad.html` (busca `[EMAIL DE CONTACTO]`). Es obligatorio.
- [ ] Decidir el nombre del paquete. Propuesta: `com.delfosiq.rotor`. **No se puede cambiar después de publicar.**

## 1. Generar el paquete Android (AAB)

**Opción recomendada: PWABuilder** (web, sin instalar nada)

1. Abre https://www.pwabuilder.com e introduce `https://delfos-iq.github.io/horlogerie/`.
2. *Package for stores* → **Android** → *Generate package* → *Options*:
   - Package ID: `com.delfosiq.rotor`
   - App name: `Rotor` · Short name: `Rotor`
   - Display mode: `standalone` · Status bar `#F3EEE3` (oscuro: `#0B1220`) · Nav bar `#FBF8F1` (oscuro: `#141D30`)
   - Signing key: **Create new** y guarda el `.keystore` y sus contraseñas en un sitio seguro (gestor de contraseñas + copia). Si los pierdes, no podrás actualizar la app. Con *Play App Signing* (paso 3) Google guarda la clave de firma final y la tuya queda como clave de subida.
3. Descarga el ZIP. Contiene el `.aab` para Play, un `.apk` para probar en tu móvil y un `assetlinks.json`.
4. Comprueba en el informe que el **target SDK es 36** (Android 16). Play no acepta apps nuevas por debajo desde el 31/08/2026. Si sale menor, usa la opción Bubblewrap.

**Opción Bubblewrap** (línea de comandos; necesita JDK 17 y descarga el SDK de Android):

```bash
npm i -g @bubblewrap/cli
mkdir rotor-twa && cd rotor-twa
cp ../docs/play/twa-manifest.json .
bubblewrap build      # pide crear la clave de firma la primera vez
```

## 2. Digital Asset Links (sin esto se ve la barra del navegador)

Android solo abre la app a pantalla completa si la web declara que la app es suya, en la **raíz del dominio**: `https://delfos-iq.github.io/.well-known/assetlinks.json`. La app está en `/horlogerie/`, así que hace falta un repositorio aparte:

1. En la organización Delfos-IQ crea un repositorio **público** llamado exactamente `delfos-iq.github.io`.
2. Añade:
   - `.nojekyll` (vacío; sin él GitHub Pages ignora las carpetas que empiezan por punto)
   - `.well-known/assetlinks.json` con el contenido de `assetlinks.json` de esta carpeta, cambiando:
     - `package_name` por tu Package ID
     - `sha256_cert_fingerprints` por **las dos** huellas: la de tu clave de subida (sale en el ZIP de PWABuilder) y la de *Play App Signing* (Play Console → Configuración → Integridad de la app → Firma de apps, después del paso 3).
3. Settings → Pages → Deploy from branch `main`. Comprueba que `https://delfos-iq.github.io/.well-known/assetlinks.json` responde.

## 3. Play Console

1. Crea la app: nombre `Rotor: rotación de relojes`, idioma predeterminado español (España), **App**, **Gratuita**.
2. Acepta *Play App Signing* al subir el primer AAB.
3. **Ficha de Play Store**: textos de `ficha.md`, icono `icons/icon-512.png`, gráfico destacado y capturas de `capturas/`.
4. **Contenido de la aplicación**:
   - Política de privacidad: `https://delfos-iq.github.io/horlogerie/privacidad.html`
   - Anuncios: no
   - Acceso a la app: sin restricciones (no hay inicio de sesión)
   - Clasificación de contenido: respuestas en `ficha.md`
   - Público objetivo: 18 años o más
   - Seguridad de los datos: respuestas en `seguridad-datos.md`
   - Aplicación gubernamental / financiera / de salud: no
5. **Prueba cerrada** (obligatoria en cuentas personales creadas después del 13/11/2023): crea una pista de prueba cerrada, sube el AAB, añade **al menos 12 testers** (lista de emails de Google) y que **sigan apuntados 14 días seguidos**. Luego solicita acceso a producción desde el panel.
6. Producción: promociona la versión de la prueba cerrada.

## 4. Después de publicar

- Los cambios de la web llegan solos a la app (la TWA carga la web).
- Solo hay que subir un AAB nuevo si cambia el envoltorio: icono, nombre, colores o el *target SDK* (cada verano Google sube el mínimo).

## Despliegue automático del Worker

`.github/workflows/deploy-worker.yml` despliega `worker/` en Cloudflare en cada cambio de esa carpeta. Para activarlo, una sola vez:

1. Cloudflare → My Profile → API Tokens → *Create Token* → plantilla **Edit Cloudflare Workers** → limita a tu cuenta.
2. GitHub → Delfos-IQ/horlogerie → Settings → Secrets and variables → Actions → *New repository secret*:
   - `CLOUDFLARE_API_TOKEN`: el token del paso 1
   - `CLOUDFLARE_ACCOUNT_ID`: aparece en la barra lateral de Workers & Pages
3. Cloudflare → Storage & Databases → KV → `HORLOGERIE`: copia el **ID** y ponlo en `worker/wrangler.toml` en lugar de `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

Mientras no esté configurado, el workflow falla con un mensaje claro y no toca nada.
