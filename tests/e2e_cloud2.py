"""
Nube 2.0 (Worker v14 con D1): cifrado de extremo a extremo, un registro por
elemento, sin techo de 3 MB, migración desde la nube v1, vinculación sin que el
servidor vea la clave, conflictos y manipulación de datos en el servidor.

Uso (con la app en :8080 y el harness CON base de datos en el puerto indicado):
  python3 tests/e2e_cloud2.py 8711
"""
import asyncio, json, os, re, sys, urllib.request, urllib.error
from playwright.async_api import async_playwright

PORT   = sys.argv[1] if len(sys.argv) > 1 else "8711"
APP    = "http://localhost:8080/horlogerie/"
WORKER = "https://horlogerie.pedicode-app.workers.dev"
CHROME = os.environ.get("CHROME")
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('  ✓ ' if cond else '  ✗ ') + name + (f'  [{detail}]' if detail and not cond else ''))

def kv():
    return json.loads(urllib.request.urlopen(f"http://localhost:{PORT}/__kv").read())

def sql(q, *args):
    req = urllib.request.Request(f"http://localhost:{PORT}/__sql", data=json.dumps({'sql': q, 'args': list(args)}).encode(), method='POST')
    return json.loads(urllib.request.urlopen(req).read())

PHOTO_JS = """(seed) => { const c=document.createElement('canvas'); c.width=c.height=600;
  const g=c.getContext('2d');
  for (let i = 0; i < 900; i++) { g.fillStyle = `hsl(${(i * 37 + seed * 11) % 360},70%,${30 + (i % 40)}%)`;
    g.fillRect((i * 53) % 600, (i * 97 + seed) % 600, 40, 40); }
  return c.toDataURL('image/jpeg', 0.92); }"""

async def device(browser, url=APP):
    ctx = await browser.new_context(locale="es-ES", viewport={"width": 412, "height": 900}, service_workers='block', bypass_csp=True)
    async def route(r):
        u = r.request.url.replace(WORKER, f"http://localhost:{PORT}")
        resp = await r.fetch(url=u)
        await r.fulfill(response=resp)
    await ctx.route(f"{WORKER}/**", route)
    page = await ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    await page.goto(url)
    await page.wait_for_function("typeof syncPush === 'function'")
    await page.wait_for_timeout(2200)
    return ctx, page, errs

async def add(page, brand, model, seed=None):
    p = await page.evaluate(PHOTO_JS, seed) if seed is not None else None
    return await page.evaluate("""async ([b,m,p]) => (await addWatch({brand:b, model:m, photo:p})).id""", [brand, model, p])

async def names(page):
    return sorted(await page.evaluate("getWatches().map(w => w.brand + ' ' + w.model)"))

