"""
Idioma, tema, moneda, primera vez y la ficha por secciones.

Un móvil en inglés ve la app en inglés (textos fijos y dinámicos); el tema y la
moneda se cambian en Ajustes; la bienvenida sale una sola vez.

Uso (con la app servida en :8080 como indica e2e_sync.py):
  python3 tests/e2e_i18n.py
"""
import asyncio, json, os, re
from playwright.async_api import async_playwright

APP    = "http://localhost:8080/horlogerie/"
CHROME = os.environ.get("CHROME")
SHOTS  = os.environ.get("SHOTS")
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('  ✓ ' if cond else '  ✗ ') + name + (f'  [{detail}]' if detail and not cond else ''))

# Spanish words that should never show up in the English interface
SPANISH = re.compile(r"\b(reloj|relojes|colección|ajustes|historial|deseos|añadir|guardar|copia|nube|días|hoy|llevo|toca|sin|del|los|las|una)\b|[ñ¿¡]", re.I)

def spanish_left(text, allow=()):
    hits = [m.group(0) for m in SPANISH.finditer(text)]
    return [h for h in hits if h.lower() not in allow]

async def main():
    print("\n=== Idioma, tema, moneda y primera vez ===")
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch())
        ctx = await b.new_context(locale="en-GB", viewport={"width": 412, "height": 900}, service_workers='block')
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        await page.goto(APP)
        await page.wait_for_function("typeof renderHome === 'function'")
        await page.wait_for_timeout(2200)

        # ── Static texts in English ──
        nav = await page.text_content(".bottom-nav")
        check("móvil en inglés → menú en inglés", 'Collection' in nav and 'Settings' in nav and 'Colección' not in nav, nav)
        check("<html lang> sigue al idioma", await page.evaluate("document.documentElement.lang") == 'en')
        empty = await page.text_content("#empty-state")
        check("portada vacía en inglés", 'Your collection is empty' in empty and not spanish_left(empty), empty)

        # ── First run (automated browsers skip it unless forced) ──
        check("la bienvenida no tapa la app en navegadores automatizados", await page.locator(".onboarding").count() == 0)
        await page.evaluate("maybeShowOnboarding({ force: true })")
        await page.wait_for_timeout(150)
        ob = await page.text_content(".onboarding")
        check("bienvenida: tres ideas y dos salidas", 'Welcome to Rotor' in ob and 'Add my first watch' in ob and 'restore' in ob.lower(), ob)
        await page.click("#ob-add")
        await page.wait_for_timeout(150)
        check("«Add my first watch» abre el alta", await page.is_visible("#add-modal"))
        check("cerrar la bienvenida la marca como vista", await page.evaluate("JSON.parse(localStorage.getItem('rotor_prefs_v1')).onboarded === true"))
        modal = await page.text_content("#add-modal")
        check("formulario de alta en inglés", 'Movement type' in modal and 'Hand-wound' in modal and not spanish_left(modal, ('pagani', 'san')), str(spanish_left(modal)))
        await page.evaluate("closeAddModal()")

        # ── Data ──
        ids = await page.evaluate("""async () => {
          const a = await addWatch({ brand: 'Seiko', model: 'Alpinist', type: 'automatic' });
          const q = await addWatch({ brand: 'Casio', model: 'Duro', type: 'quartz' });
          await updateWatch(a.id, { purchasePrice: 450, lastService: Date.now() - 6 * 365 * 86400000 });
          addWearDays(q.id, Date.now() - 3 * 86400000);
          renderHome(); return [a.id, q.id]; }""")
        A, Q = ids
        sub = await page.text_content("#home-subtitle")
        check("subtítulo en inglés con libras (región GB)", sub.startswith('2 watches') and '£450' in sub, sub)
        today = await page.text_content("#today-card")
        check("portada: «Today I wear…»", 'Today I wear' in today, today)
        rec = await page.text_content("#recommendation-banner")
        check("sugerencia en inglés", 'For today' in rec and "I'm wearing it today" in rec, rec)
        grid = await page.text_content("#watches-grid")
        check("tarjetas sin anglicismos ni emojis, tipo traducido", 'QUARTZ' in grid.upper() and not re.search(r"[⚙🔋🕰⌚]", grid), grid)
        check("sin foto: esfera dibujada (SVG), no emoji", await page.locator("#watches-grid .dial-art").count() == 2)

        # ── «Today I wear…» sheet ──
        await page.click("#today-change")
        await page.wait_for_timeout(150)
        sheet = await page.text_content(".sheet")
        check("hoja «Today I wear…» en inglés, con el que lleva más tiempo en la caja marcado", 'Today I wear' in sheet and 'Longest in the box' in sheet and not spanish_left(sheet), str(spanish_left(sheet)))
        await page.click(f".today-pick[data-id='{A}']")
        await page.wait_for_timeout(100)
        check("un toque apunta hoy", await page.evaluate("id => wearStats(getWatch(id)).daysSinceLast", A) == 0)
        await page.click(f".today-pick[data-id='{A}']")
        await page.wait_for_timeout(100)
        check("otro toque lo quita (error de dedo)", await page.evaluate("id => wearStats(getWatch(id)).daysSinceLast", A) is None)
        await page.click(".sheet [data-close]")
        await page.wait_for_timeout(100)

        # ── Detail in sections ──
        await page.evaluate("id => openDetail(id)", A)
        await page.wait_for_timeout(150)
        tabs = await page.text_content(".detail-tabs")
        check("ficha en cuatro secciones", all(x in tabs for x in ('Summary', 'Specs', 'History', 'Maintenance')), tabs)
        summ = await page.text_content("#dt-summary")
        check("acción principal: «I'm wearing it today»; medir tiempo es opcional", "I'm wearing it today" in summ and 'Time how long' in summ, summ[:200])
        check("resumen en inglés", not spanish_left(summ), str(spanish_left(summ)))
        await page.click("#dtab-maint")
        maint = await page.text_content("#dt-maint")
        check("mantenimiento: aviso de revisión y precio pagado", 'due for a service' in maint and '£450' in maint, maint[:200])
        check("solo se ve la sección elegida", not await page.is_visible("#dt-summary") and await page.is_visible("#dt-maint"))
        await page.focus("#dtab-maint"); await page.keyboard.press("ArrowLeft")
        check("flechas del teclado cambian de sección", await page.is_visible("#dt-history"))
        hist = await page.text_content("#dt-history")
        check("historial del reloj en su sección", 'Log a wear' in hist, hist[:120])
        await page.click("#dtab-specs")
        specs = await page.text_content("#dt-specs")
        check("ficha técnica en inglés", 'Calibre' in specs and 'Lug width' in specs and not spanish_left(specs), str(spanish_left(specs)))
        await page.evaluate("id => openDetail(id)", A)
        check("re-pintar el mismo reloj conserva la sección", await page.is_visible("#dt-specs"))
        await page.evaluate("id => openDetail(id)", Q)
        check("otro reloj empieza en Resumen", await page.is_visible("#dt-summary"))
        if SHOTS: await page.screenshot(path=f"{SHOTS}/en-detail.png")

        # ── History and settings, no Spanish left ──
        await page.evaluate("showView('history')")
        await page.wait_for_timeout(150)
        h = await page.text_content("#view-history")
        check("historial en inglés (meses y días de la semana incluidos)", not spanish_left(h), str(spanish_left(h)))
        await page.evaluate("showView('settings')")
        await page.wait_for_timeout(500)
        s = await page.text_content("#view-settings")
        check("ayuda, privacidad y cookies enlazan a las páginas en inglés",
              await page.get_attribute("#view-settings a[data-href-en*='help']", "href") == './help.html'
              and await page.get_attribute("#view-settings a[data-href-en*='privacy']", "href") == 'https://rotor.pedicode-app.workers.dev/privacy.html'
              and await page.get_attribute("#view-settings a[data-href-en*='cookie']", "href") == 'https://rotor.pedicode-app.workers.dev/cookie-policy.html')
        check("ajustes en inglés", 'Preferences' in s and not spanish_left(s, ('ñ',)), str(spanish_left(s, ('ñ',))))

        # ── Theme ──
        await page.select_option("#pref-theme", "dark")
        check("tema oscuro forzado", await page.evaluate("document.documentElement.dataset.theme") == 'dark')
        bg = await page.evaluate("getComputedStyle(document.body).backgroundColor")
        check("el oscuro cambia los colores de verdad", bg == 'rgb(11, 18, 32)', bg)
        await page.select_option("#pref-theme", "auto")
        check("automático sigue al sistema", await page.evaluate("document.documentElement.dataset.theme") is None)

        # ── Currency ──
        await page.select_option("#pref-currency", "USD")
        await page.evaluate("showView('home')")
        sub = await page.text_content("#home-subtitle")
        check("moneda en dólares (solo formato, sin convertir)", '$450' in sub, sub)

        # ── Language switch persists across reloads ──
        await page.evaluate("showView('settings')")
        await page.select_option("#pref-lang", "es")
        await page.wait_for_load_state()
        await page.wait_for_function("typeof renderHome === 'function'")
        await page.wait_for_timeout(2200)
        nav = await page.text_content(".bottom-nav")
        check("elegir Español en Ajustes cambia el idioma y se recuerda", 'Colección' in nav and 'Ajustes' in nav, nav)
        sub = await page.text_content("#home-subtitle")
        check("en español, la moneda elegida se mantiene", '450' in sub and '$' in sub and 'invertidos' in sub, sub)

        check("sin errores de JavaScript", not errs, errs[:3])

        # ── Base de modelos en el idioma de la app ──
        ctx2 = await b.new_context(locale="en-US", viewport={"width": 412, "height": 900}, service_workers='block')
        en = await ctx2.new_page()
        await en.goto(APP)
        await en.wait_for_function("typeof dbSearch === 'function'")
        hit = await en.evaluate("dbLoad().then(() => dbSearch('Berny Open Heart', 1)[0])")
        check("base de modelos en inglés: valores traducidos", hit['specs']['cristal'] == 'Sapphire · Flat' and 'jewels' in hit['specs']['movimiento'] and 'en' not in hit, json.dumps(hit['specs'], ensure_ascii=False))
        await ctx2.close()

        # ── Portugués ──
        ctx3 = await b.new_context(locale="pt-PT", viewport={"width": 412, "height": 900}, service_workers='block')
        pt = await ctx3.new_page()
        perrs = []
        pt.on("pageerror", lambda e: perrs.append(str(e)))
        await pt.goto(APP)
        await pt.wait_for_function("typeof renderHome === 'function'")
        await pt.wait_for_timeout(2200)
        nav = await pt.text_content(".bottom-nav")
        check("móvil en portugués → app en portugués", 'Coleção' in nav and 'Definições' in nav and 'Histórico' in nav, nav)
        await pt.evaluate("addWatch({ brand: 'Seiko', model: 'Alpinist', type: 'automatic' }).then(w => updateWatch(w.id, { purchasePrice: 450 })).then(() => renderHome())")
        await pt.wait_for_timeout(200)
        sub = (await pt.text_content("#home-subtitle")).replace('\xa0', ' ')
        check("portada en portugués con euros en formato portugués", sub.startswith('1 relógio') and '450 €' in sub and 'investidos' in sub, sub)
        check("«Hoje uso…» en la portada", 'Hoje uso' in await pt.text_content("#today-card"))
        hit = await pt.evaluate("dbLoad().then(() => dbSearch('Berny Open Heart', 1)[0].specs)")
        check("base de modelos en portugués", hit['cristal'] == 'Safira · Plano' and 'rubis' in hit['movimiento'], json.dumps(hit, ensure_ascii=False))
        await pt.evaluate("showView('settings')")
        await pt.wait_for_timeout(400)
        check("ayuda, privacidad y cookies enlazan a las páginas en portugués",
              await pt.get_attribute("#view-settings a[data-href-pt*='ajuda']", "href") == './ajuda-pt.html'
              and await pt.get_attribute("#view-settings a[data-href-pt*='privacidade']", "href") == 'https://rotor.pedicode-app.workers.dev/privacidade.html'
              and await pt.get_attribute("#view-settings a[data-href-pt*='cookies-pt']", "href") == 'https://rotor.pedicode-app.workers.dev/politica-cookies-pt.html')
        month = await pt.evaluate("showView('history'); document.getElementById('cal-title').textContent")
        check("calendario con meses en portugués", any(m in month.lower() for m in ('janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro')), month)
        check("sin errores de JavaScript (portugués)", not perrs, perrs[:3])
        await ctx3.close()
        await b.close()
    ok = sum(1 for _, c in results if c)
    print(f"--- {ok}/{len(results)} OK")
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
