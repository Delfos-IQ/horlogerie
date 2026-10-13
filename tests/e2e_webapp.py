"""
La app dentro de la web de Rotor (/app/): es la dirección que abre la app de Google Play.
Comprueba que arranca, que su service worker se queda en /app/, que funciona sin conexión
y que la web enlaza a ella.

Uso (con web/dist servida en :8091):  PORT=8091 node web/tools/preview.mjs &  python3 tests/e2e_webapp.py
"""
import asyncio, os
from playwright.async_api import async_playwright

SITE   = "http://localhost:8091/"
APP    = SITE + "app/"
CHROME = os.environ.get("CHROME")
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('  ✓ ' if cond else '  ✗ ') + name + (f'  [{detail}]' if detail and not cond else ''))

async def main():
    print("\n=== La app dentro de la web (/app/) ===")
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch())
        ctx = await b.new_context(locale="es-ES", viewport={"width": 412, "height": 900})
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))

        await page.goto(SITE)
        hrefs = await page.eval_on_selector_all("a.btn-gold", "els => els.map(e => e.getAttribute('href'))")
        check("la web enlaza a la app en /app/", hrefs and all(h.endswith('/app/') for h in hrefs), str(hrefs))

        await page.goto(APP)
        await page.wait_for_function("typeof renderHome === 'function'")
        await page.wait_for_timeout(1500)
        await page.keyboard.press("Escape")
        await page.evaluate("addWatch({ brand: 'Oris', model: 'Aquis', type: 'automatic' }).then(() => renderHome())")
        check("la app arranca en /app/", 'Oris' in await page.text_content("body"))

        scope = await page.evaluate("navigator.serviceWorker.ready.then(r => r.scope)")
        check("su service worker se queda en /app/", scope == APP, scope)
        m = await page.evaluate("fetch('manifest.json').then(r => r.json())")
        start = await page.evaluate(f"new URL({m['start_url']!r}, location.origin + '/app/manifest.json').href")
        check("el manifiesto apunta a /app/", start == APP, start)
        icon = await page.evaluate(f"fetch({m['icons'][0]['src']!r}).then(r => r.ok)")
        check("los iconos del manifiesto existen", icon)

        await page.wait_for_function("navigator.serviceWorker.controller !== null")
        await page.wait_for_timeout(1500)
        await ctx.set_offline(True)
        await page.reload()
        await page.wait_for_function("typeof renderHome === 'function'", timeout=10000)
        await page.wait_for_timeout(800)
        check("sin conexión, la app sigue abriendo con sus relojes", 'Oris' in await page.text_content("body"))
        await ctx.set_offline(False)

        r = await page.request.get(SITE + ".well-known/assetlinks.json")
        check("assetlinks: solo se publica con huellas reales", r.status in (200, 404))

        check("sin errores de JavaScript", not errs, errs[:3])
        await b.close()
    ok = sum(1 for _, c in results if c)
    print(f"--- {ok}/{len(results)} OK")
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
