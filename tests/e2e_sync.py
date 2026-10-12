"""
End-to-end sync tests: two (or three) Chromium contexts = two devices,
talking to the real Worker code running in Node (harness.mjs) with in-memory KV.

Requisitos: pip install playwright && playwright install chromium

Uso (desde la raíz del repositorio):
  1. Servir la app bajo /horlogerie/:
       mkdir -p /tmp/srv && ln -sfn "$PWD" /tmp/srv/horlogerie
       python3 -m http.server 8080 -d /tmp/srv &
  2. Arrancar el Worker con KV en memoria:
       node tests/worker-harness.mjs ../worker/index.js 8711 &
  3. python3 tests/e2e_sync.py 8711 v11

Variables: CHROME=/ruta/a/chrome si no quieres el Chromium de Playwright.
"""
import asyncio, json, os, sys, urllib.request
from playwright.async_api import async_playwright

PORT  = sys.argv[1]
LABEL = sys.argv[2]
V11   = LABEL == 'v11'
APP   = "http://localhost:8080/horlogerie/"
CHROME = os.environ.get("CHROME")  # None → Chromium de Playwright
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('  ✓ ' if cond else '  ✗ ') + name + (f'  [{detail}]' if detail and not cond else ''))

def kv():
    return json.loads(urllib.request.urlopen(f"http://localhost:{PORT}/__kv").read())

async def device(browser, name):
    ctx = await browser.new_context(locale="es-ES", viewport={"width": 412, "height": 900}, service_workers='block')
    async def route(r):
        url = r.request.url.replace("https://horlogerie.pedicode-app.workers.dev", f"http://localhost:{PORT}")
        resp = await r.fetch(url=url)
        await r.fulfill(response=resp)
    await ctx.route("https://horlogerie.pedicode-app.workers.dev/**", route)
    ext = []
    await ctx.route("https://api.qrserver.com/**", lambda r: (ext.append(r.request.url), r.abort()))
    page = await ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    await page.goto(APP)
    await page.wait_for_function("typeof syncAuto === 'function' && typeof getWatches === 'function'")
    await page.wait_for_timeout(2500)
    return ctx, page, errs, ext

PHOTO_JS = """() => { const c=document.createElement('canvas'); c.width=c.height=64;
  const g=c.getContext('2d'); g.fillStyle='#2a4c8f'; g.fillRect(0,0,64,64); g.fillStyle='#d4af6a'; g.fillRect(16,16,32,32);
  return c.toDataURL('image/jpeg', 0.9); }"""

async def add(page, brand, model, photo=False):
    p = await page.evaluate(PHOTO_JS) if photo else None
    return await page.evaluate("""async ([b,m,p]) => (await addWatch({brand:b, model:m, photo:p})).id""", [brand, model, p])

async def names(page):
    return sorted(await page.evaluate("getWatches().map(w => w.brand + ' ' + w.model)"))

