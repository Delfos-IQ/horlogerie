"""
Tiempo en la muñeca y métricas: al ponerte otro reloj, el anterior guarda las horas reales;
el historial las muestra; el ranking dice cuál lleva más tiempo en la caja y las horas en la
muñeca; «Sorpréndeme» propone uno al azar.

Uso (con la app en :8080):  python3 tests/e2e_metrics.py
"""
import asyncio, os
from playwright.async_api import async_playwright

APP    = "http://localhost:8080/horlogerie/"
CHROME = os.environ.get("CHROME")
H = 3600000
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('  ✓ ' if cond else '  ✗ ') + name + (f'  [{detail}]' if detail and not cond else ''))

async def main():
    print("\n=== Tiempo en la muñeca, métricas y «Sorpréndeme» ===")
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
        A, B, C, D = await page.evaluate(f"""async () => {{
          const a = await addWatch({{ brand: 'Berny', model: 'Trava', type: 'automatic' }});
          const b = await addWatch({{ brand: 'Orient', model: 'Triton', type: 'automatic' }});
          const c = await addWatch({{ brand: 'Seiko', model: 'Presage', type: 'automatic' }});
          const d = await addWatch({{ brand: 'Steeldive', model: 'Tuna', type: 'automatic' }});
          addWearDays(c.id, [Date.now() - 20 * 86400000]);
          addWearDays(d.id, [Date.now() - 2 * 86400000]);
          return [a.id, b.id, c.id, d.id]; }}""")

        # ── Por la mañana el Berny (3 h), por la tarde el Orient ──
        await page.evaluate(f"id => {{ startWearing(id); getWatch(id).wearStart = Date.now() - 3 * {H}; }}", A)
        await page.evaluate("id => switchToWatch(id)", B)
        h = await page.evaluate("id => getWatch(id).history.slice(-1)[0]", A)
        hrs = await page.evaluate("id => wearStats(getWatch(id)).hoursWorn", A)
        check("al ponerte otro, el anterior guarda su tiempo real (sesión marcada)", h.get('timed') is True and abs(hrs - 3) < 0.05, f"{h} {hrs}")
        kept = await page.evaluate("w => sanitizeWatch(w).history.slice(-1)[0].timed", await page.evaluate("id => getWatch(id)", A))
        check("las copias y la nube conservan qué tiempo es real", kept is True)
        check("los dos cuentan para hoy; solo uno puesto",
              await page.evaluate(f"() => wearStats(getWatch('{A}')).daysSinceLast === 0 && wearStats(getWatch('{B}')).daysSinceLast === 0 && getWatches().filter(w => w.wearStart).length === 1"))

        # ── Historial del reloj: horas y tramo horario ──
        await page.evaluate("showView('history')")
        await page.evaluate("id => openHistWatch(id)", A); await page.wait_for_timeout(300)
        body = await page.text_content("#history-body")
        check("su historial muestra «En la muñeca: 3 h» y el tramo horario", 'En la muñeca' in body and '3 h' in body and '–' in body, body[:260])

        # ── Ranking: más tiempo en la caja y horas en la muñeca ──
        await page.evaluate("history.back()"); await page.wait_for_timeout(200)
        await page.click("#btn-mode-ranking"); await page.wait_for_timeout(300)
        rk = await page.text_content("#ranking-body")
        check("el ranking dice cuál lleva más tiempo en la caja (Seiko, 20 días, antes que el Steeldive)",
              'Más tiempo en la caja' in rk and rk.find('Presage') < rk.find('Tuna', rk.find('Más tiempo en la caja')), rk[-400:])
        check("y las horas en la muñeca", 'Horas en la muñeca' in rk and 'Trava' in rk.split('Horas en la muñeca')[1], rk[-300:])

        # ── «Sorpréndeme» ──
        await page.evaluate("getWatches().forEach(w => { if (w.wearStart) stopWearing(w.id); removeWearDay(w.id, Date.now()); }); showView('home'); renderHome()")
        await page.wait_for_timeout(200)
        before = await page.inner_text(".rec-watch")
        await page.click("#rec-dice"); await page.wait_for_timeout(150)
        lab = await page.text_content(".rec-label")
        after = await page.inner_text(".rec-watch")
        check("«Sorpréndeme» propone otro al azar", lab.strip() == 'Al azar' and after != before, f"{lab} {before} → {after}")
        await page.click("#rec-wear"); await page.wait_for_timeout(150)
        worn = await page.evaluate("getActiveWatch() && (getActiveWatch().brand + ' ' + getActiveWatch().model)")
        check("y «Ponérmelo» se pone ese", worn == after.strip(), f"{worn} / {after}")

        check("sin errores de JavaScript", not errs, errs[:3])
        await b.close()
    ok = sum(1 for _, c in results if c)
    print(f"--- {ok}/{len(results)} OK")
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
