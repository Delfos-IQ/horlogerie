"""
Rotor Pro: compra única con Google Play (simulada), verificación en el Worker y funciones Pro.

Fuera de la app de Play no hay forma de pagar: se muestran los candados y una explicación.
Dentro (simulamos la Digital Goods API y PaymentRequest de Chrome), la compra pasa por el
Worker, que pregunta a Google (simulado en worker-harness.mjs) y la confirma (acknowledge).

Uso (con la app en :8080 y el Worker de pruebas):
  node tests/worker-harness.mjs ../worker/index.js 8771 &
  python3 tests/e2e_pro.py 8771
"""
import asyncio, json, os, sys, urllib.request
from playwright.async_api import async_playwright

PORT   = int(sys.argv[1]) if len(sys.argv) > 1 else 8771
APP    = "http://localhost:8080/horlogerie/"
WORKER = "https://horlogerie.pedicode-app.workers.dev"
CHROME = os.environ.get("CHROME")
SHOTS  = os.environ.get("SHOTS")
DAY    = 86400000
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('  ✓ ' if cond else '  ✗ ') + name + (f'  [{detail}]' if detail and not cond else ''))

def harness():
    return json.loads(urllib.request.urlopen(f"http://localhost:{PORT}/__kv").read())

# Chrome inside a Play TWA: Digital Goods API + Play payment method
PLAY = """
window.__purchases = JSON.parse(localStorage.getItem('__test_purchases') || '[]');
window.getDigitalGoodsService = async method => {
  if (method !== 'https://play.google.com/billing') throw new Error('unsupported');
  return {
    getDetails: async ids => ids.map(id => ({ itemId: id, title: 'Rotor Pro', price: { currency: 'EUR', value: '9.99' } })),
    listPurchases: async () => window.__purchases,
  };
};
window.PaymentRequest = class {
  constructor(methods) { this.methods = methods; }
  async show() {
    if (window.__cancel) { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; }
    const token = window.__nextToken || 'valid-' + 'a'.repeat(30);
    window.__purchases = [{ itemId: this.methods[0].data.sku, purchaseToken: token }];
    return { details: { purchaseToken: token }, complete: async r => { window.__completed = r; } };
  }
};
"""

async def device(browser, play=False, storage=None):
    ctx = await browser.new_context(locale="es-ES", viewport={"width": 412, "height": 900}, service_workers='block',
                                    bypass_csp=True, accept_downloads=True)
    async def route(r):
        resp = await r.fetch(url=r.request.url.replace(WORKER, f"http://localhost:{PORT}"))
        await r.fulfill(response=resp)
    await ctx.route(f"{WORKER}/**", route)
    if storage:
        await ctx.add_init_script("(s => { if (!sessionStorage.__seeded) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); sessionStorage.__seeded = 1; } })(%s)" % json.dumps(storage))
    if play:
        await ctx.add_init_script(PLAY)
    page = await ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    await page.goto(APP)
    await page.wait_for_function("typeof renderHome === 'function'")
    await page.wait_for_timeout(2200)
    return ctx, page, errs

