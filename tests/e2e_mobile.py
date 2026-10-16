"""
Móvil y ordenador: fotos (cámara y galería), gesto «atrás», idioma al llegar desde la web
(la dirección antigua se prueba en e2e_moved.py).

Uso (con la app en :8080):  python3 tests/e2e_mobile.py
"""
import asyncio, base64, mimetypes, os, pathlib
from playwright.async_api import async_playwright

APP    = "http://localhost:8080/horlogerie/"
ROOT   = pathlib.Path(__file__).resolve().parent.parent
CHROME = os.environ.get("CHROME")
PNG    = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('  ✓ ' if cond else '  ✗ ') + name + (f'  [{detail}]' if detail and not cond else ''))

async def boot(page, url=APP):
    await page.context.route("https://horlogerie.pedicode-app.workers.dev/**", lambda r: r.abort())
    await page.goto(url)
    await page.wait_for_function("typeof renderHome === 'function'")
    await page.wait_for_timeout(2200)
    await page.keyboard.press("Escape")

async def main():
    print("\n=== Móvil y ordenador ===")
    async with async_playwright() as p:
        args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
        b = await (p.chromium.launch(executable_path=CHROME, args=args) if CHROME else p.chromium.launch(args=args))

        # ── Móvil: fotos con la cámara y la galería ──
        ctx = await b.new_context(**p.devices['Pixel 7'], locale="es-ES", service_workers="block", bypass_csp=True)
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        await boot(page)
        await page.evaluate("localStorage.setItem('rotor_prefs_v1', JSON.stringify({ lang: 'es', onboarded: true }))")
        await page.evaluate("openAddModal()")
        for src, label in (("camera", "la cámara"), ("library", "la galería")):
            await page.tap("#photo-area"); await page.wait_for_timeout(200)
            try:
                async with page.expect_file_chooser(timeout=3000) as fc:
                    await page.tap(f"#photo-src-{src}")
                chooser = await fc.value
                ok = True
            except Exception:
                ok, chooser = False, None
            check(f"móvil: «{'Hacer una foto' if src == 'camera' else 'Elegir de la librería'}» abre {label}", ok)
            check(f"  y la hoja se cierra", await page.eval_on_selector("#photo-sheet", "e => e.style.display") == 'none')
            if chooser and src == 'library':
                await chooser.set_files(files=[{"name": "reloj.png", "mimeType": "image/png", "buffer": PNG}])
                await page.wait_for_function("document.getElementById('photo-preview').style.display === 'block'", timeout=5000)
                check("la foto elegida aparece en la ficha", True)
        cam_capture = await page.get_attribute("#photo-input-camera", "capture")
        check("en el móvil, la cámara se pide al sistema (capture)", cam_capture == "environment")

        # ── Móvil: «atrás» siempre vuelve a la colección; desde la colección, sale ──
        await page.evaluate("closeAddModal()")
        await page.tap("#nav-settings"); await page.wait_for_timeout(150)
        await page.tap("#nav-history"); await page.wait_for_timeout(150)
        await page.tap("#nav-wishlist"); await page.wait_for_timeout(150)
        check("varias secciones seguidas dejan una sola entrada sobre la colección", await page.evaluate("history.state.above === true && history.state.view === 'wishlist'"))
        await page.go_back(); await page.wait_for_timeout(250)
        check("atrás desde Deseos (tras pasar por Ajustes e Historial) vuelve a la colección",
              await page.evaluate("document.querySelector('.view.active').id") == 'view-home' and page.url.startswith(APP))
        await page.tap("#nav-settings"); await page.wait_for_timeout(150)
        await page.tap("#nav-home"); await page.wait_for_timeout(250)
        check("ir a la colección con el menú quita la entrada: el siguiente «atrás» sale de la app",
              not await page.evaluate("!!history.state?.above"))
        await page.tap("#nav-settings"); await page.wait_for_timeout(150)
        await page.evaluate("showView('home'); openAddModal()"); await page.wait_for_timeout(300)
        check("volver a la colección y abrir enseguida «Añadir» no cierra la ficha",
              await page.eval_on_selector("#add-modal", "e => e.style.display") == 'flex')
        await page.evaluate("closeAddModal()")
        has_cw = await page.evaluate("typeof CloseWatcher === 'function'")
        if has_cw:
            await page.tap("#nav-history"); await page.wait_for_timeout(150)
            await page.keyboard.press("Escape"); await page.wait_for_timeout(300)   # Chromium sends Escape to the CloseWatcher, like Android's back
            check("CloseWatcher (gesto de Android): desde Historial vuelve a la colección",
                  await page.evaluate("document.querySelector('.view.active').id") == 'view-home')
            await page.evaluate("openAddModal()"); await page.wait_for_timeout(100)
            await page.keyboard.press("Escape"); await page.wait_for_timeout(200)
            check("CloseWatcher: con una ficha abierta, primero la cierra",
                  await page.eval_on_selector("#add-modal", "e => e.style.display") == 'none')
        check("sin errores de JavaScript (móvil)", not errs, errs[:3])
        await ctx.close()

        # ── Ordenador: «Hacer una foto» usa la webcam ──
        ctx = await b.new_context(locale="es-ES", viewport={"width": 1280, "height": 860}, service_workers="block", bypass_csp=True,
                                  permissions=["camera"])
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        await boot(page)
        await page.evaluate("openAddModal()")
        await page.click("#photo-area"); await page.wait_for_timeout(200)
        await page.click("#photo-src-camera")
        await page.wait_for_selector(".cam-video", timeout=5000)
        await page.wait_for_function("document.querySelector('.cam-video').videoWidth > 0", timeout=8000)
        check("ordenador: «Hacer una foto» abre la webcam dentro de Rotor", True)
        await page.click("#cam-shot")
        await page.wait_for_function("document.getElementById('photo-preview').style.display === 'block'", timeout=5000)
        check("  y la foto queda en la ficha (y la cámara se apaga)", await page.locator(".cam-video").count() == 0)
        await page.click("#photo-area"); await page.wait_for_timeout(200)
        try:
            async with page.expect_file_chooser(timeout=3000):
                await page.click("#photo-src-library")
            ok = True
        except Exception:
            ok = False
        check("ordenador: «Elegir de la librería» abre el selector de archivos", ok)
        check("sin errores de JavaScript (ordenador)", not errs, errs[:3])
        await ctx.close()

        # ── Aviso de navegador: Mi Browser, Instagram… (Chrome no lo ve) ──
        MI = ("Mozilla/5.0 (Linux; U; Android 14; es-es; 23078PND5G Build/UKQ1.230804.001) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Version/4.0 Chrome/112.0.5615.136 Mobile Safari/537.36 XiaoMi/MiuiBrowser/14.10.1-gn")
        IG = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
              "Mobile/15E148 Instagram 340.0.0.22.109 (iPhone15,3; iOS 17_5; es_ES; es)")
        ctx = await b.new_context(**p.devices['Pixel 7'], locale="es-ES", service_workers="block", bypass_csp=True)
        page = await ctx.new_page()
        await boot(page)
        check("en Chrome no hay aviso de navegador (ni línea en Ajustes)",
              await page.evaluate("document.getElementById('browser-notice').hidden && document.getElementById('status-browser-row').hidden"))
        await ctx.close()
        ctx = await b.new_context(**{**p.devices['Pixel 7'], 'user_agent': MI}, locale="es-ES", service_workers="block", bypass_csp=True)
        page = await ctx.new_page()
        await boot(page)
        txt = await page.text_content("#browser-notice") or ''
        href = await page.get_attribute("#browser-notice .bn-open", "href") or ''
        check("en Mi Browser: aviso «Rotor va mejor en Chrome»", 'Mi Browser' in txt and 'Chrome' in txt, txt[:90])
        check("  con «Abrir en Chrome» (misma página, en Chrome)",
              href.startswith("intent://localhost:8080/horlogerie/") and "package=com.android.chrome" in href, href[:120])
        await page.click("#browser-notice .bn-ok")
        check("  «Entendido» lo oculta", await page.evaluate("document.getElementById('browser-notice').hidden"))
        await boot(page)
        check("  y no vuelve a salir durante un mes", await page.evaluate("document.getElementById('browser-notice').hidden"))
        row = await page.evaluate("document.getElementById('status-browser-row').hidden ? '' : document.getElementById('status-browser-sub').textContent")
        check("  mientras tanto, queda una línea en Ajustes → Estado del sistema", 'Mi Browser' in row and 'Abrir en Chrome' in row, row)
        await page.evaluate("const v = JSON.parse(localStorage.getItem('rotor_browser_notice')); v.at -= 31 * 864e5; localStorage.setItem('rotor_browser_notice', JSON.stringify(v))")
        await boot(page)
        check("  pasado un mes, vuelve como recordatorio", not await page.evaluate("document.getElementById('browser-notice').hidden"))
        await ctx.close()
        ctx = await b.new_context(locale="en-GB", user_agent=IG, viewport={"width": 390, "height": 844}, service_workers="block", bypass_csp=True)
        page = await ctx.new_page()
        await boot(page)
        txt = await page.text_content("#browser-notice") or ''
        check("dentro de Instagram (iPhone, en inglés): avisa sin botón de Chrome",
              'inside Instagram' in txt and await page.locator("#browser-notice .bn-open").count() == 0, txt[:90])
        await ctx.close()

        # ── Desde la web: la app abre en el idioma de la página (si no has elegido otro) ──
        ctx = await b.new_context(locale="es-ES", service_workers="block", bypass_csp=True)
        page = await ctx.new_page()
        await boot(page, APP + "?lang=en")
        check("llega desde la web en inglés: la app abre en inglés", await page.evaluate("lang()") == 'en')
        check("  y la dirección queda limpia (sin ?lang)", '?lang' not in page.url, page.url)
        await page.evaluate("setPref('lang', 'pt')")
        await boot(page, APP + "?lang=en")
        check("si ya elegiste idioma en la app, se respeta", await page.evaluate("lang()") == 'pt')
        await ctx.close()

        await b.close()
    ok = sum(1 for _, c in results if c)
    print(f"--- {ok}/{len(results)} OK")
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
