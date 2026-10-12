"""
play-screenshots.py — genera las capturas de la ficha de Google Play (1080×1920) y el
gráfico destacado (1024×500) con una colección de ejemplo ficticia, en español, inglés
y portugués.

Uso (con la app servida en http://localhost:8080/horlogerie/):
  python3 tools/play-screenshots.py              → los tres idiomas, tema claro (el de Play)
  LANGS=en THEME=dark OUT=/ruta python3 tools/play-screenshots.py   → un idioma, tema oscuro
Salida: docs/play/capturas/<idioma>/
"""
import asyncio, os, pathlib
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_BASE = pathlib.Path(os.environ["OUT"]) if os.environ.get("OUT") else ROOT / "docs" / "play" / "capturas"
LANGS = os.environ.get("LANGS", "es,en,pt").split(",")
LOCALES = {"es": "es-ES", "en": "en-GB", "pt": "pt-PT"}
# Spec values of the demo watches, per language
SPECS = {
  "es": {"cristal": "Zafiro", "caja": "Acero 316L", "acrylic": "Acrílico", "note": "Limpieza, aceites y juntas"},
  "en": {"cristal": "Sapphire", "caja": "316L steel", "acrylic": "Acrylic", "note": "Clean, oil and new gaskets"},
  "pt": {"cristal": "Safira", "caja": "Aço 316L", "acrylic": "Acrílico", "note": "Limpeza, óleos e juntas"},
}
GRAPHIC = {
  "es": ("Qué reloj te pusiste, cuál toca hoy y cuánto te cuesta cada uso.", "Rotación de relojes · Sin cuentas · Sin conexión"),
  "en": ("Which watch you wore, which one is due today and what each wear costs.", "Watch rotation · No login · Works offline"),
  "pt": ("Que relógio usaste, qual usar hoje e quanto custa cada uso.", "Rotação de relógios · Sem contas · Sem ligação"),
}
THEME = os.environ.get("THEME", "light")
APP = "http://localhost:8080/horlogerie/"
CHROME = os.environ.get("CHROME")
DAY = 86400000

DEMO = """async (S) => {
  // Esferas dibujadas (marcas de ejemplo; ninguna marca real de terceros en la imagen)
  function dial(bg, accent, hands = '#e8e2d8') {
    const c = document.createElement('canvas'); c.width = c.height = 600;
    const g = c.getContext('2d');
    g.fillStyle = '#E9E3D6'; g.fillRect(0, 0, 600, 600);
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
      specs: { calibre: 'Seiko NH35', cristal: S.cristal, resistencia: '200 m', diametro: '44 mm', caja: S.caja, reserva: '41 h', asas: '22 mm' },
      serial: 'SD-0457', currentValue: 155, lastService: now - 200 * D });
  const b = await add('Seagull', '1963 Chronograph', 'manual', ['#f1ece0', '#cfc6b2'], '#b3261e',
    { purchasePrice: 229, purchaseDate: now - 2200 * D, specs: { calibre: 'ST1901', cristal: S.acrylic, diametro: '38 mm' }, currentValue: 260 });
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
  // Rotor Pro data: service, accuracy and straps
  addServiceEntry(a, { date: now - 200 * D, kind: 'service', cost: 65, note: S.note });
  addServiceEntry(d, { date: now - 800 * D, kind: 'battery', cost: 12 });
  addAccuracyReading(a, { ts: now - 9 * D, offset: 0 });
  addAccuracyReading(a, { ts: now - 5 * D, offset: 22 });
  addAccuracyReading(a, { ts: now - 1 * D, offset: 41 });
  addStrap(a, { name: 'Steel', width: '22 mm' });
  return { a, b, c, d, e, f };
}"""

