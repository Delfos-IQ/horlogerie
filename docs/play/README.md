# Publicar Rotor en Google Play

Guía paso a paso para empaquetar la PWA **Rotor** como app Android (TWA, *Trusted Web Activity*) y publicarla. La app de Play abre **`https://rotor.pedicode-app.workers.dev/app/`**: la app dentro de la web de Rotor, en el mismo repositorio (ver `web/README.md`). La TWA es un envoltorio que la abre a pantalla completa, sin barra del navegador. Cada `git push` actualiza también la app de Play, sin volver a subir nada (salvo cambios del envoltorio).

Esa dirección es gratuita y no caduca. Un dominio propio, si lo compras, va solo para la web (escaparate): si algún día lo dejas, la app de Play y los datos de los usuarios no se enteran. **No cambies nunca el host de la app de Play a un dominio comprado.** La copia de GitHub Pages (`https://delfos-iq.github.io/horlogerie/`) sigue funcionando para quien la use desde el navegador.

Material listo en esta carpeta:

| Archivo | Para qué |
|---|---|
| `ficha.md` | Título, descripciones (ES, EN y PT) y respuestas del cuestionario de contenido |
| `seguridad-datos.md` | Respuestas del formulario «Seguridad de los datos» |
| `capturas/es`, `capturas/en`, `capturas/pt` | 7 capturas 1080×1918 y el gráfico destacado 1024×500 por idioma (Pro incluido) |
| `assetlinks.json` | Plantilla del archivo que demuestra que la web y la app son tuyas |
| `twa-manifest.json` | Configuración para Bubblewrap (alternativa a PWABuilder) |
| `../../privacidad.html` | Política de privacidad pública: `https://rotor.pedicode-app.workers.dev/privacidad.html` (en inglés: `privacy.html`) |

Para regenerar las capturas: `python3 tools/play-screenshots.py` (con la app servida en local).

---

## 0. Antes de empezar (pendiente)

- [ ] Poner un email de contacto en `privacidad.html` (busca `[EMAIL DE CONTACTO]`). Es obligatorio.
- [ ] Decidir el nombre del paquete. Propuesta: `com.delfosiq.rotor`. **No se puede cambiar después de publicar.**

## 1. Generar el paquete Android (AAB)

**Opción recomendada: PWABuilder** (web, sin instalar nada)

1. Abre https://www.pwabuilder.com e introduce `https://rotor.pedicode-app.workers.dev/app/`. (O usa `twa-manifest.json` con Bubblewrap, que ya trae todo: host, colores, notificaciones y Play Billing.)
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

Android solo abre la app a pantalla completa si la web declara que la app es suya, en la raíz del dominio: `https://rotor.pedicode-app.workers.dev/.well-known/assetlinks.json`. Ya no hace falta otro repositorio: la web lo publica sola.

1. Rellena en `docs/play/assetlinks.json` **las dos** huellas SHA-256 (no son secretas):
   - la de tu **clave de subida**: sale en el ZIP de PWABuilder, o con `keytool -list -v -keystore android.keystore -alias rotor`;
   - la de **Play App Signing**: Play Console → Rotor → Configuración → Integridad de la app → Firma de apps → «Huella digital del certificado SHA-256».
2. Haz `git push`. La web solo publica el archivo cuando las dos huellas tienen el formato correcto (`AA:BB:…`, 32 pares).
3. Comprueba que `https://rotor.pedicode-app.workers.dev/.well-known/assetlinks.json` responde, y con la [herramienta de Google](https://developers.google.com/digital-asset-links/tools/generator).

## 3. Play Console

1. Crea la app: nombre `Rotor: rotación de relojes`, idioma predeterminado español (España), **App**, **Gratuita** (Pro va como producto integrado: ver 3 bis).
2. Acepta *Play App Signing* al subir el primer AAB.
3. **Ficha de Play Store**: textos de `ficha.md`, icono `icons/icon-512.png`, gráfico destacado y capturas de `capturas/`.
4. **Contenido de la aplicación**:
   - Política de privacidad: `https://rotor.pedicode-app.workers.dev/privacidad.html`
   - Anuncios: no
   - Acceso a la app: sin restricciones (no hay inicio de sesión)
   - Clasificación de contenido: respuestas en `ficha.md`
   - Público objetivo: 18 años o más
   - Seguridad de los datos: respuestas en `seguridad-datos.md`
   - Aplicación gubernamental / financiera / de salud: no
5. **Prueba cerrada** (obligatoria en cuentas personales creadas después del 13/11/2023): crea una pista de prueba cerrada, sube el AAB, añade **al menos 12 testers** (lista de emails de Google) y que **sigan apuntados 14 días seguidos**. Luego solicita acceso a producción desde el panel.
6. Producción: promociona la versión de la prueba cerrada.

## 3 bis. Rotor Pro (pago único, 5,99 €)

La app es gratuita y Pro se desbloquea con un **producto integrado no consumible** de Play. La TWA usa la *Digital Goods API* de Chrome; el Worker v15 verifica cada compra con Google.

1. **Cuenta de comerciante:** Play Console → Configuración → Perfil de pagos (sin ella no se pueden vender productos). Al ser persona física en Portugal, Google retiene el IVA de cada país; tú recibes el neto menos la comisión (15 % hasta 1 M$/año).
2. **Envoltorio con Play Billing:** en `twa-manifest.json` ya está `"playBilling": { "enabled": true }`. Con PWABuilder: *Options → Play Billing → Enable*. Hay que generar y subir un AAB nuevo (el de la v2.4 no lo lleva).
3. **Producto:** Play Console → Monetizar → Productos → Productos integrados → Crear: ID **`rotor_pro`** (exacto), nombre «Rotor Pro», precio 5,99 € (Play calcula el resto de monedas). Actívalo.
4. **Cuenta de servicio para verificar compras:**
   - Google Cloud Console → crea un proyecto (o usa uno) → habilita **Google Play Android Developer API**.
   - IAM → Cuentas de servicio → Crear → sin roles → Claves → Añadir clave → JSON. Descarga el archivo.
   - Play Console → Usuarios y permisos → Invitar usuario → el email de la cuenta de servicio → permisos de la app Rotor: **Ver información financiera** y **Gestionar pedidos y suscripciones**.
   - Cloudflare → Workers → horlogerie → Settings → Variables → **Secret** `GOOGLE_SERVICE_ACCOUNT` = el contenido entero del JSON. (Si el paquete no es `com.delfosiq.rotor`, añade la variable `PLAY_PACKAGE`.)
   - Comprueba `https://horlogerie.pedicode-app.workers.dev/health` → `"pro": true`.
5. **Probar sin pagar:** Play Console → Configuración → Pruebas de licencias → añade tu cuenta de Google. Instala la app desde la prueba interna: Play muestra «Tarjeta de prueba, siempre se aprueba».
6. En la web normal (fuera de Play) Pro no se puede comprar: la app lo explica y remite a Play.
7. **Avisos en el móvil (Pro):** el envoltorio debe llevar las notificaciones activadas (`"enableNotifications": true` en `twa-manifest.json`; en PWABuilder, *Notifications → Enable*). Android 13+ pide permiso la primera vez que el usuario activa los avisos en Ajustes. Los avisos en segundo plano usan *Periodic Background Sync* de Chrome: Android decide cuándo despierta la app (más o menos una vez al día, según el uso), así que pueden llegar con horas de retraso. Compruébalo en la prueba interna.

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
