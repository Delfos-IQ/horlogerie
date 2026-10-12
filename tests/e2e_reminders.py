"""
Avisos en el móvil (Rotor Pro): el plan en IndexedDB, el service worker real que muestra
las notificaciones, sin duplicados, y abrir la ficha desde un aviso.

Uso (con la app en :8080):  python3 tests/e2e_reminders.py
"""
import asyncio, json, os
from playwright.async_api import async_playwright

APP    = "http://localhost:8080/horlogerie/"
CHROME = os.environ.get("CHROME")
DAY    = 86400000
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('  ✓ ' if cond else '  ✗ ') + name + (f'  [{detail}]' if detail and not cond else ''))

RUN = """now => new Promise(res => {
  navigator.serviceWorker.addEventListener('message', function h(e) {
    if (e.data?.type === 'REMINDERS_DONE') { navigator.serviceWorker.removeEventListener('message', h); res(e.data.shown); } });
  navigator.serviceWorker.controller.postMessage({ type: 'RUN_REMINDERS', now });
})"""

async def main():
    print("\n=== Avisos en el móvil ===")
    async with async_playwright() as p:
        # New headless mode: the old headless shell always denies notifications
        b = await (p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch(channel='chromium'))
        ctx = await b.new_context(locale="es-ES", viewport={"width": 412, "height": 900}, bypass_csp=True)
        await ctx.grant_permissions(['notifications'], origin="http://localhost:8080")
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        await page.goto(APP)
        await page.wait_for_function("navigator.serviceWorker.ready.then(() => true)")
        if not await page.evaluate("!!navigator.serviceWorker.controller"):   # first visit: the SW controls the page after a reload
            await page.reload()
        await page.wait_for_function("typeof renderHome === 'function'")
        await page.wait_for_timeout(2200)

        ids = await page.evaluate(f"""async () => {{
          const q = await addWatch({{ brand: 'Casio', model: 'Duro', type: 'quartz' }});
          await updateWatch(q.id, {{ batteryChanged: Date.now() - 26 * 30 * {DAY} }});
          const a = await addWatch({{ brand: 'Seiko', model: 'Alpinist', type: 'automatic' }});
          await updateWatch(a.id, {{ lastService: Date.now() - 400 * {DAY} }});
          const c = await addWatch({{ brand: 'Orient', model: 'Bambino', type: 'automatic' }});
          return [q.id, a.id, c.id]; }}""")
        Q, A, C = ids

        # Without Pro: the switch opens Rotor Pro
        await page.evaluate("showView('settings')")
        await page.wait_for_timeout(300)
        await page.click("label[for='rem-toggle']")
        await page.wait_for_timeout(300)
        check("sin Pro: el interruptor de avisos abre Rotor Pro", await page.locator(".pro-sheet").count() == 1 and not await page.is_checked("#rem-toggle"))
        await page.keyboard.press("Escape")
        plan = await page.evaluate("rotor.reminders.kvGet('plan')")
        check("sin Pro no hay plan de avisos", not (plan or {}).get('items'))

        # With Pro
        await page.evaluate("localStorage.setItem('rotor_pro_v1', JSON.stringify({ active: true, verifiedAt: Date.now() })); location.reload()")
        await page.wait_for_function("typeof renderHome === 'function'")
        await page.wait_for_timeout(2200)
        await page.evaluate("showView('settings')")
        await page.wait_for_timeout(300)
        await page.click("label[for='rem-toggle']")
        await page.wait_for_timeout(800)
        check("con Pro: se activan los avisos", await page.is_checked("#rem-toggle"))
        plan = await page.evaluate("rotor.reminders.kvGet('plan')")
        kinds = sorted(i['kind'] for i in plan['items'])
        check("el plan tiene pila, revisión y olvidos (texto ya traducido)", kinds.count('battery') == 1 and kinds.count('service') == 1 and kinds.count('idle') == 3
              and any('pila' in i['body'] for i in plan['items']), str(kinds))
        check("el plan no lleva notas, precios ni fotos", all(set(i) <= {'key', 'dueAt', 'kind', 'watchId', 'title', 'body'} for i in plan['items']))

        # Today: only the battery is due (service in ~3.6 years, watches added today)
        shown = await page.evaluate(RUN, None)
        notes = await page.evaluate("navigator.serviceWorker.ready.then(r => r.getNotifications()).then(ns => ns.map(n => ({ title: n.title, body: n.body, url: n.data?.url })))")
        check("hoy solo avisa de la pila del Casio", shown == 1 and len(notes) == 1 and notes[0]['title'] == 'Casio Duro', f"{shown} " + json.dumps(notes, ensure_ascii=False))
        check("el aviso abre la ficha de ese reloj", notes and notes[0]['url'].endswith(f"#reloj={Q}"))
        again = await page.evaluate(RUN, None)
        check("no repite el mismo aviso", again == 0)

        # 40 days later: the three idle watches go in a single notification
        later = await page.evaluate(f"Date.now() + 40 * {DAY}")
        shown = await page.evaluate(RUN, later)
        notes = await page.evaluate("navigator.serviceWorker.ready.then(r => r.getNotifications({ tag: 'rotor-idle' })).then(ns => ns.map(n => n.body))")
        check("relojes olvidados: un solo aviso agrupado", shown == 1 and notes and notes[0].startswith('3 relojes'), f"{shown} {notes}")

        # A new battery: a new reminder 24 months later, not now
        await page.evaluate(f"id => updateWatch(id, {{ batteryChanged: Date.now() }})", Q)
        await page.wait_for_timeout(1200)
        shown = await page.evaluate(RUN, later)
        check("tras cambiar la pila no vuelve a avisar", shown == 0)

        # Opening from a notification
        await page.goto(APP + f"#reloj={A}")
        await page.wait_for_function("typeof renderHome === 'function'")
        await page.wait_for_timeout(2600)
        check("abrir desde un aviso lleva a Mantenimiento de ese reloj",
              await page.is_visible("#dt-maint") and 'Alpinist' in (await page.text_content("#d-name")))

        # Switching off empties the plan
        await page.evaluate("showView('settings')")
        await page.wait_for_timeout(300)
        await page.click("label[for='rem-toggle']")
        await page.wait_for_timeout(500)
        plan = await page.evaluate("rotor.reminders.kvGet('plan')")
        check("al desactivarlos el plan se vacía", not plan['items'])
        check("sin errores de JavaScript", not errs, errs[:3])
        await b.close()
    ok = sum(1 for _, c in results if c)
    print(f"--- {ok}/{len(results)} OK")
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
