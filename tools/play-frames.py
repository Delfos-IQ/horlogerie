"""
play-frames.py — capturas de Google Play «enmarcadas»: la pantalla real dentro de un móvil,
con una frase arriba, en 1080×1920 (9:16, lo que pide Play). Parte de las capturas
de docs/play/capturas/<idioma>/ (tools/play-screenshots.py) y no inventa nada: la
imagen del móvil es la app tal cual.

Uso (con la app servida en http://localhost:8080/horlogerie/):
  python3 tools/play-frames.py
Salida: docs/play/capturas-marco/<idioma>/<n>-<nombre>.png
"""
import asyncio, pathlib
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "play" / "capturas"
OUT = ROOT / "docs" / "play" / "capturas-marco"
BASE = "http://localhost:8080/horlogerie/"

# Orden de la ficha: lo que hace la app primero, Pro y la nube al final
SHOTS = ["1-coleccion", "2-hoy-llevo", "3-ficha", "8-ranking", "5-historial", "4-mantenimiento-pro", "6-valor-pro", "7-nube"]
TEXT = {
  "es": {
    "1-coleccion": ("Tu colección", "de un vistazo"),
    "2-hoy-llevo": ("¿Qué reloj llevas hoy?", "Un toque y queda apuntado"),
    "3-ficha": ("Cada reloj,", "con su ficha técnica"),
    "8-ranking": ("¿Cuál lleva más tiempo", "en la caja?"),
    "5-historial": ("Tu historial", "día a día"),
    "4-mantenimiento-pro": ("Revisiones y pilas", "sin olvidos"),
    "6-valor-pro": ("Cuánto vale", "tu colección"),
    "7-nube": ("Sin cuentas", "y con copia cifrada"),
  },
  "en": {
    "1-coleccion": ("Your collection", "at a glance"),
    "2-hoy-llevo": ("What are you wearing today?", "One tap and it's logged"),
    "3-ficha": ("Every watch,", "with its spec sheet"),
    "8-ranking": ("Which one has spent", "longest in the box?"),
    "5-historial": ("Your history,", "day by day"),
    "4-mantenimiento-pro": ("Services and batteries,", "never forgotten"),
    "6-valor-pro": ("What your collection", "is worth"),
    "7-nube": ("No accounts,", "encrypted backup"),
  },
  "pt": {
    "1-coleccion": ("A tua coleção", "num relance"),
    "2-hoy-llevo": ("Que relógio usas hoje?", "Um toque e fica registado"),
    "3-ficha": ("Cada relógio,", "com a sua ficha técnica"),
    "8-ranking": ("Qual está há mais tempo", "na caixa?"),
    "5-historial": ("O teu histórico,", "dia a dia"),
    "4-mantenimiento-pro": ("Revisões e pilhas", "sem esquecimentos"),
    "6-valor-pro": ("Quanto vale", "a tua coleção"),
    "7-nube": ("Sem contas,", "com cópia cifrada"),
  },
}

PAGE = """<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="{base}css/fonts.css"><style>
html,body{{margin:0;width:1080px;height:1920px;overflow:hidden}}
body{{background:radial-gradient(120% 70% at 50% 0%,#FBF8F1 0%,#F3EEE3 45%,#E6DDCB 100%);font-family:'Jost',sans-serif;color:#1E1B16;
  display:flex;flex-direction:column;align-items:center}}
.cap{{margin-top:150px;text-align:center}}
h1{{font-family:'Bodoni Moda',serif;font-weight:400;font-size:84px;line-height:1.05;margin:0;color:#1E1B16;letter-spacing:.5px}}
h2{{font-weight:400;font-size:52px;line-height:1.2;margin:14px 0 0;color:#7E6118}}
.phone{{margin-top:96px;width:780px;height:1351px;border-radius:104px;background:#1B1A18;padding:22px;box-sizing:border-box;
  box-shadow:0 40px 90px rgba(30,27,22,.28),0 0 0 3px #3A3732 inset,0 0 0 2px #0E0D0C}}
.screen{{width:100%;height:100%;border-radius:84px;overflow:hidden;position:relative;background:#F3EEE3}}
.screen img{{width:100%;display:block}}
.cam{{position:absolute;top:22px;left:50%;width:26px;height:26px;margin-left:-13px;border-radius:50%;background:#0E0D0C;box-shadow:0 0 0 4px #1B1A18}}
.pro{{position:absolute;top:44px;right:56px;font:500 26px 'Jost',sans-serif;letter-spacing:3px;color:#FBF8F1;background:#7E6118;padding:8px 18px;border-radius:999px}}
</style></head><body>
<div class="cap"><h1>{t1}</h1><h2>{t2}</h2></div>
<div class="phone"><div class="screen"><img src="{img}"><div class="cam"></div></div></div>
{pro}
</body></html>"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        page = await b.new_page(viewport={"width": 1080, "height": 1920})
        for lang, texts in TEXT.items():
            (OUT / lang).mkdir(parents=True, exist_ok=True)
            for i, name in enumerate(SHOTS, 1):
                t1, t2 = texts[name]
                html = PAGE.format(base=BASE, t1=t1, t2=t2, img=f"{BASE}docs/play/capturas/{lang}/{name}.png",
                                   pro='<div class="pro">PRO</div>' if name.endswith('-pro') else '')
                tmp = ROOT / "docs" / "play" / "_marco.html"
                tmp.write_text(html, encoding="utf-8")
                await page.goto(f"{BASE}docs/play/_marco.html?{lang}-{i}")
                await page.evaluate("document.fonts.ready")
                await page.wait_for_function("[...document.images].every(i => i.complete && i.naturalWidth)")
                await page.wait_for_timeout(150)
                await page.screenshot(path=str(OUT / lang / f"{i}-{name}.png"))
            print("✓", lang, len(SHOTS), "→", OUT / lang)
        tmp.unlink()
        await b.close()

asyncio.run(main())
