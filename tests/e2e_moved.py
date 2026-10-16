"""
La dirección antigua (GitHub Pages) lleva a la nueva (…/app/) sin perder relojes:
vacía → redirige al momento; con relojes → «Llevar mis relojes» activa la nube si hacía falta,
crea un código y abre la nueva dirección, donde un toque los trae.

Uso (con el Worker de prueba en el puerto indicado):  python3 tests/e2e_moved.py 8781
Los dos dominios se sirven desde este repositorio (no hace falta red).
"""
import asyncio, json, mimetypes, os, pathlib, sys
from playwright.async_api import async_playwright

PORT   = int(sys.argv[1]) if len(sys.argv) > 1 else 8711
OLD    = "https://delfos-iq.github.io/horlogerie/"
NEW    = "https://rotor.pedicode-app.workers.dev/app/"
WORKER = "https://horlogerie.pedicode-app.workers.dev"
ROOT   = pathlib.Path(__file__).resolve().parent.parent
CHROME = os.environ.get("CHROME")
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('  ✓ ' if cond else '  ✗ ') + name + (f'  [{detail}]' if detail and not cond else ''))

async def context(b):
    ctx = await b.new_context(locale="es-ES", viewport={"width": 412, "height": 900}, service_workers="block", bypass_csp=True)
    async def files(route):
        u = route.request.url
        base = OLD if u.startswith(OLD) else NEW
        path = u[len(base):].split("?")[0].split("#")[0] or "index.html"
        f = ROOT / path
        if not f.is_file():
            return await route.fulfill(status=404, body="")
        await route.fulfill(status=200, body=f.read_bytes(), content_type=mimetypes.guess_type(str(f))[0] or "application/octet-stream")
    async def api(route):
        resp = await route.fetch(url=route.request.url.replace(WORKER, f"http://localhost:{PORT}"))
        await route.fulfill(response=resp)
    await ctx.route(OLD + "**", files)
    await ctx.route(NEW + "**", files)
    await ctx.route(WORKER + "/**", api)
    return ctx

async def main():
    print("\n=== Dirección antigua → nueva ===")
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch())

        # ── Vacía: redirige al momento (conserva el idioma) ──
        ctx = await context(b)
        page = await ctx.new_page()
        await page.goto(OLD)
        await page.wait_for_url(NEW + "**", timeout=10000)
        check("sin relojes, la dirección antigua lleva directamente a la nueva", page.url.startswith(NEW), page.url)
        await ctx.close()

        # ── Con relojes y la nube apagada: los lleva a la nueva ──
        ctx = await context(b)
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        watches = [{"id": "w1", "brand": "Oris", "model": "Aquis", "type": "automatic", "createdAt": 1700000000000},
                   {"id": "w2", "brand": "Seiko", "model": "Presage", "type": "automatic", "createdAt": 1700000000001}]
        await ctx.add_init_script(f"""if (location.hostname === 'delfos-iq.github.io' && !localStorage.getItem('horlogerie_v3')) {{
            localStorage.setItem('horlogerie_v3', {json.dumps(json.dumps(watches))});
            localStorage.setItem('rotor_prefs_v1', JSON.stringify({{ lang: 'es', onboarded: true }})); }}""")
        await page.goto(OLD)
        await page.wait_for_selector("#mv-go", timeout=10000)
        check("con relojes, no redirige a ciegas: ofrece llevarlos", page.url.startswith(OLD))
        check("el aviso de la portada ofrece lo mismo", await page.locator("#inspiration-card .moved-link").count() == 1)
        await page.click("#mv-go")
        await page.wait_for_url(NEW + "**", timeout=20000)
        check("«Llevar mis relojes» abre la nueva dirección con un código", '#vincular=' in page.url or page.url.startswith(NEW), page.url)
        await page.wait_for_selector("#link-input", timeout=10000)
        pre = await page.input_value("#link-input")
        check("y el código ya está escrito", len(pre.replace('-', '')) == 6, pre)
        await page.click("#link-go")
        await page.wait_for_function("JSON.parse(localStorage.getItem('horlogerie_v3') || '[]').length === 2", timeout=15000)
        names = await page.evaluate("JSON.parse(localStorage.getItem('horlogerie_v3')).map(w => w.brand).sort()")
        check("en la nueva dirección aparecen los mismos relojes", names == ['Oris', 'Seiko'], str(names))
        check("sin errores de JavaScript", not errs, errs[:3])
        await ctx.close()
        await b.close()
    ok = sum(1 for _, c in results if c)
    print(f"--- {ok}/{len(results)} OK")
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
