"""
Pruebas de la copia en la nube simplificada (v2.8): clave corta de recuperación,
vincular dispositivos con un código de 6 caracteres, recuperar tras reinstalar,
indicador de error en la cabecera, recordatorio de copia JSON, Ajustes y Acerca de.

Usa el Worker real en Node (tests/worker-harness.mjs).
Uso (con la app en :8080 y el harness en el puerto indicado):
  python3 tests/e2e_cloud.py 8711
"""
import asyncio, json, os, re, sys, urllib.request, urllib.error
from playwright.async_api import async_playwright

PORT   = sys.argv[1] if len(sys.argv) > 1 else "8711"
APP    = "http://localhost:8080/horlogerie/"
WORKER = "https://horlogerie.pedicode-app.workers.dev"
CHROME = os.environ.get("CHROME")
SHOTS  = os.environ.get("SHOTS")
DAY    = 86400000
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('  ✓ ' if cond else '  ✗ ') + name + (f'  [{detail}]' if detail and not cond else ''))

def kv():
    return json.loads(urllib.request.urlopen(f"http://localhost:{PORT}/__kv").read())

async def device(browser, health=None, url=APP):
    ctx = await browser.new_context(viewport={"width": 412, "height": 900}, service_workers='block')
    async def route(r):
        u = r.request.url.replace(WORKER, f"http://localhost:{PORT}")
        if health and u.endswith('/health'):
            return await r.fulfill(status=200, content_type='application/json', body=health,
                                   headers={'Access-Control-Allow-Origin': '*'})
        resp = await r.fetch(url=u)
        await r.fulfill(response=resp)
    await ctx.route(f"{WORKER}/**", route)
    page = await ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    await page.goto(url)
    await page.wait_for_function("typeof openLinkSheet === 'function'")
    await page.wait_for_timeout(2300)
    return ctx, page, errs

SHORT = re.compile(r'^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$')

