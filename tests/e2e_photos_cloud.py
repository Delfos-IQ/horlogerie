"""
Fotos y nube (v2.24.1): una foto que falta en un dispositivo nunca se «borra» en la nube
ni en los demás, un dispositivo al que le faltan fotos las recupera, y la app en inglés
arranca igual que en español (service worker y sincronización al abrir).

Uso (con la app en :8080 y el harness CON base de datos en el puerto indicado):
  python3 tests/e2e_photos_cloud.py 8711
"""
import asyncio, json, os, sys, urllib.request
from playwright.async_api import async_playwright

PORT   = sys.argv[1] if len(sys.argv) > 1 else "8711"
APP    = "http://localhost:8080/horlogerie/"
WORKER = "https://horlogerie.pedicode-app.workers.dev"
CHROME = os.environ.get("CHROME")
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('  ✓ ' if cond else '  ✗ ') + name + (f'  [{detail}]' if detail and not cond else ''))

def sql(q, *args):
    req = urllib.request.Request(f"http://localhost:{PORT}/__sql", data=json.dumps({'sql': q, 'args': list(args)}).encode(), method='POST')
    return json.loads(urllib.request.urlopen(req).read())

PHOTO_JS = """(seed) => { const c=document.createElement('canvas'); c.width=c.height=300;
  const g=c.getContext('2d'); g.fillStyle=`hsl(${seed*47%360},70%,45%)`; g.fillRect(0,0,300,300);
  g.fillStyle='#fff'; g.fillRect(seed*20%250,40,50,50); return c.toDataURL('image/jpeg', 0.9); }"""

async def device(browser, locale="es-ES"):
    ctx = await browser.new_context(locale=locale, viewport={"width": 412, "height": 900}, service_workers='block', bypass_csp=True)
    async def route(r):
        resp = await r.fetch(url=r.request.url.replace(WORKER, f"http://localhost:{PORT}"))
        await r.fulfill(response=resp)
    await ctx.route(f"{WORKER}/**", route)
    page = await ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    await page.goto(APP)
    await page.wait_for_function("typeof syncPush === 'function'")
    await page.wait_for_timeout(2200)
    return ctx, page, errs

async def photo_count(page):
    return await page.evaluate("Promise.all(getWatches().map(w => getPhotoDataUrl(w.id))).then(ps => ps.filter(Boolean).length)")

async def main():
    print("\n=== Fotos y nube ===")
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch())

        # A: 3 relojes con foto, nube activada
        ca, a, ea = await device(b)
        for i in range(3):
            ph = await a.evaluate(PHOTO_JS, i + 1)
            await a.evaluate("async ([b, m, p]) => { await addWatch({ brand: b, model: m, photo: p }); }", [f"Marca{i}", f"Modelo{i}", ph])
        await a.evaluate("handleCloudToggle(true)")
        await a.wait_for_selector("#sk-done", timeout=15000); await a.click("#sk-done")
        key = await a.evaluate("getSessionId()")
        ids = await a.evaluate("getWatches().map(w => w.id)")
        marks = ','.join('?' * len(ids))
        server = lambda: sql(f"SELECT COUNT(*) AS n FROM items WHERE kind = 'w' AND photo IS NOT NULL AND photo <> '' AND id IN ({marks})", *ids)[0]['n']
        check("las 3 fotos están en la nube", server() == 3)

        # B (en inglés): recupera con la clave
        cb, bb, eb = await device(b, "en-GB")
        await bb.evaluate("openLinkSheet()"); await bb.fill("#link-input", key); await bb.click("#link-go")
        await bb.wait_for_function("getWatches().length === 3", timeout=15000)
        await bb.wait_for_timeout(500)
        check("B recibe las 3 fotos", await photo_count(bb) == 3)

        # B pierde las fotos (borrado de datos del navegador, almacenamiento lleno…) y sincroniza
        await bb.evaluate("Promise.all(getWatches().map(w => idbDeletePhoto(w.id)))")
        wid = await bb.evaluate("getWatches()[0].id")
        await bb.evaluate(f"updateWatch('{wid}', {{ notes: 'cambio en B' }})")
        await bb.evaluate("syncPush()")
        await bb.wait_for_timeout(500)
        check("una foto que falta en B NO se borra en la nube", server() == 3, str(server()))
        await a.evaluate("syncPull(true)"); await a.wait_for_timeout(300)
        check("ni en A", await photo_count(a) == 3)
        check("y el cambio de B sí llega a A", await a.evaluate(f"getWatch('{wid}').notes") == 'cambio en B')

        # B vuelve a abrir la app: recupera sus fotos (reparación de una vez)
        await bb.reload(); await bb.wait_for_function("typeof syncPush === 'function'"); await bb.wait_for_timeout(2500)
        await bb.evaluate("syncPush()"); await bb.wait_for_timeout(800)
        check("B recupera las fotos que le faltaban", await photo_count(bb) == 3, str(await photo_count(bb)))

        # Si en la nube faltara una foto ('' de una versión antigua), quien la tiene la conserva y la vuelve a subir
        sql("UPDATE items SET photo = '', photo_rev = rev + 1, rev = rev + 1 WHERE id = ?", wid)
        await a.evaluate("syncPush()"); await a.wait_for_timeout(500)
        check("A conserva su foto aunque la nube diga que no hay", await a.evaluate(f"getPhotoDataUrl('{wid}').then(Boolean)"))
        await a.evaluate("syncPush()"); await a.wait_for_timeout(500)
        check("y la vuelve a subir", server() == 3, str(server()))

        # Arranque en inglés: la sincronización al abrir funciona
        before = sql(f"SELECT MAX(rev) AS r FROM items WHERE id IN ({marks})", *ids)[0]['r']
        await bb.evaluate(f"updateWatch('{wid}', {{ notes: 'abierto en inglés' }})")
        await bb.reload(); await bb.wait_for_timeout(4500)
        got = sql(f"SELECT MAX(rev) AS r FROM items WHERE id IN ({marks})", *ids)[0]['r']
        check("en inglés, al abrir la app se sincroniza sola", got > before, f"{before} → {got}")

        check("sin errores de JavaScript", not (ea + eb), (ea + eb)[:3])
        await b.close()
    ok = sum(1 for _, c in results if c)
    print(f"--- {ok}/{len(results)} OK")
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
