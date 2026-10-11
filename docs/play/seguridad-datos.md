# Seguridad de los datos — respuestas para Play Console

Basado en el comportamiento de la v2.3.0. Si cambias qué datos salen del dispositivo (por ejemplo, al reactivar la importación desde URL con IA), revisa este formulario **antes** de publicar: Google exige declarar también los datos enviados a servicios de IA de terceros.

## Recogida y uso compartido

| Pregunta | Respuesta | Motivo |
|---|---|---|
| ¿La app recoge o comparte alguno de los tipos de datos obligatorios? | **Sí** | Con la copia en la nube activada, la colección y las fotos salen del dispositivo |
| ¿Todos los datos se cifran en tránsito? | **Sí** | Todo va por HTTPS |
| ¿Ofreces una forma de solicitar la eliminación de los datos? | **Sí** | Ajustes → «Borrar de la nube», y email de contacto en la política |

## Tipos de datos

Marca estos dos (y el de diagnóstico de la nota de abajo). En los dos: **recogido sí, compartido no** (Cloudflare actúa como proveedor de servicio; eso no cuenta como «compartir»), **recogida opcional** (el usuario la activa) y finalidad **funciones de la app**.

| Categoría | Tipo | ¿Efímero? |
|---|---|---|
| Fotos y vídeos | **Fotos** | No |
| Actividad en la app | **Otro contenido generado por el usuario** (relojes, notas, historial de uso, lista de deseos) | No |

## Lo que **no** se recoge (no marcar)

Ubicación, información personal (nombre, email, dirección…), información financiera (el precio pagado se guarda como contenido del usuario, no como dato de pago), salud, mensajes, contactos, calendario, identificadores de dispositivo o de publicidad, historial web, archivos de audio, resto de «Información y rendimiento de la app» (no hay analítica ni informes de fallos).

> El Worker guarda un hash de la IP (nunca la IP) durante 1 h para limitar abusos y 24 h en el registro de errores, sin vincularlo a la colección. Para ir sobre seguro, declara también **Información y rendimiento de la app → Diagnóstico**: recogido, no compartido, no opcional, finalidad «Prevención de fraude, seguridad y cumplimiento». Si añades analítica, actualiza el formulario.

## Otras secciones de «Contenido de la aplicación»

- **Anuncios:** No contiene anuncios.
- **Acceso a la app:** Toda la funcionalidad está disponible sin restricciones.
- **Público objetivo:** 18 años o más. La app no está diseñada para menores.
- **Funciones con IA:** «Rellenar desde un enlace» envía el enlace (o el texto pegado) a Groq, un proveedor de IA, para extraer especificaciones. No genera contenido para otros usuarios ni conversaciones: es extracción de datos. Si Play pregunta por funciones de IA generativa, responde que la app usa IA para extraer datos de páginas que el usuario indica, a petición suya.

## Rellenar desde un enlace (desde la v2.5)

Lo que se envía es una URL pública o un texto que pega el usuario. Decláralo en **Actividad en la app → Otro contenido generado por el usuario** (ya marcado), añadiendo la finalidad «Funciones de la app». Es **opcional** (solo si el usuario usa la función) y **no compartido**: el Worker y Groq actúan como proveedores de servicio. Política de privacidad: sección «Rellenar desde un enlace».
