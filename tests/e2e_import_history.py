"""
Pruebas de «Rellenar desde un enlace» y del historial en calendario.

Usa el Worker real en Node (tests/worker-harness.mjs) con Groq simulado y las
páginas de tests/fixtures servidas por la app local.

Uso (con la app en :8080 y el harness en el puerto indicado):
  python3 tests/e2e_import_history.py 8713
"""
import asyncio, os, sys
from playwright.async_api import async_playwright

PORT   = sys.argv[1] if len(sys.argv) > 1 else "8713"
APP    = "http://localhost:8080/horlogerie/"
FIX    = "http://localhost:8080/horlogerie/tests/fixtures/"
CHROME = os.environ.get("CHROME")
SHOTS  = os.environ.get("SHOTS")
DAY    = 86400000
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('  ✓ ' if cond else '  ✗ ') + name + (f'  [{detail}]' if detail and not cond else ''))

async def new_device(browser, health_override=None):
    ctx = await browser.new_context(viewport={"width": 412, "height": 900}, service_workers='block')
    async def route(r):
        url = r.request.url.replace("https://horlogerie.pedicode-app.workers.dev", f"http://localhost:{PORT}")
        if health_override and url.endswith('/health'):
            return await r.fulfill(status=200, content_type='application/json', body=health_override,
                                   headers={'Access-Control-Allow-Origin': '*'})
        resp = await r.fetch(url=url)
        await r.fulfill(response=resp)
    await ctx.route("https://horlogerie.pedicode-app.workers.dev/**", route)
    page = await ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    await page.goto(APP)
    await page.wait_for_function("typeof openImportSheet === 'function'")
    await page.wait_for_timeout(2300)
    return ctx, page, errs

