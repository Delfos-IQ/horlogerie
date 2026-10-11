#!/usr/bin/env python3
"""
build-icons.py — genera un subconjunto de Tabler Icons con solo los iconos que usa la app.

Antes la app cargaba la fuente completa (~500 KB) desde jsDelivr con @latest: lenta, sin
versión fija y dependiente de un tercero. Este script:

  1. Busca las clases `ti-*` en index.html y js/ (sin js/vendor).
  2. Descarga @tabler/icons-webfont@<VERSION> de npm.
  3. Crea css/icons/tabler-icons-<hash>.woff2 con esos glifos, css/icons.css y actualiza
     la entrada de la fuente en la lista SHELL de sw.js (el hash cambia si cambian los iconos,
     así la caché del service worker nunca sirve una fuente vieja).

Requisitos: Python 3, npm y fontTools con brotli  (pip install fonttools brotli)
Uso:        python3 tools/build-icons.py
Ejecútalo cada vez que uses un icono nuevo: un icono que no esté en el subconjunto se ve en blanco.
"""
import hashlib, pathlib, re, subprocess, sys, tarfile, tempfile

VERSION = "3.47.0"
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "css" / "icons"
OUT_CSS = ROOT / "css" / "icons.css"


def used_icons():
    files = [ROOT / "index.html", *ROOT.glob("js/**/*.js")]
    files = [f for f in files if "vendor" not in f.parts]
    found = set()
    for f in files:
        found |= set(re.findall(r"\bti-[a-z0-9]+(?:-[a-z0-9]+)*", f.read_text(encoding="utf-8")))
    return found


def fetch_tabler(tmp: pathlib.Path):
    subprocess.run(["npm", "pack", "-q", f"@tabler/icons-webfont@{VERSION}"], cwd=tmp, check=True,
                   stdout=subprocess.DEVNULL)
    tgz = next(tmp.glob("tabler-icons-webfont-*.tgz"))
    with tarfile.open(tgz) as t:
        t.extractall(tmp, filter="data")
    return tmp / "package" / "dist"


def main():
    from fontTools import subset

    icons = used_icons()
    with tempfile.TemporaryDirectory() as d:
        dist = fetch_tabler(pathlib.Path(d))
        css = (dist / "tabler-icons.css").read_text(encoding="utf-8")
        codepoints = dict(re.findall(r"\.(ti-[a-z0-9-]+):before\s*\{\s*content:\s*\"\\([0-9a-f]+)\"", css))
        known = {i: codepoints[i] for i in sorted(icons) if i in codepoints}
        unknown = sorted(i for i in icons if i not in codepoints)

        OUT_DIR.mkdir(parents=True, exist_ok=True)
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = []
        opts.name_IDs = ["*"]
        font = subset.load_font(str(dist / "fonts" / "tabler-icons.ttf"), opts)
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=[int(cp, 16) for cp in known.values()])
        sub.subset(font)
        tmp_out = OUT_DIR / "_subset.woff2"
        subset.save_font(font, str(tmp_out), opts)
        digest = hashlib.sha256(tmp_out.read_bytes()).hexdigest()[:8]
        fname = f"tabler-icons-{digest}.woff2"
        for old in OUT_DIR.glob("tabler-icons-*.woff2"):
            old.unlink()
        tmp_out.rename(OUT_DIR / fname)

    rules = "\n".join(f'.{name}:before {{ content: "\\{cp}"; }}' for name, cp in known.items())
    OUT_CSS.write_text(f"""/*!
 * Tabler Icons {VERSION} — subconjunto generado por tools/build-icons.py ({len(known)} iconos)
 * License (MIT): https://github.com/tabler/tabler-icons/blob/main/LICENSE
 * No editar a mano: vuelve a ejecutar el script.
 */
@font-face {{
  font-family: "tabler-icons";
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url("./icons/{fname}") format("woff2");
}}
.ti {{
  font-family: "tabler-icons" !important;
  speak: none;
  font-style: normal;
  font-weight: normal;
  font-variant: normal;
  text-transform: none;
  line-height: 1;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}}
{rules}
""", encoding="utf-8")
    sw = ROOT / "sw.js"
    sw_src = sw.read_text(encoding="utf-8")
    sw_new, n = re.subn(r"`\$\{BASE\}/css/icons/tabler-icons-[^`]*`", f"`${{BASE}}/css/icons/{fname}`", sw_src)
    if n != 1:
        print("  ⚠ No encuentro la entrada de la fuente de iconos en sw.js; añádela a SHELL a mano.")
    sw.write_text(sw_new, encoding="utf-8")
    size = (OUT_DIR / fname).stat().st_size
    print(f"✓ {len(known)} iconos · {size / 1024:.1f} KB → css/icons/{fname} (sw.js actualizado)")
    if unknown:
        print("  Clases ti-* que no existen en Tabler (revisa el nombre):", ", ".join(unknown))


if __name__ == "__main__":
    sys.exit(main())
