"""
check-css.py — falla si app.css tiene clases que no usa ningún HTML ni JS.
Uso: python3 tools/check-css.py
"""
import glob, re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
css = (ROOT / 'css/app.css').read_text()
text = ''.join(p.read_text() for p in [ROOT / 'index.html', *map(pathlib.Path, glob.glob(str(ROOT / 'js/**/*.js'), recursive=True))]
               if 'vendor' not in str(p))
classes = set(re.findall(r'\.([a-zA-Z][\w-]*)', re.sub(r'url\([^)]*\)|\d+\.\d+', '', css)))
unused = sorted(c for c in classes if not re.search(r'(?<![\w-])' + re.escape(c) + r'(?![\w-])', text))
if unused:
    print('Clases CSS sin uso:', ' '.join(unused)); sys.exit(1)
print(f'✓ {len(classes)} clases CSS, todas en uso')
