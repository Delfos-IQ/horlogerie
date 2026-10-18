"""
Familias: lista fija (Buceo, Cronógrafo, GMT…), una por reloj. Rotor PROPONE una según la
marca y el modelo y el usuario decide; con 6 relojes o más y al menos 2 familias aparece
el filtro de la colección, que se recuerda. La familia se edita en la ficha y viaja en copias.

Uso (con la app en :8080):  python3 tests/e2e_families.py
"""
import asyncio, os
from playwright.async_api import async_playwright

APP    = "http://localhost:8080/horlogerie/"
CHROME = os.environ.get("CHROME")
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('  ✓ ' if cond else '  ✗ ') + name + (f'  [{detail}]' if detail and not cond else ''))

async def main():
    print("\n=== Familias: propuesta, filtro y ficha ===")
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch())
        ctx = await b.new_context(locale="es-ES", viewport={"width": 412, "height": 900}, service_workers="block", bypass_csp=True)
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        await page.goto(APP)
        await page.wait_for_function("typeof renderHome === 'function'")
        await page.evaluate("localStorage.setItem('rotor_prefs_v1', JSON.stringify({ lang: 'es', onboarded: true }))")
        await page.reload(); await page.wait_for_function("typeof renderHome === 'function'"); await page.wait_for_timeout(2200)
        await page.keyboard.press("Escape")

        # ── Propuestas: palabras enteras, nada inventado ──
        g = await page.evaluate("""() => [
          guessFamily({ brand: 'Orient', model: 'Triton' }), guessFamily({ brand: 'Seagull', model: '1963' }),
          guessFamily({ brand: 'Seagull', model: 'Ocean Star' }), guessFamily({ brand: 'Seiko', model: 'Presage Cocktail' }),
          guessFamily({ brand: 'Pagani Design', model: 'Explorer' }), guessFamily({ brand: 'Berny', model: 'X', specs: { resistencia: '300 m' } }),
          guessFamily({ brand: 'Casio', model: 'F-91W' }) ]""")
        check("propone por palabras enteras (Triton→buceo, 1963→crono, Seagull no es «sea»)",
              g == ['diver', 'chrono', None, 'dress', 'field', 'diver', None], g)
        check("una familia desconocida no se guarda", await page.evaluate(
            "() => sanitizeWatch({ id: 'x', brand: 'a', model: 'b', family: 'inventada' }).family === undefined && sanitizeWatch({ id: 'x', brand: 'a', model: 'b', family: 'gmt' }).family === 'gmt'"))

        # ── Formulario: propone al escribir, el usuario puede cambiarla ──
        await page.evaluate("openAddModal()"); await page.wait_for_timeout(150)
        await page.fill("#f-brand", "Steeldive"); await page.fill("#f-model", "Tuna")
        check("al escribir marca y modelo, propone «Buceo»", await page.input_value("#f-family") == 'diver')
        await page.select_option("#f-family", "sport")
        await page.fill("#f-model", "Tuna 1975")
        check("si la cambias a mano, ya no la pisa", await page.input_value("#f-family") == 'sport')
        await page.click("#modal-save-btn"); await page.wait_for_timeout(400)
        check("se guarda con el reloj", await page.evaluate("getWatches().find(w => w.model === 'Tuna 1975')?.family") == 'sport')

        # ── Pocos relojes: sin filtro ──
        await page.evaluate("showView('home'); renderHome()")
        check("con menos de 6 relojes no hay filtro", await page.evaluate("document.getElementById('family-filter').innerHTML.trim() === ''"))

        await page.evaluate("""async () => {
          for (const [brand, model] of [['Orient','Triton'],['Seagull','1963'],['Seiko','Presage'],['Casio','F-91W'],['Hamilton','Khaki Field'],['Berny','Pilot']])
            await addWatch({ brand, model, type: 'automatic' });
          renderHome(); }""")
        await page.wait_for_timeout(150)
        check("con 7 relojes y una sola familia, invita a clasificar", await page.is_visible("#fam-setup"))

        # ── Clasificar de una vez: propuestas que el usuario revisa ──
        await page.click("#fam-setup"); await page.wait_for_timeout(200)
        n = await page.evaluate("document.querySelectorAll('.fam-select').length")
        pre = await page.evaluate("[...document.querySelectorAll('.fam-select')].filter(s => s.value).length")
        check("la hoja lista los 6 sin familia, 5 con propuesta (Casio sin ella)", n == 6 and pre == 5, f"{n} {pre}")
        await page.click("#fam-save"); await page.wait_for_timeout(300)
        chips = await page.evaluate("[...document.querySelectorAll('.fam-chip[data-fam]')].map(b => b.dataset.fam + ':' + b.querySelector('.fam-n').textContent)")
        check("aparece el filtro con cuántos hay de cada familia", 'all:7' in chips and 'diver:1' in chips and 'none:1' in chips, chips)

        # ── Filtrar y recordar ──
        await page.click(".fam-chip[data-fam='diver']"); await page.wait_for_timeout(150)
        shown = await page.evaluate("[...document.querySelectorAll('#watches-grid .watch-card')].map(c => c.querySelector('.watch-model').textContent)")
        check("el filtro «Buceo» deja solo el Triton", shown == ['Triton'], shown)
        await page.reload(); await page.wait_for_function("typeof renderHome === 'function'"); await page.wait_for_timeout(2200)
        await page.keyboard.press("Escape")
        shown2 = await page.evaluate("document.querySelectorAll('#watches-grid .watch-card').length")
        check("al volver a abrir la app recuerda el filtro", shown2 == 1 and await page.get_attribute(".fam-chip[data-fam='diver']", "aria-pressed") == 'true')

        # ── Ficha: campo Familia editable ──
        cid = await page.evaluate("getWatches().find(w => w.brand === 'Casio').id")
        await page.evaluate("id => openDetail(id, 'specs')", cid); await page.wait_for_timeout(250)
        check("la ficha muestra «Familia» vacía", 'Elegir' in (await page.text_content("#spec-family")))
        await page.click("#spec-family"); await page.wait_for_timeout(200)
        await page.click(".fam-pick[data-fam='sport']"); await page.wait_for_timeout(300)
        check("se elige en la ficha y se guarda", await page.evaluate("id => getWatch(id).family", cid) == 'sport'
              and 'Deportivo' in (await page.text_content("#spec-family")))
        await page.evaluate("showView('home'); renderHome()"); await page.wait_for_timeout(150)
        check("sin relojes «Sin familia», desaparece ese chip", await page.evaluate("!document.querySelector(\".fam-chip[data-fam='none']\") && !document.getElementById('fam-classify')"))
        await page.click(".fam-chip[data-fam='diver']"); await page.wait_for_timeout(150)
        check("tocar el filtro activo vuelve a «Todos»", await page.evaluate("document.querySelectorAll('#watches-grid .watch-card').length") == 7)

        # ── Inglés ──
        await page.evaluate("localStorage.setItem('rotor_prefs_v1', JSON.stringify({ lang: 'en', onboarded: true }))")
        await page.reload(); await page.wait_for_function("typeof renderHome === 'function'"); await page.wait_for_timeout(2200)
        await page.keyboard.press("Escape")
        txt = await page.text_content("#family-filter")
        check("traducido al inglés", 'Diver' in txt and 'All' in txt, txt[:200])

        check("sin errores de JavaScript", not errs, errs[:3])
        await b.close()

    ok = sum(1 for _, c in results if c)
    print(f"\n{ok}/{len(results)} OK")
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