async def main():
    print("\n=== Importar desde enlace y calendario ===")
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch())

        # ── Con un Worker antiguo (v11) la función no aparece ──
        ctx0, p0, _ = await new_device(b, '{"status":"ok","version":"11.0","caps":{"importUrl":true}}')
        await p0.evaluate("openAddModal()")
        await p0.click("#f-import-btn")
        await p0.wait_for_timeout(300)
        toast = await p0.inner_text("#toast")
        check("con el Worker v11 avisa de que no está disponible y no abre nada",
              'no está disponible' in toast and await p0.locator("#imp-url").count() == 0, toast)
        await ctx0.close()

        ctx, page, errs = await new_device(b)
        check("con el Worker v12 la función está disponible", await page.evaluate("serverSupportsImport()"))

        # ── Ficha de un reloj existente ──
        wid = await page.evaluate("addWatch({brand:'Steeldive', model:'Tuna', type:'automatic'}).then(w => w.id)")
        await page.evaluate("id => updateWatch(id, {specs: {cristal: 'Mineral'}})", wid)
        await page.evaluate("id => openDetail(id)", wid)
        await page.click("#d-import-btn")
        await page.fill("#imp-url", FIX + "oficial.html")
        await page.click("[data-act='read']")
        await page.wait_for_selector("#imp-rows .imp-row", timeout=15000)
        labels = await page.eval_on_selector_all("#imp-rows .imp-row .imp-label", "els => els.map(e => e.textContent)")
        check("muestra los datos encontrados", 'Calibre' in labels and 'Diámetro' in labels, str(labels))
        check("descarta el dato que no está en la página (grosor)", 'Grosor' not in labels)
        cristal_checked = await page.evaluate("document.querySelector('#imp-rows input[data-key=cristal]').checked")
        check("no marca para sobrescribir un dato distinto que ya tenías", cristal_checked is False)
        if SHOTS: await page.screenshot(path=f"{SHOTS}/importar.png")
        await page.click("[data-act='apply']")
        await page.wait_for_timeout(300)
        w = await page.evaluate("id => getWatch(id)", wid)
        check("aplica lo marcado y respeta lo que no", w['specs'].get('calibre') == 'Seiko NH35' and w['specs'].get('cristal') == 'Mineral'
              and w['specs'].get('asas') == '22 mm', str(w['specs']))
        check("guarda el enlace de origen", w.get('sourceUrl', '').endswith('oficial.html'))
        check("la ficha enlaza a la fuente", await page.locator(".source-link").count() == 1)

        # ── Página que bloquea la lectura → pegar texto ──
        await page.click("#d-import-btn")
        await page.fill("#imp-url", FIX + "bloqueado.html")
        await page.click("[data-act='read']")
        await page.wait_for_function("document.getElementById('imp-status').dataset.kind === 'error'", timeout=15000)
        opened = await page.evaluate("document.querySelector('.imp-paste').open")
        check("si la tienda bloquea, lo explica y abre «pegar texto»", opened)
        await page.fill("#imp-url", "")
        await page.fill("#imp-text", "Orient Bambino V2. Calibre F6724 automático. Diámetro 38,4 mm. Cristal mineral abombado.")
        await page.click("[data-act='read']")
        await page.wait_for_selector("#imp-rows .imp-row", timeout=15000)
        check("con texto pegado también funciona", await page.locator("#imp-rows .imp-row").count() >= 3)
        await page.click("[data-act='back']"); await page.click("[data-act='cancel']")

        # ── Alta de reloj desde enlace ──
        await page.evaluate("showView('home'); openAddModal()")
        check("en el alta aparece el botón", not await page.evaluate("document.getElementById('url-import-section').hidden"))
        await page.click("#f-import-btn")
        await page.fill("#imp-url", FIX + "oficial.html")
        await page.click("[data-act='read']")
        await page.wait_for_selector("#imp-rows .imp-row", timeout=15000)
        await page.click("[data-act='apply']")
        brand = await page.input_value("#f-brand")
        preview = await page.inner_text("#f-specs-section")
        check("rellena marca y modelo y muestra la vista previa", brand == 'Steeldive' and 'Seiko NH35' in preview)
        await page.evaluate("saveWatch()"); await page.wait_for_timeout(400)
        nw = await page.evaluate("getWatches().find(w => w.model === 'SD1975S Tuna Diver')")
        check("al guardar, el reloj nuevo lleva su ficha y su fuente", nw and nw['specs'].get('diametro') == '44 mm' and nw.get('sourceUrl'), str(nw and nw['specs']))

        # ── Autocompletado desde la base local ──
        await page.evaluate("openAddModal()")
        await page.fill("#f-brand", "Berny"); await page.fill("#f-model", "Open Heart Automatic")
        await page.evaluate("saveWatch()"); await page.wait_for_timeout(400)
        bw = await page.evaluate("getWatches().find(w => w.brand === 'Berny')")
        check("si el modelo está en la base, la ficha se rellena sola", bw and bw['specs'].get('calibre'), str(bw and bw.get('specs')))

        # ── Lista de deseos ──
        await page.evaluate("showView('wishlist'); openWishlistAdd()")
        await page.click("#wl-import-btn")
        await page.fill("#imp-url", FIX + "oficial.html")
        await page.click("[data-act='read']")
        await page.wait_for_selector("#imp-rows .imp-row", timeout=15000)
        await page.click("[data-act='apply']")
        await page.evaluate("saveWishlistItem()"); await page.wait_for_timeout(200)
        it = await page.evaluate("getWishlist()[0]")
        check("la lista de deseos se rellena y guarda (incluido entre asas y fuente)",
              it and it['specs'].get('asas') == '22 mm' and it.get('precio') and it.get('sourceUrl'), str(it))

        # ── Calendario ──
        await page.evaluate("showView('history')")
        check("el historial abre en el calendario", await page.evaluate("document.getElementById('history-calendar-view').style.display !== 'none'"))
        await page.evaluate(f"id => addWearDays(id, Date.now() - 2*{DAY}, Date.now() - 1*{DAY})", wid)
        await page.evaluate("renderCalendar()")
        worn_cells = await page.locator(".cal-cell.worn").count()
        check("los días usados aparecen marcados", worn_cells >= 1)
        # quitar un día de un rango de 3 días (partirlo)
        await page.evaluate(f"id => addWearDays(id, Date.now() - 9*{DAY}, Date.now() - 7*{DAY})", nw['id'])
        before = await page.evaluate("id => wearStats(getWatch(id)).daysWorn", nw['id'])
        r = await page.evaluate(f"id => removeWearDay(id, Date.now() - 8*{DAY})", nw['id'])
        after = await page.evaluate("id => ({d: wearStats(getWatch(id)).daysWorn, s: getWatch(id).history.length})", nw['id'])
        check("quitar el día central de un rango lo parte en dos", r is True and before == 3 and after == {'d': 2, 's': 2}, f"{before} → {after}")
        # hoja del día: añadir
        key = await page.evaluate(f"dayKey(Date.now() - 5*{DAY})")
        same_month = await page.evaluate(f"dayKey(Date.now() - 5*{DAY}).slice(0,7) === dayKey(Date.now()).slice(0,7)")
        if not same_month:
            await page.click("#cal-prev")
        await page.click(f".cal-cell[data-day='{key}']")
        await page.click(f".day-pick[data-add='{wid}']")
        has = await page.evaluate(f"id => wornDayKeys(getWatch(id)).has('{key}')", wid)
        check("desde la hoja del día se añade un reloj", has)
        if SHOTS: await page.screenshot(path=f"{SHOTS}/dia.png")
        await page.click(f".day-remove[data-remove='{wid}']")
        has = await page.evaluate(f"id => wornDayKeys(getWatch(id)).has('{key}')", wid)
        check("y se quita", not has)
        await page.click("[data-close]")
        summary = await page.inner_text("#cal-summary")
        check("resumen del mes con días y relojes", 'días con reloj' in summary or 'Sin usos' in summary, summary)
        future_disabled = await page.evaluate("[...document.querySelectorAll('.cal-cell[data-day]')].filter(c => c.dataset.day > dayKey(Date.now())).every(c => c.disabled)")
        check("los días futuros no se pueden tocar", future_disabled)
        if SHOTS:
            if not same_month: await page.click("#cal-next")
            await page.screenshot(path=f"{SHOTS}/calendario.png")
        check("sin errores de JavaScript", not errs, '; '.join(errs[:3]))
        await b.close()

    failed = [r for r in results if not r[1]]
    print(f"--- {len(results) - len(failed)}/{len(results)} OK")
    sys.exit(1 if failed else 0)

asyncio.run(main())
