"""
build-brand.py — genera los iconos PNG y el favicon a partir de brand/rotor-icon.svg.

Uso: python3 tools/build-brand.py      (requiere playwright y Pillow)
"""
import asyncio, io, os, pathlib
from playwright.async_api import async_playwright
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SVG = (ROOT / "brand" / "rotor-icon.svg").read_text(encoding="utf-8")
SIZES = {
    "icon-512.png": 512, "icon-192.png": 192,
    "icon-maskable-512.png": 512, "icon-maskable-192.png": 192,   # mismo arte: ya respeta la zona segura
    "apple-touch-icon.png": 180, "favicon-32x32.png": 32, "favicon-16x16.png": 16,
}

async def main():
    async with async_playwright() as p:
        exe = os.environ.get("CHROME")
        b = await (p.chromium.launch(executable_path=exe) if exe else p.chromium.launch())
        pg = await b.new_page(viewport={"width": 512, "height": 512})
        await pg.set_content(f"<html><body style='margin:0'>{SVG.replace('<svg ', '<svg width=\"512\" height=\"512\" ', 1)}</body></html>")
        master = Image.open(io.BytesIO(await pg.screenshot(clip={"x": 0, "y": 0, "width": 512, "height": 512}))).convert("RGB")
        await b.close()
    for name, size in SIZES.items():
        master.resize((size, size), Image.LANCZOS).save(ROOT / "icons" / name, "PNG", optimize=True)
    master.save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("✓ iconos y favicon generados desde brand/rotor-icon.svg")

asyncio.run(main())
