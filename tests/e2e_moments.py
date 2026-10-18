"""
Momentos y bienvenida: elegir el reloj del día por ocasión, ánimo y estación (sin «el que
toca»), guardar los momentos en el formulario, que viajen limpios por copias/nube, y la
bienvenida con historia de la relojería en cada apertura.

Uso (con la app en :8080):  python3 tests/e2e_moments.py
"""
import asyncio, os
from playwright.async_api import async_playwright

APP    = "http://localhost:8080/horlogerie/"
CHROME = os.environ.get("CHROME")
DAY    = 86400000
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('  ✓ ' if cond else '  ✗ ') + name + (f'  [{detail}]' if detail and not cond else ''))

async def main():
    print("\n=== Momentos y bienvenida ===")
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch())
        ctx = await b.new_context(locale="es-ES", viewport={"width": 412, "height": 900}, service_workers="block")
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        await page.goto(APP)
        await page.wait_for_function("typeof renderHome === 'function'")
        await page.wait_for_timeout(2200)
        await page.keyboard.press("Escape")

        # ── Bienvenida ──
        first = (await page.text_content("#inspiration-card .insp-text") or '').strip()
        check("al abrir, una bienvenida con historia de la relojería", len(first) > 30, first)
        await page.click("#inspiration-card .insp-close")
        check("se cierra con ×", (await page.inner_html("#inspiration-card")).strip() == '')
        await page.evaluate("renderHome()")
        check("cerrada, no vuelve hasta la próxima apertura", (await page.inner_html("#inspiration-card")).strip() == '')
        await page.reload(); await page.wait_for_function("typeof renderHome === 'function'"); await page.wait_for_timeout(2200)
        await page.keyboard.press("Escape")
        check("el mismo día no vuelve a salir (una sola vez al día)", (await page.inner_html("#inspiration-card")).strip() == '')
        await page.evaluate("localStorage.removeItem('rotor_inspiration_day')")   # al día siguiente
        await page.reload(); await page.wait_for_function("typeof renderHome === 'function'"); await page.wait_for_timeout(2200)
        await page.keyboard.press("Escape")
        second = (await page.text_content("#inspiration-card .insp-text") or '').strip()
        check("al día siguiente, otra distinta", second and second != first, f"{first[:40]} / {second[:40]}")
        await page.click("#inspiration-card .insp-close")

        # ── Sin momentos: sugerencia por días en la caja y una pista ──
        ids = await page.evaluate(f"""async () => {{
          const a = await addWatch({{ brand: 'Oris', model: 'Divers Sixty-Five', type: 'automatic' }});
          const b = await addWatch({{ brand: 'Longines', model: 'Conquest', type: 'automatic' }});
          const c = await addWatch({{ brand: 'Seiko', model: 'Presage', type: 'automatic' }});
          addWearDays(a.id, [Date.now() - 3 * {DAY}]);
          addWearDays(b.id, [Date.now() - 40 * {DAY}]);
          addWearDays(c.id, [Date.now() - 10 * {DAY}]);
          renderHome(); return [a.id, b.id, c.id]; }}""")
        A, B, C = ids
        rec = await page.text_content("#recommendation-banner")
        check("sin momentos: «Para hoy», nunca «Toca ponerse»", 'Para hoy' in rec and 'toca' not in rec.lower(), rec)
        check("sin momentos: pista para marcarlos", 'momentos' in rec.lower(), rec)
        await page.click("#rec-hint-close")
        await page.evaluate("renderHome()")
        check("la pista se cierra con × y no vuelve", 'momentos' not in (await page.text_content("#recommendation-banner")).lower())
        check("sin momentos: propone el que lleva más tiempo en la caja", 'Longines' in await page.inner_text(".rec-watch"))

        # ── Momentos en el formulario ──
        await page.evaluate(f"openEditModal('{A}')")
        await page.click("#f-moments .moment-chip[data-moment='mar']")
        await page.click("#f-moments .moment-chip[data-moment='finde']")
        await page.click("#f-moments .moment-chip[data-moment='finde']")   # on and off again
        await page.click("#f-moments .moment-chip[data-moment='atrevido']")
        await page.click("#modal-save-btn")
        await page.wait_for_timeout(300)
        m = await page.evaluate(f"getWatch('{A}').moments")
        check("el formulario guarda los momentos elegidos (y el que se desmarca, no)", m == ['mar', 'atrevido'], str(m))
        await page.evaluate(f"openEditModal('{A}')")
        pressed = await page.eval_on_selector_all("#f-moments .moment-chip[aria-pressed='true']", "els => els.map(e => e.dataset.moment)")
        check("al editar, aparecen marcados", pressed == ['mar', 'atrevido'], str(pressed))
        await page.evaluate("closeAddModal()")
        season = await page.evaluate("currentSeason()")
        await page.evaluate(f"updateWatch('{C}', {{ moments: ['evento', 'clasico', '{season}'] }}).then(() => {{ showView('home'); renderHome(); }})")
        await page.wait_for_timeout(200)

        # ── Portada: estación, chips y «más tiempo en la caja» ──
        rec = await page.text_content("#recommendation-banner")
        check("de la estación actual primero (aunque no sea el más olvidado)", 'Presage' in await page.inner_text(".rec-watch"), rec)
        check("y recuerda cuál lleva más tiempo en la caja", 'En la caja' in rec and 'Longines' in rec, rec)
        chips = await page.eval_on_selector_all(".rec-chip", "els => els.map(e => e.dataset.moment)")
        check("chips solo de los momentos que tienen tus relojes", set(chips) == {'mar', 'atrevido', 'evento', 'clasico', season}, str(chips))
        await page.click(".rec-chip[data-moment='mar']")
        rec = await page.text_content("#recommendation-banner")
        check("«Mar y piscina»: propone el reloj marcado para el mar", 'Para «Mar y piscina»' in rec and 'Oris' in await page.inner_text(".rec-watch"), rec)
        await page.click(".rec-chip[data-moment='mar']")
        check("tocar otra vez el chip vuelve a «Para hoy»", "Para hoy" in await page.text_content("#recommendation-banner"))

        # ── Copias y nube: solo momentos conocidos ──
        clean = await page.evaluate("sanitizeWatch({ brand: 'X', model: 'Y', moments: ['mar', 'hackeo', 'mar', 5, 'verano'] }).moments")
        check("las copias y la nube solo aceptan momentos conocidos, sin repetir", clean == ['mar', 'verano'], str(clean))
        s = await page.evaluate("[currentSeason(new Date(2026, 0, 15).getTime(), 'es-ES'), currentSeason(new Date(2026, 0, 15).getTime(), 'pt-BR')]")
        check("en enero es invierno en España y verano en Brasil", s == ['invierno', 'verano'], str(s))

        # ── Al apuntar el reloj del día, la sugerencia se va ──
        await page.click("#rec-wear")
        await page.wait_for_timeout(150)
        check("al ponerte el reloj sugerido, la sugerencia se va", (await page.inner_text("#recommendation-banner")).strip() == '')

        # ── Inglés ──
        await page.evaluate("localStorage.setItem('rotor_prefs_v1', JSON.stringify({ lang: 'en', onboarded: true })); localStorage.removeItem('rotor_inspiration_day'); location.reload()")
        await page.wait_for_function("typeof renderHome === 'function'"); await page.wait_for_timeout(2200)
        await page.keyboard.press("Escape")
        await page.evaluate("getWatches().forEach(w => { if (w.wearStart) stopWearing(w.id); removeWearDay(w.id, Date.now()); }); renderHome()")
        rec = await page.text_content("#recommendation-banner")
        insp = await page.text_content("#inspiration-card .insp-text")
        check("en inglés: chips y bienvenida traducidos", 'What do you feel like today?' in rec and not any(x in insp for x in (' el ', ' la ', ' de ')), rec[:120])

        check("sin errores de JavaScript", not errs, errs[:3])
        await b.close()
    ok = sum(1 for _, c in results if c)
    print(f"--- {ok}/{len(results)} OK")
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
