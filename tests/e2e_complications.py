"""
Complicaciones (v2.25): fase lunar calculada en el móvil (fechas contrastadas con eclipses
conocidos) y medición de precisión con un toque (gratis; el historial es Pro).

Uso (con la app en :8080):  python3 tests/e2e_complications.py
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
    print("\n=== Complicaciones: fase lunar y precisión ===")
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

        # ── Astronomía: lunas nuevas y llenas de eclipses conocidos, a menos de 5 minutos ──
        diffs = await page.evaluate("""() => {
          const cases = [['2026-08-12T17:37Z', 'new'], ['2026-03-03T11:38Z', 'full'], ['2024-04-08T18:21Z', 'new'], ['2025-03-14T06:55Z', 'full']];
          return cases.map(([iso, kind]) => { const t = Date.parse(iso); const m = moonAt(t + 2 * 86400000);
            const got = kind === 'new' ? m.lastNew : m.lastFull; return Math.abs(got - t) / 60000; }); }""")
        check("las fases coinciden con los eclipses de 2024–2026 (± 5 min)", all(d < 5 for d in diffs), diffs)
        m = await page.evaluate("(() => { const m = moonAt(Date.parse('2026-10-29T12:00Z')); return [m.phase, Math.round(m.illumination * 100), moonClicks(Date.parse('2026-10-29T12:00Z'))]; })()")
        check("29/10/2026: gibosa menguante, ~87 % iluminada, 3 clics desde la llena del 26", m == ['waning-gibbous', 87, 3], m)
        check("detecta relojes con fase lunar por el nombre", await page.evaluate(
            "hasMoonPhase({ brand: 'Sugess', model: 'Moonphase' }) && hasMoonPhase({ brand: 'X', model: 'Y', specs: { esfera: 'Fase lunar' } }) && !hasMoonPhase({ brand: 'Seiko', model: 'Presage' })"))

        # ── Sección: en el menú, con la luna y el ajuste ──
        await page.evaluate("""async () => { await addWatch({ brand: 'Sugess', model: 'Moonphase', type: 'automatic' });
          const w = await addWatch({ brand: 'Orient', model: 'Triton', type: 'automatic' });
          addAccuracyReading(w.id, { ts: Date.now() - 2 * 86400000, offset: 2 }); }""")
        await page.click("#nav-complications"); await page.wait_for_timeout(400)
        moon = await page.text_content("#cx-moon")
        check("el menú abre Complicaciones con la fase de hoy, la próxima luna llena y los clics",
              'Fase lunar' in moon and 'Próxima luna llena' in moon and 'clic' in moon and await page.locator("#cx-moon svg.cx-dial").count() == 1, moon[:200])
        check("y nombra tus relojes con fase lunar", 'Sugess Moonphase' in moon)

        # ── Precisión: tocar «Ahora», elegir el minuto, ver la desviación y el ritmo, guardar (gratis) ──
        await page.select_option("#cx-watch", label="Orient Triton")
        check("sin Pro, el historial de precisión aparece como Pro", 'Historial de precisión' in await page.text_content("#cx-acc") and await page.locator("#cx-acc .pro-teaser").count() == 1)
        await page.click("#cx-now"); await page.wait_for_timeout(200)
        off = await page.text_content(".cx-offset")
        check("tras «Ahora» muestra la desviación respecto al minuto más cercano (|x| ≤ 30 s)", off.strip().endswith('s') and abs(float(off.strip()[1:-2].replace(',', '.').replace('±', ''))) <= 30, off)
        check("y el ritmo en s/día desde la medición anterior", 's/día' in await page.text_content(".cx-rate"))
        await page.click("#cx-plus"); await page.wait_for_timeout(100)
        off2 = await page.text_content(".cx-offset")
        check("el + suma un minuto (60 s más)", abs(float(off2.strip()[1:-2].replace(',', '.')) - float(off.strip()[1:-2].replace(',', '.').replace('±', '')) * (1 if off.strip()[0] == '+' else -1) - 60) < 0.2 if off.strip()[0] in '+−±' else False, f"{off} → {off2}")
        await page.click("#cx-minus"); await page.wait_for_timeout(100)
        await page.click("#cx-save"); await page.wait_for_timeout(200)
        n = await page.evaluate("getWatches().find(w => w.brand === 'Orient').accuracy.length")
        check("guardar la medición funciona sin Pro", n == 2, n)
        check("y vuelve al reloj en marcha", await page.locator("#cx-now").count() == 1)

        # ── Con Pro: enlace al historial del reloj ──
        await page.evaluate("setProPromo(Date.now() + 86400000); showView('complications')"); await page.wait_for_timeout(200)
        await page.select_option("#cx-watch", label="Orient Triton")
        await page.click("#cx-history"); await page.wait_for_timeout(300)
        check("con Pro, «Ver el historial» abre la precisión del reloj", await page.evaluate("document.getElementById('view-detail').classList.contains('active')") and 'Precisión' in await page.text_content("#d-care"))
        await page.evaluate("setProPromo(0)")

        # ── Reserva de marcha (v2.26) ──
        r = await page.evaluate("""() => [parseReserveHours('41 h'), parseReserveHours('42 horas'), parseReserveHours('3 días'), parseReserveHours('70h'),
            parseReserveHours(''), parseReserveHours('5 bar')]""")
        check("lee la reserva de la ficha (41 h, 42 horas, 3 días, 70h; sin número → nada)", r == [41, 42, 72, 70, None, None], r)
        clicks = await page.evaluate("""() => [dateClicks(new Date(2026, 8, 30, 10).getTime(), new Date(2026, 9, 2, 12).getTime()),
            dateClicks(new Date(2026, 9, 10, 10).getTime(), new Date(2026, 9, 12, 9).getTime()), dateClicks(Date.now(), Date.now())]""")
        check("clics de fecha: del 30 de septiembre al 2 de octubre son 3 (pasa por el 31)", clicks == [3, 2, 0], clicks)
        check("entre las 21:00 y las 3:00 avisa de no tocar la fecha",
              await page.evaluate("dateDangerZone(new Date(2026, 9, 1, 22).getTime()) && dateDangerZone(new Date(2026, 9, 1, 2).getTime()) && !dateDangerZone(new Date(2026, 9, 1, 12).getTime())"))
        st = await page.evaluate("""async () => { const H = 3600000, now = Date.now();
            const a = await addWatch({ brand: 'Res', model: 'Marcha', type: 'automatic' }); await updateWatch(a.id, { specs: { reserva: '41 h' } });
            getWatch(a.id).history = [{ start: now - 20 * H, end: now - 10 * H, timed: true }];
            const b = await addWatch({ brand: 'Res', model: 'Parado', type: 'manual' });
            getWatch(b.id).history = [{ start: now - 100 * H, end: now - 90 * H, timed: true }];
            const q = await addWatch({ brand: 'Res', model: 'Cuarzo', type: 'quartz' });
            const sa = reserveStatus(getWatch(a.id)), sb = reserveStatus(getWatch(b.id));
            return [sa.state, Math.round(sa.remainingH), sa.estimated, sb.state, sb.estimated, sb.hours, reserveStatus(getWatch(q.id))]; }""")
        check("un automático de 41 h quitado hace 10 h: le quedan 31 h; uno sin dato usa 40 h y lo dice; el cuarzo no aparece",
              st == ['running', 31, False, 'stopped', True, 40, None], st)
        await page.evaluate("showView('complications')"); await page.wait_for_timeout(300)
        res = await page.text_content("#cx-res")
        check("la sección muestra cuándo se para y los clics de fecha del parado", 'Le quedan ~31 h' in res and 'Parado' in res and 'reserva estimada: 40 h' in res and 'Res Cuarzo' not in res, res[:300])

        # ── GMT (v2.26) ──
        d = await page.evaluate("[zoneDiffMinutes('Asia/Tokyo', Date.parse('2026-07-01T12:00Z')) - zoneDiffMinutes('UTC', Date.parse('2026-07-01T12:00Z')), zoneTime('Asia/Tokyo', Date.parse('2026-07-01T20:30Z')).h]")
        check("Tokio va 9 h por delante de UTC (y a las 20:30 UTC allí son las 5)", d == [540, 5], d)
        await page.select_option("#cx-gmt-city", "America/New_York"); await page.wait_for_timeout(200)
        g = await page.text_content("#cx-gmt")
        check("GMT: eliges una ciudad y muestra su hora, la diferencia y la esfera de 24 h",
              'Nueva York' in g and 'respecto a aquí' in g and await page.locator("#cx-gmt svg.cx-dial").count() == 1
              and await page.evaluate("localStorage.getItem('rotor_gmt_zone')") == 'America/New_York', g[:200])

        # ── Inglés ──
        await page.evaluate("localStorage.setItem('rotor_prefs_v1', JSON.stringify({ lang: 'en', onboarded: true }))")
        await page.reload(); await page.wait_for_function("typeof renderHome === 'function'"); await page.wait_for_timeout(2200)
        await page.keyboard.press("Escape")
        await page.click("#nav-complications"); await page.wait_for_timeout(300)
        txt = await page.text_content("#complications-body")
        check("en inglés", 'Moon phase' in txt and 'Next full moon' in txt and 'Accuracy' in txt and 'Power reserve' in txt and 'New York' in txt and 'Workshop' in await page.text_content("#nav-complications"), txt[:150])

        check("sin errores de JavaScript", not errs, errs[:3])
        await b.close()
    ok = sum(1 for _, c in results if c)
    print(f"--- {ok}/{len(results)} OK")
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