async def capture(b, lang):
    OUT = OUT_BASE / lang if len(LANGS) > 1 or not os.environ.get("OUT") else OUT_BASE
    OUT.mkdir(parents=True, exist_ok=True)
    # 412×732 CSS px × 2.625 = 1081×1921 → recortamos a 1080×1920
    ctx = await b.new_context(locale=LOCALES[lang], viewport={"width": 411, "height": 731}, device_scale_factor=2.6277,
                              service_workers="block", color_scheme=THEME)
    await ctx.grant_permissions(["notifications"], origin="http://localhost:8080")
    await ctx.add_init_script("localStorage.setItem('rotor_pro_v1', JSON.stringify({ active: true, verifiedAt: Date.now() }));"
                              "localStorage.setItem('rotor_prefs_v1', JSON.stringify({ lang: '%s', onboarded: true }));" % lang)
    page = await ctx.new_page()
    await page.goto(APP)
    await page.wait_for_function("typeof wearStats === 'function'")
    await page.wait_for_timeout(2300)
    ids = await page.evaluate(DEMO, SPECS[lang])
    await page.evaluate("document.getElementById('intro')?.remove(); showView('home')")
    await page.wait_for_timeout(400)
    shots = []
    async def shot(name):
        path = OUT / f"{name}.png"
        await page.screenshot(path=str(path), clip={"x": 0, "y": 0, "width": 411, "height": 730.7})
        shots.append(path.name)
    await shot("1-coleccion")
    await page.click("#today-change"); await page.wait_for_timeout(400)
    await shot("2-hoy-llevo")
    await page.keyboard.press("Escape"); await page.wait_for_timeout(300)
    await page.evaluate("id => openDetail(id, 'summary')", ids["a"]); await page.wait_for_timeout(300)
    await page.evaluate("document.getElementById('view-detail').scrollTop = 170")
    await page.wait_for_timeout(200)
    await shot("3-ficha")
    await page.evaluate("id => openDetail(id, 'maint')", ids["a"]); await page.wait_for_timeout(300)
    await page.evaluate("document.getElementById('d-care').scrollIntoView({ block: 'start' }); document.getElementById('view-detail').scrollTop -= 60")
    await page.wait_for_timeout(200)
    await shot("4-mantenimiento-pro")
    await page.evaluate("showView('history'); setHistoryMode('calendar')"); await page.wait_for_timeout(300)
    await shot("5-historial")
    await page.evaluate("showView('history'); setHistoryMode('value', true)"); await page.wait_for_timeout(300)
    await shot("6-valor-pro")
    await page.evaluate("showView('settings')"); await page.wait_for_timeout(400)
    await page.evaluate("document.querySelector('.cloud-card').scrollIntoView({block: 'start'})")
    await page.evaluate("document.getElementById('view-settings').scrollTop -= 40")
    await page.wait_for_timeout(200)
    await shot("7-nube")
    await ctx.close()

    # Gráfico destacado 1024×500 (solo con el tema claro)
    if THEME == "light":
        fg = await b.new_page(viewport={"width": 1024, "height": 500})
        tmp = ROOT / "docs" / "play" / "_grafico.html"
        line, small = GRAPHIC[lang]
        tmp.write_text(f"""<html><head><meta charset="utf-8"><link rel="stylesheet" href="../../css/fonts.css"><style>
          body{{margin:0;width:1024px;height:500px;background:radial-gradient(circle at 30% 40%,#FBF8F1,#E8E1D2 75%);
               display:flex;align-items:center;gap:56px;padding:0 72px;box-sizing:border-box;color:#1E1B16;font-family:'Jost',sans-serif}}
          img{{width:250px;height:250px;border-radius:56px;box-shadow:0 20px 50px rgba(30,27,22,.25)}}
          h1{{font-family:'Bodoni Moda',serif;font-weight:400;font-size:88px;letter-spacing:8px;margin:0;color:#7E6118}}
          p{{font-size:30px;line-height:1.35;margin:14px 0 0;max-width:560px}}
          small{{display:block;margin-top:22px;font-size:20px;color:#655D51;letter-spacing:1px}}
        </style></head><body><img src="../../icons/icon-512.png"><div><h1>Rotor</h1>
          <p>{line}</p><small>{small}</small></div></body></html>""", encoding="utf-8")
        await fg.goto("http://localhost:8080/horlogerie/docs/play/_grafico.html")
        await fg.evaluate("document.fonts.ready")
        await fg.wait_for_timeout(400)
        await fg.screenshot(path=str(OUT / "grafico-destacado-1024x500.png"))
        tmp.unlink()
        await fg.close()
        shots.append("grafico-destacado-1024x500.png")
    print("✓", lang, ", ".join(shots), "→", OUT)


async def main():
    async with async_playwright() as p:
        # New headless mode: notifications can be granted (the old headless shell always denies them)
        b = await (p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch(channel="chromium"))
        for lang in LANGS:
            await capture(b, lang)
        await b.close()

asyncio.run(main())