async def main():
    print("\n=== Copia en la nube, clave y vinculación ===")
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch())

        # ── Colección: cabecera limpia ──
        ca, a, ea = await device(b)
        check("la cabecera ya no tiene botones de actualizar ni sincronizar",
              await a.locator("#update-btn, #update-btn-icon").count() == 0
              and await a.evaluate("document.getElementById('sync-status-indicator').hidden"))
        check("colección vacía: ofrece recuperar mis relojes", await a.locator(".empty-recover").is_visible())
        await a.evaluate("""async () => { const w = await addWatch({ brand: 'Steeldive', model: 'SD1975S' });
                                          await updateWatch(w.id, { purchasePrice: 139 });
                                          const v = await addWatch({ brand: 'Seagull', model: '1963' });
                                          await updateWatch(v.id, { purchasePrice: 229 }); renderHome(); }""")
        sub = await a.text_content("#home-subtitle")
        check("subtítulo con número de relojes y lo invertido", sub == '2 relojes · 368 € invertidos', sub)

        # ── Ajustes ──
        await a.evaluate("showView('settings')"); await a.wait_for_timeout(300)
        check("fuera el panel «Colección» y el «Análisis de uso» de Ajustes",
              await a.locator("#settings-stats, #settings-advanced-stats").count() == 0)
        check("un solo botón de actualizar (en Estado del sistema)",
              await a.locator("#view-settings [onclick='checkForUpdate()']").count() == 1)
        links = await a.eval_on_selector_all(".about-links a", "as => as.map(a => a.getAttribute('href'))")
        check("Acerca de: ayuda, privacidad, licencias y contacto",
              links == ['./ayuda.html', './privacidad.html', './licencias.html', 'mailto:pedicode.app@gmail.com?subject=Rotor'], str(links))
        vsub = await a.inner_text("#status-version-sub")
        check("versión con fecha de publicación", vsub.startswith('Publicada el'), vsub)
        check("con la nube apagada no hay botón de sincronizar", await a.evaluate("document.getElementById('status-sync-btn').hidden"))

        # ── Activar la nube: clave corta y aviso para guardarla ──
        await a.click("label[for='cloud-toggle']")
        await a.wait_for_selector("#sk-done", timeout=8000)
        key = await a.evaluate("getSessionId()")
        check("la clave nueva es corta (16 caracteres en grupos)", bool(SHORT.match(key)), key)
        check("se sube con esa clave", f"user:{key.lower()}:watches" in kv()['keys'])
        check("al activar la nube pide guardar la clave", await a.inner_text("#sk-key") == key)
        if SHOTS: await a.screenshot(path=f"{SHOTS}/guardar-clave.png")
        await a.click("[data-close]")
        await a.wait_for_timeout(300)
        check("si no la confirma, Ajustes lo recuerda", await a.locator("#cloud-key-warn:not([hidden])").count() == 1)
        await a.click("#cloud-key-warn .link-btn"); await a.click("#sk-done"); await a.wait_for_timeout(300)
        check("al confirmar desaparece el aviso", await a.evaluate("document.getElementById('cloud-key-warn').hidden")
              and await a.evaluate("!!getSyncMeta().keySavedAt"))
        val = await a.inner_text("#status-sync-val")
        check("estado de la nube: sincronizada", val.startswith('Sincronizada'), val)
        if SHOTS: await a.screenshot(path=f"{SHOTS}/ajustes-nube.png", full_page=True)

        # ── Vincular: código de 6 caracteres ──
        await a.click("#btn-link-device")
        await a.wait_for_selector("#pair-code", timeout=8000)
        shown = await a.inner_text("#pair-code")
        code = shown.replace('-', '')
        check("vincular muestra un código de 6 caracteres", bool(re.fullmatch(r'[2-9A-HJKMNP-Z]{6}', code)), shown)
        check("y un QR con el enlace (generado en el dispositivo)", await a.locator(".pair-qr svg").count() == 1)
        check("cuenta atrás de 10 minutos", (await a.inner_text("#pair-timer")).startswith('Caduca en 9:') or
              (await a.inner_text("#pair-timer")).startswith('Caduca en 10:'))
        if SHOTS: await a.screenshot(path=f"{SHOTS}/vincular.png")
        await a.click("[data-close]")

        cb, bb, eb = await device(b)
        await bb.click(".empty-recover")
        await bb.fill("#link-input", "zzzzzz")
        await bb.click("#link-go"); await bb.wait_for_timeout(600)
        st = await bb.inner_text("#link-status")
        check("un código erróneo se explica y no hace nada", 'no válido' in st.lower() and await bb.evaluate("getWatches().length") == 0, st)
        await bb.fill("#link-input", shown.lower())
        await bb.click("#link-go")
        await bb.wait_for_function("getWatches().length === 2", timeout=8000)
        check("con el código, el otro dispositivo recibe la colección", True)
        check("y queda con la misma clave y la nube activada",
              await bb.evaluate("getSessionId()") == key and await bb.evaluate("isCloudEnabled()"))
        r = await bb.evaluate(f"""fetch('{WORKER}/pair/claim', {{method:'POST', headers:{{'Content-Type':'application/json'}}, body: JSON.stringify({{code:'{code}'}})}}).then(r => r.status)""")
        check("el código solo sirve una vez", r == 404, str(r))

        # ── Reinstalar: recuperar con la clave (sin guiones y en minúsculas) ──
        cc, c, ec = await device(b)
        await c.click(".empty-recover")
        await c.fill("#link-input", key.replace('-', '').lower().replace('0', 'o'))
        await c.click("#link-go")
        await c.wait_for_function("getWatches().length === 2", timeout=8000)
        check("tras reinstalar, la clave recupera todo (aunque se teclee sin guiones, en minúsculas y con O por 0)", True)

        # ── Abrir el enlace del QR ──
        await a.evaluate("pairCreate().then(d => window._code = d.code)")
        await a.wait_for_function("!!window._code")
        code2 = await a.evaluate("window._code")
        cd, d, ed = await device(b, url=APP + f"#vincular={code2}")
        await d.wait_for_selector("#link-input", timeout=5000)
        pre = await d.input_value("#link-input")
        check("el enlace del QR abre «Usar una clave o código» con el código puesto",
              pre.replace('-', '') == code2 and '#' not in d.url, f"{pre} {d.url}")
        await d.click("#link-go")
        await d.wait_for_function("getWatches().length === 2", timeout=8000)
        check("y con un toque se vincula", True)

        # ── Worker v12 todavía en producción: se mantiene la clave larga ──
        ce, e, ee = await device(b, health='{"status":"ok","version":"12.0","caps":{"importUrl":true}}')
        await e.evaluate("handleCloudToggle(true)"); await e.wait_for_timeout(800)
        k12 = await e.evaluate("getSessionId()")
        check("con el Worker v12 la clave sigue siendo un UUID (compatibilidad)", len(k12) == 36, k12)
        await e.click("#sk-done")
        await e.evaluate("openPairSheet()"); await e.wait_for_timeout(500)
        txt = await e.inner_text("#pair-body")
        check("y vincular explica que aún no hay códigos y muestra la clave", 'aún no admite' in txt and k12 in txt, txt[:120])

        # ── Indicador de error en la cabecera ──
        await a.evaluate("showView('home'); setSyncUI('error', 'Sin conexión')")
        check("si la nube falla, aparece el aviso en la cabecera",
              await a.evaluate("!document.getElementById('sync-status-indicator').hidden"))
        await a.click("#sync-status-indicator"); await a.wait_for_timeout(300)
        check("y lleva a Ajustes con el problema explicado",
              await a.evaluate("document.getElementById('view-settings').classList.contains('active')")
              and 'No se pudo' in await a.inner_text("#status-sync-val"))
        await a.evaluate("setSyncUI('ok', 'ok')")
        check("al volver a sincronizar desaparece", await a.evaluate("document.getElementById('sync-status-indicator').hidden"))

        # ── Recordatorio de copia JSON (nube apagada) ──
        cf, f, ef = await device(b)
        await f.evaluate(f"""async () => {{ const w = await addWatch({{ brand: 'Casio', model: 'Duro' }});
                                          getWatch(w.id).created = Date.now() - 10*{DAY}; renderHome(); }}""")
        check("sin nube y sin copia reciente, recuerda hacer una", await f.locator(".backup-reminder").count() == 1)
        if SHOTS: await f.screenshot(path=f"{SHOTS}/recordatorio.png")
        await f.click("#br-x")
        await f.evaluate("renderHome()")
        check("se puede posponer un mes", await f.locator(".backup-reminder").count() == 0)
        await f.evaluate("localStorage.removeItem('horlogerie_last_backup_snooze'); renderHome()")
        async with f.expect_download() as dl:
            await f.click("#br-do")
        await (await dl.value).path()
        await f.evaluate("renderHome()")
        check("al hacer la copia desaparece", await f.locator(".backup-reminder").count() == 0)
        await f.evaluate("showView('settings')")
        check("y Ajustes muestra cuándo fue la última", 'Última copia: hoy' in await f.inner_text("#backup-card-sub"))

        # ── Historial: los dos datos de uso, encima del ranking ──
        await a.evaluate("showView('history'); setHistoryMode('ranking', true)"); await a.wait_for_timeout(200)
        check("Historial muestra rotación de 30 días y media entre usos", await a.locator("#ranking-body .insight").count() == 2)

        # ── Páginas de ayuda y licencias ──
        for page_name, needle in [('ayuda.html', 'Cambié de móvil'), ('licencias.html', 'jsPDF'), ('privacidad.html', 'pedicode.app@gmail.com')]:
            pg = await ca.new_page(); await pg.goto(APP + page_name)
            check(f"{page_name} carga y tiene su contenido", needle in await pg.content())
            await pg.close()

        # ── El lector de páginas no responde a llamadas de fuera de la app ──
        req = urllib.request.Request(f"http://localhost:{PORT}/import-url", data=b'{"url":"https://example.com"}', method='POST',
                                     headers={'Content-Type': 'application/json', 'X-Test-Origin': 'none'})
        try: code_out = urllib.request.urlopen(req).status
        except urllib.error.HTTPError as e: code_out = e.code
        check("leer páginas solo desde la app (sin origen: 403)", code_out == 403, str(code_out))

        # ── Límite de intentos con códigos ──
        statuses = await bb.evaluate(f"""async () => {{ const out = [];
            for (let i = 0; i < 12; i++) out.push((await fetch('{WORKER}/pair/claim', {{method:'POST',
              headers:{{'Content-Type':'application/json'}}, body: JSON.stringify({{code:'ZZZZZZ'}})}})).status);
            return out; }}""")
        check("demasiados intentos de código: el servidor corta (429)", 429 in statuses, str(statuses))

        allerrs = ea + eb + ec + ed + ee + ef
        check("sin errores de JavaScript", not allerrs, '; '.join(allerrs[:3]))
        await b.close()

    failed = [r for r in results if not r[1]]
    print(f"--- {len(results) - len(failed)}/{len(results)} OK")
    sys.exit(1 if failed else 0)

asyncio.run(main())
