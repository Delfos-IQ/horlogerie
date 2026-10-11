"""
play-screenshots.py — genera las capturas de la ficha de Google Play (1080×1920) y el
gráfico destacado (1024×500) con una colección de ejemplo ficticia.

Uso (con la app servida en http://localhost:8080/horlogerie/):
  python3 tools/play-screenshots.py
Salida: docs/play/capturas/
"""
import asyncio, os, pathlib
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "play" / "capturas"
APP = "http://localhost:8080/horlogerie/"
CHROME = os.environ.get("CHROME")
DAY = 86400000

DEMO = """async () => {
  // Esferas dibujadas (marcas de ejemplo; ninguna marca real de terceros en la imagen)
  function dial(bg, accent, hands = '#e8e2d8') {
    const c = document.createElement('canvas'); c.width = c.height = 600;
    const g = c.getContext('2d');
    g.fillStyle = '#121212'; g.fillRect(0, 0, 600, 600);
    g.fillStyle = '#3a3a3a'; g.beginPath(); g.arc(300, 300, 250, 0, 7); g.fill();
    const grad = g.createRadialGradient(260, 240, 30, 300, 300, 230);
    grad.addColorStop(0, bg[0]); grad.addColorStop(1, bg[1]);
    g.fillStyle = grad; g.beginPath(); g.arc(300, 300, 228, 0, 7); g.fill();
    g.strokeStyle = accent; g.lineWidth = 10;
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6;
      g.beginPath(); g.moveTo(300 + 190 * Math.sin(a), 300 - 190 * Math.cos(a));
      g.lineTo(300 + (i % 3 ? 205 : 215) * Math.sin(a), 300 - (i % 3 ? 205 : 215) * Math.cos(a)); g.stroke(); }
    g.lineCap = 'round'; g.strokeStyle = hands;
    g.lineWidth = 14; g.beginPath(); g.moveTo(300, 300); g.lineTo(300 + 110 * Math.sin(5.2), 300 - 110 * Math.cos(5.2)); g.stroke();
    g.lineWidth = 9;  g.beginPath(); g.moveTo(300, 300); g.lineTo(300 + 170 * Math.sin(1.1), 300 - 170 * Math.cos(1.1)); g.stroke();
    g.strokeStyle = accent; g.lineWidth = 3; g.beginPath(); g.moveTo(300, 330); g.lineTo(300 + 185 * Math.sin(2.6), 300 - 185 * Math.cos(2.6)); g.stroke();
    g.fillStyle = accent; g.beginPath(); g.arc(300, 300, 10, 0, 7); g.fill();
    return c.toDataURL('image/jpeg', .9);
  }
  const now = Date.now(), D = 86400000;
  const add = async (brand, model, type, bg, accent, extra = {}) => {
    const w = await addWatch({ brand, model, type, photo: dial(bg, accent) });
    await updateWatch(w.id, extra);
    return w.id;
  };
  const a = await add('Steeldive', 'SD1975S Tuna', 'automatic', ['#1f4a6e', '#0b1c2c'], '#f2a33a',
    { purchasePrice: 139, purchaseDate: now - 400 * D, favorite: true,
      specs: { calibre: 'Seiko NH35', cristal: 'Zafiro', resistencia: '200 m', diametro: '44 mm', caja: 'Acero 316L', reserva: '41 h' } });
  const b = await add('Seagull', '1963 Chronograph', 'manual', ['#f1ece0', '#cfc6b2'], '#b3261e',
    { purchasePrice: 229, purchaseDate: now - 2200 * D, specs: { calibre: 'ST1901', cristal: 'Acrílico', diametro: '38 mm' } });
  const c = await add('San Martin', 'Field SN0105', 'automatic', ['#2f3a2a', '#141a12'], '#e8e2d8',
    { purchasePrice: 175, purchaseDate: now - 300 * D });
  const d = await add('Casio', 'Duro MDV-106', 'quartz', ['#1d1d1d', '#050505'], '#c9c9c9',
    { purchasePrice: 59, batteryChanged: now - 800 * D });
  const e = await add('Pagani Design', 'GMT', 'automatic', ['#2b1e4f', '#120b24'], '#e04a4a', { purchasePrice: 89 });
  const f = await add('Cadisen', 'Classic', 'automatic', ['#e9e4d6', '#bdb5a0'], '#2a4c8f', { purchasePrice: 99, rotation: false });
  // Historial plausible de los últimos meses
  const plan = [[a, [1, 2, 3, 9, 10, 16, 17, 24, 30, 31, 38, 45]], [b, [5, 6, 20, 41]], [c, [4, 12, 13, 26, 27, 33]],
                [d, [7, 8, 14, 21, 22, 35]], [e, [11, 19, 40]]];
  for (const [id, days] of plan) for (const k of days) addWearDays(id, now - k * D);
  return { a, b, c, d, e, f };
}"""

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch())
        # 412×732 CSS px × 2.625 = 1081×1921 → recortamos a 1080×1920
        ctx = await b.new_context(viewport={"width": 411, "height": 731}, device_scale_factor=2.6277,
                                  service_workers="block")
        page = await ctx.new_page()
        await page.goto(APP)
        await page.wait_for_function("typeof wearStats === 'function'")
        await page.wait_for_timeout(2300)
        ids = await page.evaluate(DEMO)
        await page.evaluate("document.getElementById('intro')?.remove(); showView('home')")
        await page.wait_for_timeout(400)
        shots = []
        async def shot(name):
            path = OUT / f"{name}.png"
            await page.screenshot(path=str(path), clip={"x": 0, "y": 0, "width": 411, "height": 730.7})
            shots.append(path.name)
        await shot("1-coleccion")
        await page.evaluate("id => openDetail(id)", ids["a"]); await page.wait_for_timeout(300)
        await page.evaluate("document.querySelector('.detail-body').scrollIntoView()")
        await page.evaluate("document.getElementById('view-detail').scrollTop = 150")
        await page.wait_for_timeout(200)
        await shot("2-ficha")
        await page.evaluate("showView('history'); setHistoryMode('ranking')"); await page.wait_for_timeout(300)
        await shot("3-historial")
        await page.evaluate(f"showView('history'); setHistoryMode('detail'); historySelectedWatch = '{ids['a']}'; historySelectedYear = null; renderHistoryDetail()")
        await page.wait_for_timeout(300)
        await shot("4-usos")
        await page.evaluate("showView('settings')"); await page.wait_for_timeout(300)
        await page.evaluate("document.querySelector('.cloud-card').scrollIntoView({block: 'start'})")
        await page.evaluate("document.getElementById('view-settings').scrollTop -= 40")
        await page.wait_for_timeout(200)
        await shot("5-nube")

        # Gráfico destacado 1024×500
        fg = await b.new_page(viewport={"width": 1024, "height": 500})
        tmp = ROOT / "docs" / "play" / "_grafico.html"
        tmp.write_text(f"""<html><head><meta charset="utf-8"><link rel="stylesheet" href="../../css/fonts.css"><style>
          body{{margin:0;width:1024px;height:500px;background:radial-gradient(circle at 30% 40%,#2a2418,#0D0D0D 70%);
               display:flex;align-items:center;gap:56px;padding:0 72px;box-sizing:border-box;color:#E8E2D8;font-family:'DM Sans',sans-serif}}
          img{{width:250px;height:250px;border-radius:56px;box-shadow:0 20px 60px rgba(0,0,0,.6)}}
          h1{{font-family:'Cormorant Garamond',serif;font-weight:300;font-size:92px;letter-spacing:10px;margin:0;color:#D4AF6A}}
          p{{font-size:30px;line-height:1.35;margin:14px 0 0;max-width:560px}}
          small{{display:block;margin-top:22px;font-size:20px;color:#9a958c;letter-spacing:1px}}
        </style></head><body><img src="../../icons/icon-512.png"><div><h1>Rotor</h1>
          <p>Qué reloj te pusiste, cuál toca hoy y cuánto te cuesta cada uso.</p>
          <small>Rotación de relojes · Sin cuentas · Sin conexión</small></div></body></html>""", encoding="utf-8")
        await fg.goto("http://localhost:8080/horlogerie/docs/play/_grafico.html")
        await fg.evaluate("document.fonts.ready")
        await fg.wait_for_timeout(400)
        await fg.screenshot(path=str(OUT / "grafico-destacado-1024x500.png"))
        tmp.unlink()
        await b.close()
    print("✓", ", ".join(shots), "+ grafico-destacado-1024x500.png →", OUT.relative_to(ROOT))

asyncio.run(main())