async def main():
    print("\n=== Nube 2.0 (cifrada, por elemento) ===")
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch())

        # ── 1. Activar la nube: todo sube cifrado ──
        ca, a, ea = await device(b)
        check("el servidor ofrece la nube 2.0", (await a.evaluate("workerCaps()"))['v2'])
        wa = await add(a, 'Steeldive', 'SD1975S Tuna', seed=1)
        await add(a, 'Seagull', '1963 Chronograph')
        await a.evaluate("addWishlistItem({brand:'Grand Seiko', model:'SBGA211 Snowflake', precio:'5800'})")
        await a.evaluate("handleCloudToggle(true)")
        await a.wait_for_selector("#sk-done", timeout=15000); await a.click("#sk-done")
        key = await a.evaluate("getSessionId()")
        d1 = kv()['d1']
        check("se crea una cuenta y un registro por elemento (2 relojes + 1 deseo)",
              len(d1['users']) == 1 and len([i for i in d1['items'] if not i['deleted']]) == 3, json.dumps(d1['users']))
        blob = json.dumps(d1['items'])
        check("en el servidor no hay nada legible (ni marcas, ni modelos, ni la clave)",
              not any(x in blob for x in ['Steeldive', 'Seagull', 'Snowflake', 'SBGA211', key, key.replace('-', '')]))
        uid = d1['users'][0]['uid']
        check("el nombre de la cuenta no es la clave", uid != key.lower() and key.replace('-', '').lower() not in uid)
        check("la foto se guarda aparte y cifrada", any(i['photoLen'] for i in d1['items'] if i['id'] == wa))
        check("y no queda copia en claro en KV", not any(k.startswith('user:') for k in kv()['keys']))
        st = await a.evaluate("showView('settings'); new Promise(r => setTimeout(r, 600)).then(() => document.getElementById('status-sync-sub').textContent)")
        check("Ajustes dice que la copia está cifrada de extremo a extremo", 'cifrada de extremo a extremo' in st, st)

        # ── 2. Otro dispositivo recupera con la clave ──
        cb, bb, eb = await device(b)
        await bb.evaluate("openLinkSheet()")
        await bb.fill("#link-input", key)
        await bb.click("#link-go")
        await bb.wait_for_function("getWatches().length === 2", timeout=15000)
        has_photo = await bb.evaluate(f"getPhotoDataUrl('{wa}').then(p => !!p?.startsWith('data:image/'))")
        check("con la clave, otro móvil recibe relojes, foto y lista de deseos",
              has_photo and await bb.evaluate("getWishlist().length") == 1)

        # ── 3. Cambios y borrados viajan por elemento ──
        await a.evaluate(f"updateWatch('{wa}', {{ model: 'SD1975S Tuna (zafiro)' }})")
        await a.evaluate("syncPush()")
        await bb.evaluate("syncPull(true)")
        check("un cambio en A llega a B", 'Steeldive SD1975S Tuna (zafiro)' in await names(bb))
        sid = await bb.evaluate("getWatches().find(w => w.brand === 'Seagull').id")
        await bb.evaluate(f"deleteWatch('{sid}')")
        await bb.evaluate("syncPush()")
        await a.evaluate("syncPull(true)")
        check("un borrado en B desaparece en A", await names(a) == ['Steeldive SD1975S Tuna (zafiro)'], str(await names(a)))

        # ── 4. Conflicto: gana el cambio más reciente ──
        await a.evaluate(f"updateWatch('{wa}', {{ notes: 'nota de A' }})")
        await bb.wait_for_timeout(30)
        await bb.evaluate(f"updateWatch('{wa}', {{ notes: 'nota de B (posterior)' }})")
        await a.evaluate("syncPush()"); await bb.evaluate("syncPush()")
        await a.evaluate("syncPull(true)"); await bb.evaluate("syncPull(true)")
        na = await a.evaluate(f"getWatch('{wa}').notes"); nb = await bb.evaluate(f"getWatch('{wa}').notes")
        check("dos cambios casi a la vez: los dos móviles acaban con el más reciente", na == nb == 'nota de B (posterior)', f"{na} / {nb}")

        # ── 5. Sin techo de 3 MB ──
        cc, c, ec = await device(b)
        await c.evaluate(PHOTO_JS.replace("(seed) =>", "window.mkPhoto = (seed) =>"))
        await c.evaluate("""async () => { for (let i = 0; i < 100; i++)
          await addWatch({ brand: 'Marca' + i, model: 'Modelo ' + i, photo: mkPhoto(i) }); }""")
        total = await c.evaluate("getWatchesWithPhotos().then(ws => ws.reduce((t, w) => t + (w.photo || '').length, 0))")
        await c.evaluate("handleCloudToggle(true)")
        await c.wait_for_selector("#sk-done", timeout=60000); await c.click("#sk-done")
        kc = await c.evaluate("getSessionId()")
        uid_c = [u['uid'] for u in kv()['d1']['users'] if u['uid'] != uid][0]
        n_c = sql("SELECT COUNT(*) AS n FROM items WHERE uid = ? AND deleted = 0", uid_c)[0]['n']
        check(f"100 relojes con foto ({total / 1048576:.1f} MB) se guardan enteros", total > 3 * 1048576 and n_c == 100, f"{total} {n_c}")
        cd, dd, ed = await device(b)
        await dd.evaluate("openLinkSheet()"); await dd.fill("#link-input", kc); await dd.click("#link-go")
        await dd.wait_for_function("getWatches().length === 100", timeout=60000)
        photos = await dd.evaluate("getWatchesWithPhotos().then(ws => ws.filter(w => w.photo).length)")
        check("y otro móvil los descarga todos, con foto (por páginas)", photos == 100, str(photos))

        # ── 6. Vincular: el código y la clave no llegan al servidor ──
        await a.evaluate("showView('settings')")
        await a.click("#btn-link-device")
        await a.wait_for_selector("#pair-code", timeout=20000)
        code = (await a.inner_text("#pair-code")).replace('-', '')
        pairs = {k: v for k, v in kv()['data'].items() if k.startswith('pair2:')}
        check("el registro de vinculación no contiene ni la clave ni el código",
              len(pairs) == 1 and not any(key in v or code in v or code in k for k, v in pairs.items()), str(pairs)[:120])
        await a.click("[data-close]")
        ce, e, ee = await device(b)
        await e.evaluate("openLinkSheet()"); await e.fill("#link-input", code); await e.click("#link-go")
        await e.wait_for_function("getWatches().length === 1", timeout=20000)
        check("con el código, el otro móvil queda con la misma clave",
              await e.evaluate("getSessionId()") == key and not any(k.startswith('pair2:') for k in kv()['keys']))

        # ── 7. Manipulación en el servidor: se ignora sin romper nada ──
        rows = sql("SELECT id, data FROM items WHERE uid = ? AND kind = 'w' AND deleted = 0", uid)
        other = sql("SELECT data FROM items WHERE uid = ? AND kind = 'l'", uid)[0]['data']
        sql("UPDATE items SET data = ?, rev = rev + 1000000000 WHERE uid = ? AND id = ?", other, uid, rows[0]['id'])
        before = await e.evaluate(f"getWatch('{rows[0]['id']}').model")
        await e.evaluate("syncPull(true)")
        after = await e.evaluate(f"getWatch('{rows[0]['id']}').model")
        check("un registro cambiado de sitio en el servidor no se descifra y no se aplica", before == after and not ee, f"{before} → {after}")

        # ── 8. Sin la clave correcta no se puede escribir ni borrar ──
        req = urllib.request.Request(f"http://localhost:{PORT}/v2/account", method='DELETE',
                                     headers={'X-Rotor-Id': uid, 'X-Rotor-Auth': 'f' * 64})
        try: code_out = urllib.request.urlopen(req).status
        except urllib.error.HTTPError as err: code_out = err.code
        check("borrar la cuenta con un token falso: 403", code_out == 403, str(code_out))

        # ── 9. Migración desde la nube v1 ──
        legacy = "0f0e0d0c-1111-4222-8333-444455556666"
        body = json.dumps({'userId': legacy, 'watches': [{'id': 'w_legacy_1', 'brand': 'Orient', 'model': 'Bambino', 'type': 'automatic',
                           'specs': {}, 'history': [], 'created': 1, 'updatedAt': 1}], 'mode': 'full', 'deletedIds': [], 'wishlist': []}).encode()
        urllib.request.urlopen(urllib.request.Request(f"http://localhost:{PORT}/sync/push", data=body, method='POST',
                               headers={'Content-Type': 'application/json', 'X-Horlogerie-User': legacy}))
        check("(preparación) existe una copia v1 en claro", f"user:{legacy}:watches" in kv()['keys'])
        cf, f, ef = await device(b)
        await f.evaluate(f"""localStorage.setItem('horlogerie_session_v1', JSON.stringify({{userId: '{legacy}', cloudEnabled: true, lastPush: 1700000000000}}))""")
        await f.reload(); await f.wait_for_function("typeof syncPush === 'function'"); await f.wait_for_timeout(4000)
        check("al abrir la app nueva, la copia v1 se trae, se sube cifrada y se borra la copia en claro",
              'Orient Bambino' in await names(f) and f"user:{legacy}:watches" not in kv()['keys']
              and await f.evaluate("getSyncMeta().protocol") == 2, str(await names(f)))
        try:
            urllib.request.urlopen(urllib.request.Request(f"http://localhost:{PORT}/sync/push", data=body, method='POST',
                                   headers={'Content-Type': 'application/json', 'X-Horlogerie-User': legacy}))
            status = 200
        except urllib.error.HTTPError as err: status = err.code
        check("una app antigua ya no puede volver a crear la copia en claro (409)", status == 409, str(status))

        # ── 10. Cambiar llave y borrar ──
        old_uid = uid
        await a.evaluate("rotateSessionKey()")
        users = [u['uid'] for u in kv()['d1']['users']]
        check("cambiar la llave: cuenta nueva con los datos y la vieja borrada", old_uid not in users
              and await a.evaluate("isShortKey(getSessionId())"), str(users))
        new_uid = [u for u in users if u not in (uid_c,)]
        await a.evaluate("deleteCloudData()")
        left = sql("SELECT COUNT(*) AS n FROM items i JOIN users u ON u.uid = i.uid")
        check("borrar de la nube elimina la cuenta entera", len(kv()['d1']['users']) == len(users) - 1
              and not await a.evaluate("isCloudEnabled()") and len(await names(a)) == 1, f"{left} {new_uid}")

        errs = ea + eb + ec + ed + ee + ef
        check("sin errores de JavaScript", not errs, '; '.join(errs[:3]))
        await b.close()

    failed = [r for r in results if not r[1]]
    print(f"--- {len(results) - len(failed)}/{len(results)} OK")
    sys.exit(1 if failed else 0)

asyncio.run(main())