async def main():
    print(f"\n=== Worker {LABEL} (port {PORT}) ===")
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME) if CHROME else await p.chromium.launch()

        # ── 1. Fresh install: cloud off, no sync traffic ──
        A, pa, ea, xa = await device(b, 'A')
        before = len(kv()['log'])
        check("instalación nueva: nube desactivada", not await pa.evaluate("isCloudEnabled()"))
        await add(pa, 'Steeldive', 'SD1975S', photo=True)
        await pa.wait_for_timeout(3600)
        sync_calls = [l for l in kv()['log'][before:] if l['url'].startswith('/sync')]
        check("con la nube apagada no se envía nada", not sync_calls, str(sync_calls))

        # ── 2. Turn cloud on: everything goes up ──
        await pa.evaluate("setCloudEnabled(true)")
        await pa.wait_for_timeout(500)
        uid_a = await pa.evaluate("getSessionId()")
        data = kv()['data'].get(f"user:{uid_a.lower()}:watches")
        check("al activar la nube se sube la colección", data and len(json.loads(data)['watches']) == 1)
        check("la foto viaja a la nube", data and json.loads(data)['watches'][0].get('photo', '').startswith('data:image/'))
        log = kv()['log']
        leaked = [l['url'] for l in log if 'userId=' in l['url']]
        if V11:
            check("v11: el ID nunca va en la URL", not leaked, str(leaked[:2]))
            check("v11: el ID va en la cabecera", any(l['userHeader'] == uid_a for l in log))
        else:
            check("v10: compatibilidad (ID por query)", any(uid_a in l['url'] for l in log))

        # wishlist
        await pa.evaluate("saveWishlist([...getWishlist(), {id:'wl_1', brand:'Seagull', model:'1963', type:'manual', priority:'high', precio:'', notas:'', specs:{}, created: Date.now()}])")
        await pa.evaluate("syncPush()")
        await pa.wait_for_timeout(300)

        # ── 3. Device B imports A's session ──
        B, pb, eb, xb = await device(b, 'B')
        await add(pb, 'Berny', 'Field', photo=False)       # B already had something
        ok = await pb.evaluate("async id => await importSession(id)", uid_a)
        await pb.wait_for_timeout(500)
        check("B importa la sesión", ok)
        nb = await names(pb)
        check("B combina: conserva su reloj y recibe el de A", nb == ['Berny Field', 'Steeldive SD1975S'], str(nb))
        has_photo = await pb.evaluate("getPhotoDataUrl(getWatches().find(w=>w.brand==='Steeldive')?.id).then(p => !!p?.startsWith('data:image/'))")
        check("B recibe la foto", has_photo)
        if V11:
            check("v11: la lista de deseos llega a B", await pb.evaluate("getWishlist().some(i=>i.id==='wl_1')"))

        # ── 4. A pulls: gets Berny from B ──
        await pa.evaluate("syncPull(true)")
        na = await names(pa)
        check("A recibe el reloj que añadió B", na == ['Berny Field', 'Steeldive SD1975S'], str(na))

        # ── 5. Deletion on B + new unsynced watch on A ──
        await pb.evaluate("deleteWatch(getWatches().find(w=>w.brand==='Berny').id)")
        await pb.evaluate("syncPush()")
        await pa.evaluate("setOnChange(() => {})")        # A is "offline"
        await add(pa, 'Pagani', 'GMT')
        await pa.evaluate("syncPull(true)")
        na = await names(pa)
        check("A: el borrado de B se aplica y el reloj nuevo de A no se pierde",
              na == ['Pagani GMT', 'Steeldive SD1975S'], str(na))
        await pb.evaluate("syncPull(true)")
        nb = await names(pb)
        check("B recibe el reloj nuevo de A y no resucita el borrado", nb == ['Pagani GMT', 'Steeldive SD1975S'], str(nb))

        # ── 6. Conflict: same watch edited on both, most recent wins ──
        await pa.evaluate("updateWatch(getWatches().find(w=>w.brand==='Pagani').id, {notes:'nota A'})")
        await pa.wait_for_timeout(20)
        await pb.evaluate("updateWatch(getWatches().find(w=>w.brand==='Pagani').id, {notes:'nota B (más reciente)'})")
        await pa.evaluate("syncPush()")
        await pb.evaluate("syncPull(true)")
        await pa.evaluate("syncPull(true)")
        na_note = await pa.evaluate("getWatches().find(w=>w.brand==='Pagani').notes")
        nb_note = await pb.evaluate("getWatches().find(w=>w.brand==='Pagani').notes")
        check("conflicto: gana la edición más reciente en ambos", na_note == nb_note == 'nota B (más reciente)', f"{na_note} / {nb_note}")

        # ── 7. Backup round trip with photos + wishlist on a third device ──
        backup = await pa.evaluate("buildBackup()")
        check("la copia incluye la lista de deseos", backup.get('version') == 3 and 'wishlist' in backup)
        C, pc, ec, xc = await device(b, 'C')
        await pc.evaluate("async d => await importBackup(d)", backup)
        await pc.reload(); await pc.wait_for_timeout(1500)
        photo_c = await pc.evaluate("getPhotoDataUrl(getWatches().find(w=>w.brand==='Steeldive')?.id).then(p => p || '')")
        check("restaurar copia: las fotos siguen tras recargar", photo_c.startswith('data:image/'))
        check("restaurar copia: relojes correctos", sorted(await names(pc)) == ['Pagani GMT', 'Steeldive SD1975S'])
        # malicious entries are rejected / neutralised
        evil = {"watches": [{"id": "x\"onerror=alert(1)", "brand": "<img src=x onerror=alert(1)>", "model": "M",
                             "photo": "javascript:alert(1)"}, {"brand": ""}]}
        r = await pc.evaluate("async d => await importBackup(d)", evil)
        bad = await pc.evaluate("getWatchesWithPhotos().then(ws => ws.filter(w => w.photo && !w.photo.startsWith('data:image/')).length)")
        ids_ok = await pc.evaluate("getWatches().every(w => /^[A-Za-z0-9_-]+$/.test(w.id))")
        check("importación: rechaza entradas inválidas y limpia ids/fotos", r['rejected'] == 1 and bad == 0 and ids_ok, json.dumps(r))
        await pc.evaluate("showView('home')")
        check("importación: el HTML del nombre no se ejecuta", await pc.locator(".watch-card img[src='x']").count() == 0)

        # ── 8. Migration: install that synced before v2.2 keeps the cloud on ──
        D, pd, ed, xd = await device(b, 'D')
        await pd.evaluate("localStorage.setItem('horlogerie_session_v1', JSON.stringify({userId: crypto.randomUUID(), lastPush: 1700000000000, watchHashes: {}}))")
        check("migración: quien ya sincronizaba sigue con la nube activada", await pd.evaluate("isCloudEnabled()"))

        # ── 9. Rotate key ──
        old = await pa.evaluate("getSessionId()")
        new = await pa.evaluate("rotateSessionKey()")
        await pa.wait_for_timeout(300)
        keys = kv()['keys']
        check("cambiar llave: la copia vieja desaparece y la nueva existe",
              f"user:{old.lower()}:watches" not in keys and f"user:{new.lower()}:watches" in keys, str(keys))

        # ── 10. Delete cloud ──
        await pa.evaluate("deleteCloudData()")
        keys = kv()['keys']
        check("borrar de la nube: no queda nada y la nube se apaga",
              f"user:{new.lower()}:watches" not in keys and not await pa.evaluate("isCloudEnabled()"))
        check("borrar de la nube: los datos locales siguen", len(await names(pa)) == 2)

        # ── 11. QR generated locally ──
        await pb.evaluate("showView('settings')")
        await pb.evaluate("openPairSheet()")
        await pb.wait_for_selector(".pair-qr svg", timeout=5000)
        svg = await pb.locator(".pair-qr svg").count()
        check("QR generado en el dispositivo (sin servicios externos)", svg == 1 and not (xa + xb + xc + xd))

        # ── 12. No JS errors ──
        all_errs = ea + eb + ec + ed
        check("sin errores de JavaScript", not all_errs, '; '.join(all_errs[:3]))
        await b.close()

    failed = [r for r in results if not r[1]]
    print(f"--- {LABEL}: {len(results) - len(failed)}/{len(results)} OK")
    sys.exit(1 if failed else 0)

asyncio.run(main())