async def main():
    print("\n=== Rotor Pro ===")
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch())

        # ── 1. Normal browser: no Play, everything Pro is locked ──
        ctx, page, errs = await device(b)
        A = await page.evaluate("""async () => { const a = await addWatch({ brand: 'Seiko', model: 'Alpinist', type: 'automatic' });
            await updateWatch(a.id, { purchasePrice: 450 }); return a.id; }""")
        await page.evaluate("id => openDetail(id, 'maint')", A)
        await page.wait_for_timeout(150)
        care = await page.text_content("#d-care")
        check("sin Pro: mantenimiento y precisión con candado", 'Historial de mantenimiento' in care and 'PRO' in care and not await page.locator("#care-add-service").count())
        await page.click("#d-care [data-pro-open] >> nth=0")
        await page.wait_for_timeout(300)
        sheet = await page.text_content(".pro-sheet")
        check("el candado abre Rotor Pro con lo que incluye", all(x in sheet for x in ('Historial de mantenimiento', 'Precisión', 'Correas', 'Valor de la colección', 'Inventario para el seguro')))
        check("fuera de Play: no hay botón de pago y se explica dónde comprarlo", 'dentro de la app de Google Play' in sheet and not await page.locator("#pro-buy").count(), sheet[-200:])
        await page.keyboard.press("Escape")
        await page.evaluate("showView('history'); setHistoryMode('value', true)")
        check("sin Pro: Historial → Valor con candado", 'PRO' in await page.text_content("#value-body"))
        await page.evaluate("showView('settings')")
        await page.click("[data-action='openInsurance']")
        await page.wait_for_timeout(300)
        check("sin Pro: el inventario para el seguro pide Pro", await page.locator(".pro-sheet").count() == 1 and await page.locator("#in-go").count() == 0)
        check("sin errores de JavaScript (navegador normal)", not errs, errs[:3])
        await ctx.close()

        # ── 2. Inside Play: buy ──
        ctx, page, errs = await device(b, play=True)
        A = await page.evaluate("""async () => { const c = document.createElement('canvas'); c.width = c.height = 400;
            const g = c.getContext('2d'); g.fillStyle = '#123'; g.fillRect(0, 0, 400, 400); g.fillStyle = '#d4af6a'; g.beginPath(); g.arc(200, 200, 150, 0, 7); g.fill();
            const a = await addWatch({ brand: 'Seiko', model: 'Alpinist', type: 'automatic', photo: c.toDataURL('image/jpeg', .9) });
            await updateWatch(a.id, { purchasePrice: 450, currentValue: 520, serial: 'SN-12345', purchaseDate: Date.now() - 400 * 86400000 });
            const q = await addWatch({ brand: 'Casio', model: 'Duro', type: 'quartz' }); await updateWatch(q.id, { purchasePrice: 60 });
            addWearDays(a.id, Date.now() - 9 * 86400000, Date.now() - 1 * 86400000); return a.id; }""")
        await page.evaluate("showView('settings')")
        await page.wait_for_timeout(300)
        await page.click("#pro-card [data-pro-open]")
        await page.wait_for_selector("#pro-buy")
        btn = await page.text_content("#pro-buy")
        check("en Play: botón con el precio de Play (9,99 €)", '9,99' in btn and '€' in btn, btn)
        await page.click("#pro-buy")
        await page.wait_for_function("rotor.billing.isPro()", timeout=8000)
        check("compra verificada por el Worker: Pro activado", await page.evaluate("rotor.billing.isPro()"))
        check("se cierra el pago de Play como correcto", await page.evaluate("window.__completed") == 'success')
        h = harness()
        check("el Worker confirma la compra en Google (acknowledge)", any(t.startswith('valid-') for t in h['google']['acks']), str(h['google']))
        check("el servidor no guarda el token de compra", not any('valid-' in k or 'valid-' in str(v) for k, v in h['data'].items()))
        check("la tarjeta de Ajustes dice que Pro está activado", 'Activado' in await page.text_content("#pro-card"))
        await page.keyboard.press("Escape")

        # Maintenance log through the UI
        await page.evaluate("id => openDetail(id, 'maint')", A)
        await page.wait_for_timeout(150)
        await page.click("#care-add-service")
        await page.wait_for_selector("#sv-cost")
        await page.wait_for_timeout(150)   # let the sheet finish opening (it moves the focus on the next frame)
        n_sheets = await page.locator("#sv-cost").count()
        await page.fill("#sv-cost", "180")
        await page.fill("#sv-note", "Limpieza y aceites")
        await page.click("#sv-save")
        for _ in range(30):   # the sheet saves asynchronously: wait for it instead of a fixed pause
            w = await page.evaluate("id => getWatch(id)", A)
            if w.get('serviceLog'): break
            await page.wait_for_timeout(100)
        log = w.get('serviceLog', [])
        check("apuntar una revisión desde la ficha (con coste y nota)", len(log) == 1 and log[0].get('cost') == 180, f"{log} hojas={n_sheets}")
        check("la revisión actualiza la fecha de «última revisión»", w.get('lastService') == w['serviceLog'][0]['date'])
        care = await page.text_content("#d-care")
        check("el historial muestra el total en mantenimiento", 'Total en mantenimiento' in care and '180' in care, care[:200])

        # Accuracy
        await page.evaluate(f"""id => {{ const t = Date.now() - 4 * {DAY}; addAccuracyReading(id, {{ ts: t, offset: 0 }});
            addAccuracyReading(id, {{ ts: t + 4 * {DAY}, offset: 20 }}); openDetail(id); }}""", A)
        await page.wait_for_timeout(150)
        care = await page.text_content("#d-care")
        check("precisión en segundos al día (+5,0 s/día)", '+5,0 s/día' in care, care[care.find('Precisión'):][:160])
        await page.click("#care-add-acc")
        await page.select_option("#ac-sign", "-1")
        await page.fill("#ac-sec", "3")
        await page.check("#ac-set")
        await page.click("#ac-save")
        await page.wait_for_timeout(150)
        last = await page.evaluate("id => getWatch(id).accuracy.at(-1)", A)
        check("apuntar «atrasa 3 s y lo puse en hora» desde la ficha", last['offset'] == -3 and last.get('setAfter') is True, str(last))

        # Straps
        await page.click("#dtab-specs")
        await page.click("#care-add-strap")
        check("sin ancho en la ficha, el ancho de la correa queda vacío", await page.input_value("#sp-width") == '')
        await page.fill("#sp-name", "NATO gris")
        await page.click("#sp-save")
        await page.wait_for_timeout(150)
        straps = await page.text_content("#d-straps")
        check("añadir una correa: queda puesta", 'NATO gris' in straps and 'Puesta' in straps, straps)
        if SHOTS: await page.screenshot(path=f"{SHOTS}/pro-straps.png")

        # Value
        await page.evaluate("showView('history'); setHistoryMode('value', true)")
        await page.wait_for_timeout(150)
        val = (await page.text_content("#value-body")).replace('\xa0', ' ')
        check("valor de la colección: valor actual (520 + 60) y lo pagado", '580 €' in val and 'Pagaste 510 €' in val, val[:160])
        check("coste por uso incluye el mantenimiento", 'En mantenimiento' in val and '180 €' in val)
        if SHOTS: await page.screenshot(path=f"{SHOTS}/pro-valor.png")

        # Insurance PDF
        await page.evaluate("showView('settings')")
        await page.click("[data-action='openInsurance']")
        await page.fill("#in-holder", "Ana Pérez")
        async with page.expect_download(timeout=20000) as dl:
            await page.click("#in-go")
        d = await dl.value
        path = await d.path()
        size = os.path.getsize(path)
        pdf = open(path, 'rb').read()
        check("inventario PDF para el seguro (con foto)", d.suggested_filename.startswith('rotor-inventario-seguro') and size > 20000, f"{d.suggested_filename} {size}")
        check("el PDF lleva número de serie y titular", b'SN-12345' in pdf and 'Ana P'.encode() in pdf)
        check("el titular no se guarda en el móvil", 'Ana' not in json.dumps(await page.evaluate("Object.fromEntries(Object.entries(localStorage))")))
        check("sin errores de JavaScript (compra y funciones Pro)", not errs, errs[:3])
        pro_state = await page.evaluate("localStorage.getItem('rotor_pro_v1')")
        purchases = await page.evaluate("JSON.stringify(window.__purchases)")
        await ctx.close()

        # ── 3. Reinstall / other phone: restored from the Play account ──
        ctx, page, errs = await device(b, play=True, storage={'__test_purchases': purchases})
        await page.wait_for_function("rotor.billing.isPro()", timeout=8000)
        check("reinstalar: Pro se restaura solo desde la cuenta de Google", await page.evaluate("rotor.billing.isPro()"))
        await ctx.close()

        # ── 4. Refund: Pro switches off at the next check ──
        refunded = json.dumps({'active': True, 'token': 'refunded-' + 'b' * 30, 'verifiedAt': 0})
        ctx, page, errs = await device(b, play=True, storage={'rotor_pro_v1': refunded})
        await page.wait_for_function("!rotor.billing.isPro()", timeout=8000)
        check("reembolso: Pro se desactiva en la siguiente comprobación", not await page.evaluate("rotor.billing.isPro()"))
        await ctx.close()

        # ── 5. Offline never switches Pro off ──
        ctx, page, errs = await device(b, play=True, storage={'rotor_pro_v1': json.dumps({'active': True, 'token': 'valid-' + 'c' * 30, 'verifiedAt': 0})})
        await ctx.route(f"{WORKER}/**", lambda r: r.abort())
        r = await page.evaluate("rotor.billing.recheckPro().then(() => rotor.billing.isPro())")
        check("sin conexión, Pro sigue activo", r is True)
        await ctx.close()

        # ── 6. Pending payment and cancelled sheet ──
        ctx, page, errs = await device(b, play=True)
        await page.evaluate("window.__nextToken = 'pending-' + 'd'.repeat(30)")
        r = await page.evaluate("rotor.billing.buyPro()")
        check("pago pendiente: no se activa todavía", r == 'pending' and not await page.evaluate("rotor.billing.isPro()"))
        await page.evaluate("window.__cancel = true")
        r = await page.evaluate("rotor.billing.buyPro()")
        check("cerrar la hoja de Play no es un error", r == 'cancelled')
        await ctx.close()

        # ── 7. Worker refuses forged requests ──
        def post(body, origin=True):
            req = urllib.request.Request(f"http://localhost:{PORT}/v2/pro/verify", data=json.dumps(body).encode(), method='POST',
                                         headers={'Content-Type': 'application/json', **({} if origin else {'X-Test-Origin': 'none'})})
            try: return json.loads(urllib.request.urlopen(req).read())
            except urllib.error.HTTPError as e: return {'status': e.code, **json.loads(e.read() or b'{}')}
        check("token inventado: no vale", post({'sku': 'rotor_pro', 'token': 'forged-' + 'e' * 30}).get('invalid') is True)
        check("otro producto: rechazado", post({'sku': 'gold_pack', 'token': 'valid-' + 'e' * 30}).get('status') == 400)
        check("sin el origen de la app: rechazado", post({'sku': 'rotor_pro', 'token': 'valid-' + 'e' * 30}, origin=False).get('status') == 403)

        await b.close()
    ok = sum(1 for _, c in results if c)
    print(f"--- {ok}/{len(results)} OK")
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
