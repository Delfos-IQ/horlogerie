"""
Pruebas del registro de uso, la recomendación, el PDF y el funcionamiento sin terceros.

Requisitos: pip install playwright && playwright install chromium
Uso (desde la raíz del repositorio, con la app servida en :8080 como indica e2e_sync.py):
  python3 tests/e2e_wear.py
"""
import asyncio, os, sys
from playwright.async_api import async_playwright

APP    = "http://localhost:8080/horlogerie/"
CHROME = os.environ.get("CHROME")
SHOTS  = os.environ.get("SHOTS")          # carpeta para guardar capturas (opcional)
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('  ✓ ' if cond else '  ✗ ') + name + (f'  [{detail}]' if detail and not cond else ''))

DAY = 86400000

async def main():
    print("\n=== Registro de uso, recomendación, PDF y autonomía ===")
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch())
        ctx = await b.new_context(locale="es-ES", viewport={"width": 412, "height": 900}, accept_downloads=True)
        external = []
        async def guard(route):
            url = route.request.url
            if url.startswith("http://localhost:8080/"):
                await route.continue_()
            else:
                external.append(url)
                await route.abort()
        await ctx.route("**/*", guard)
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        csp = []   # this suite runs with the real Content-Security-Policy
        page.on("console", lambda m: csp.append(m.text) if 'Content Security Policy' in m.text else None)
        await page.goto(APP)
        await page.wait_for_function("typeof wearStats === 'function'")
        await page.wait_for_timeout(2200)   # intro splash

        # ── Datos de ejemplo ──
        ids = await page.evaluate("""async () => {
          const c = document.createElement('canvas'); c.width = 800; c.height = 500;
          const g = c.getContext('2d'); g.fillStyle = '#123'; g.fillRect(0,0,800,500);
          g.fillStyle = '#d4af6a'; g.beginPath(); g.arc(400,250,180,0,7); g.fill();
          const photo = c.toDataURL('image/jpeg', .9);
          const a = await addWatch({brand:'Steeldive', model:'SD1975S Tuna', type:'automatic', photo});
          const b = await addWatch({brand:'Seagull', model:'1963', type:'manual'});
          const q = await addWatch({brand:'Casio', model:'Duro', type:'quartz'});
          const n = await addWatch({brand:'Pagani', model:'GMT', type:'automatic'});
          return [a.id, b.id, q.id, n.id];
        }""")
        A, B, Q, N = ids

        # ── Fotos como Blob (v2.16) ──
        await page.evaluate("showView('home')")
        await page.wait_for_timeout(200)
        mem = await page.evaluate("id => 'photo' in getWatch(id)", A)
        src = await page.get_attribute(f".watch-card[data-id='{A}'] img", "src")
        loaded = await page.evaluate(f"() => document.querySelector(\".watch-card[data-id='{A}'] img\").naturalWidth")
        check("la foto no vive en memoria: se muestra desde el Blob (blob:) con la CSP real", not mem and src.startswith('blob:') and loaded > 0, f"{mem} {src[:20]} {loaded}")
        rec = await page.evaluate("""id => new Promise(r => { const q = indexedDB.open('horlogerie_photos');
          q.onsuccess = () => { const g = q.result.transaction('photos').objectStore('photos').get(id); g.onsuccess = () => r({ blob: g.result.blob instanceof Blob, size: g.result.blob?.size, tag: g.result.tag, old: 'photo' in g.result }); }; })""", A)
        durl = await page.evaluate("id => getPhotoDataUrl(id)", A)
        check("se guarda como Blob (un tercio menos que en base64) con su huella", rec['blob'] and not rec['old'] and rec['tag'] and rec['size'] < len(durl) * 0.8, str(rec))
        # A record written by an older version ({ id, photo: 'data:…' }) is converted on start
        await page.evaluate("""([id, durl]) => new Promise(r => { const q = indexedDB.open('horlogerie_photos');
          q.onsuccess = () => { const t = q.result.transaction('photos', 'readwrite'); t.objectStore('photos').put({ id, photo: durl }); t.oncomplete = r; }; })""", [B, durl])
        await page.evaluate("loadPhotos().then(() => renderHome())")
        await page.wait_for_timeout(200)
        migrated = await page.evaluate("""id => new Promise(r => { const q = indexedDB.open('horlogerie_photos');
          q.onsuccess = () => { const g = q.result.transaction('photos').objectStore('photos').get(id); g.onsuccess = () => r(g.result.blob instanceof Blob && !('photo' in g.result)); }; })""", B)
        same = await page.evaluate("([a, b]) => Promise.all([getPhotoDataUrl(a), getPhotoDataUrl(b)]).then(([x, y]) => x === y)", [A, B])
        check("las fotos de versiones anteriores se convierten al arrancar, sin cambiar ni un byte", migrated and same)
        check("la huella coincide con la de la nube (no se vuelve a subir ninguna foto)",
              await page.evaluate("([a, b]) => { const t = photoTags(); return t.get(a) === t.get(b) && t.get(a).length === 16; }", [A, B]))
        await page.evaluate("id => idbDeletePhoto(id).then(() => renderHome())", B)

        # ── Días de calendario ──
        r1 = await page.evaluate("id => markWornToday(id)", A)
        r2 = await page.evaluate("id => markWornToday(id)", A)
        st = await page.evaluate("id => wearStats(getWatch(id))", A)
        check("«Lo llevé hoy» cuenta 1 día y es idempotente", r1 is True and r2 == 'already' and st['daysWorn'] == 1, str(st))

        await page.evaluate(f"id => addWearDays(id, Date.now() - 12*{DAY}, Date.now() - 10*{DAY})", B)
        st = await page.evaluate("id => wearStats(getWatch(id))", B)
        check("un rango de 3 días cuenta 3 días", st['daysWorn'] == 3 and st['daysSinceLast'] == 10, str(st))
        future = await page.evaluate(f"id => addWearDays(id, Date.now() + 3*{DAY})", B)
        check("no se pueden apuntar días futuros", future is False)

        # dos sesiones el mismo día = 1 día
        await page.evaluate(f"id => {{ addWearDays(id, Date.now() - 12*{DAY}); }}", B)
        st = await page.evaluate("id => wearStats(getWatch(id))", B)
        check("dos usos el mismo día cuentan una vez", st['daysWorn'] == 3 and st['sessions'] == 2, str(st))

        # editar y borrar
        await page.evaluate(f"id => updateHistoryEntry(id, 0, Date.now() - 20*{DAY}, Date.now() - 20*{DAY})", B)
        st = await page.evaluate("id => wearStats(getWatch(id))", B)
        check("editar un uso cambia el cómputo", st['daysWorn'] == 2, str(st))
        await page.evaluate("id => deleteHistoryEntry(id, 0)", B)
        st = await page.evaluate("id => wearStats(getWatch(id))", B)
        check("borrar un uso", st['sessions'] == 1 and st['daysWorn'] == 1, str(st))

        # ── Cambiar de reloj en un paso ──
        await page.evaluate("id => startWearing(id)", Q)
        ok = await page.evaluate("id => switchToWatch(id)", N)
        state = await page.evaluate(f"""() => ({{ q: getWatch('{Q}').wearStart, n: !!getWatch('{N}').wearStart,
                                         qh: getWatch('{Q}').history.length }})""")
        check("cambiar a otro reloj cierra la sesión del anterior", ok and state['q'] is None and state['n'] and state['qh'] == 1, str(state))
        await page.evaluate("id => stopWearing(id)", N)

        # ── Recomendación ──
        order = await page.evaluate("rankWatchesForRotation(getWatches()).map(r => r.watch.brand)")
        check("recomienda primero el que nunca se ha puesto, luego el que lleva más días en la caja",
              order[0] == 'Seagull' or order[:1] == ['Seagull'], str(order))
        await page.evaluate("id => setWatchFlag(id, 'rotation', false)", B)
        order = await page.evaluate("rankWatchesForRotation(getWatches()).map(r => r.watch.brand)")
        check("un reloj fuera de rotación no se recomienda", 'Seagull' not in order, str(order))
        await page.evaluate("showView('home')")
        rec = await page.inner_text("#recommendation-banner")
        check("si todo lo que está en rotación se usó hoy, no hay recomendación", rec.strip() == '', rec)
        await page.evaluate("addWatch({brand:'Orient', model:'Bambino', type:'automatic'}).then(() => showView('home'))")
        await page.wait_for_timeout(100)
        rec = await page.inner_text("#recommendation-banner")
        check("con un reloj ya apuntado hoy no se sugiere otro", rec.strip() == '', rec)
        # «Hoy llevo…»: the sheet puts the one that is due first
        await page.click("#today-change")
        first = await page.inner_text(".today-pick >> nth=0")
        check("«Hoy llevo…» pone primero el que toca", 'Orient' in first and 'Te toca' in first, first)
        await page.keyboard.press("Escape")
        await page.evaluate("getWatches().forEach(w => removeWearDay(w.id, Date.now())); showView('home')")
        await page.wait_for_timeout(100)
        today_txt = await page.inner_text("#today-card")
        check("sin nada apuntado hoy, la portada pregunta qué reloj llevas", 'Hoy llevo' in today_txt, today_txt)
        rec = await page.inner_text("#recommendation-banner")
        check("recomienda el que nunca se ha puesto, sin el aviso alarmista del aceite",
              'Todavía no lo has llevado' in rec and 'aceite' not in rec.lower() and 'toca ponerse' in rec.lower(), rec)
        top = await page.evaluate("rankWatchesForRotation(getWatches())[0].watch.id")
        await page.click("#rec-wear")
        await page.wait_for_timeout(100)
        st_o = await page.evaluate("id => wearStats(getWatch(id))", top)
        today_txt = await page.inner_text("#today-card")
        brand = await page.evaluate("id => getWatch(id).brand", top)
        check("«Lo llevo hoy» desde la sugerencia apunta el día con un toque", st_o['daysSinceLast'] == 0 and brand in today_txt, today_txt)

        # ── Coste por uso y mantenimiento ──
        await page.evaluate("id => updateWatch(id, {purchasePrice: 120})", A)
        st = await page.evaluate("id => wearStats(getWatch(id))", A)
        check("coste por uso = precio / días", abs(st['costPerWear'] - 120) < 0.001, str(st))
        alerts_q = await page.evaluate(f"id => {{ updateWatch(id, {{batteryChanged: Date.now() - 800*{DAY}}}); return maintenanceAlerts(getWatch(id)); }}", Q)
        alerts_a = await page.evaluate(f"id => {{ updateWatch(id, {{lastService: Date.now() - 6*365*{DAY}}}); return maintenanceAlerts(getWatch(id)); }}", A)
        alerts_n = await page.evaluate(f"id => {{ updateWatch(id, {{lastService: Date.now() - 365*{DAY}}}); return maintenanceAlerts(getWatch(id)); }}", N)
        check("aviso de pila (cuarzo, >24 meses)", len(alerts_q) == 1 and alerts_q[0]['kind'] == 'battery')
        check("aviso de revisión (mecánico, >5 años)", len(alerts_a) == 1 and alerts_a[0]['kind'] == 'service')
        check("sin aviso si la revisión es reciente", alerts_n == [])

        # ── Ficha: botones y sección de uso ──
        await page.evaluate("id => openDetail(id)", A)
        await page.wait_for_timeout(200)
        usage = await page.inner_text("#d-usage")
        check("la ficha muestra días, coste por uso y avisos", 'DÍAS DE USO' in usage.upper() and '€' in usage and 'revisión' in usage, usage[:120])
        hist_len = await page.evaluate("history.length")
        await page.click("[data-act='fav']")
        await page.wait_for_timeout(100)
        fav = await page.evaluate("id => getWatch(id).favorite", A)
        check("marcar favorito desde la ficha", fav is True)
        check("re-pintar la ficha no apila entradas en el botón atrás", await page.evaluate("history.length") == hist_len)
        if SHOTS: await page.screenshot(path=f"{SHOTS}/ficha.png")

        # ── Formulario: campos de mantenimiento según tipo ──
        await page.evaluate("id => openEditModal(id)", Q)
        bat = await page.is_visible("#f-battery-field") or await page.evaluate("!document.getElementById('f-battery-field').hidden")
        svc_hidden = await page.evaluate("document.getElementById('f-service-field').hidden")
        check("cuarzo: muestra pila y oculta revisión", bat and svc_hidden)
        await page.evaluate("closeAddModal()")

        # ── Historial con edición ──
        await page.evaluate("showView('history')")
        await page.evaluate(f"openHistWatch('{B}')")
        await page.wait_for_timeout(100)
        edits = await page.locator("#history-body .interval-edit").count()
        check("el historial permite editar cada uso", edits >= 1)
        if SHOTS:
            await page.evaluate("setHistoryMode('ranking')")
            await page.screenshot(path=f"{SHOTS}/historial.png")

        # ── PDF con foto (WebP → JPEG) ──
        await page.evaluate("showView('settings')")
        try:
            async with page.expect_download(timeout=20000) as dl:
                await page.evaluate("handleExportPDF()")
            d = await dl.value
        except Exception:
            print('    toast:', await page.inner_text('#toast'), '| errores:', errs[-2:])
            raise
        path = await d.path()
        size = os.path.getsize(path)
        data = open(path, 'rb').read()
        check("el PDF se genera sin red y contiene la foto", size > 20000 and b'/Subtype /Image' in data, f"{size} bytes")

        # ── Iconos y fuentes locales ──
        await page.evaluate("showView('home')")
        await page.wait_for_timeout(300)
        fonts_ok = await page.evaluate("""() => document.fonts.check('16px "tabler-icons"') &&
                                              document.fonts.check('16px "Jost"')""")
        check("iconos y fuentes cargan desde la propia app", fonts_ok)
        check("ninguna petición a servicios externos", not external, ', '.join(external[:3]))
        check("sin errores de JavaScript", not errs, '; '.join(errs[:3]))
        check("la política de seguridad (CSP) no bloquea nada de la app, PDF incluido", not csp, '; '.join(csp[:2]))
        if SHOTS:
            await page.screenshot(path=f"{SHOTS}/coleccion.png")
        await b.close()

    failed = [r for r in results if not r[1]]
    print(f"--- {len(results) - len(failed)}/{len(results)} OK")
    sys.exit(1 if failed else 0)

asyncio.run(main())
