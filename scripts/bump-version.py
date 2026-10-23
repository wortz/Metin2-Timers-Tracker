"""Muda o número de versão dos ficheiros JS no index.html (e refaz o mapa de módulos).

Correr antes de cada publicação (deploy):   python scripts/bump-version.py
Quem já tem a app aberta vê a faixa "Há uma nova versão" e quem a abre de novo recebe código fresco.
"""
import glob
import os
import re
import time

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
index = os.path.join(root, "index.html")
version = time.strftime("%Y%m%d%H%M")

modules = sorted(os.path.basename(f) for f in glob.glob(os.path.join(root, "js", "*.js")))
imports = ",\n      ".join(f'"./js/{m}": "./js/{m}?v={version}"' for m in modules)
importmap = '<script type="importmap">\n  {\n    "imports": {\n      ' + imports + "\n    }\n  }\n  </script>"

html = open(index, encoding="utf-8").read()
html, n1 = re.subn(r'<script type="importmap">.*?</script>', lambda m: importmap, html, flags=re.S)
html, n2 = re.subn(r'(<script type="module" src="js/main\.js\?v=)[A-Za-z0-9._-]+(")', lambda m: m.group(1) + version + m.group(2), html)
# O CSS também leva a versão, para o browser não ficar com uma cópia antiga.
html, n3 = re.subn(r'(<link rel="stylesheet" href="css/styles\.css)(\?v=[A-Za-z0-9._-]+)?(")', lambda m: m.group(1) + "?v=" + version + m.group(3), html)
assert n3 == 1, "index.html não tem a ligação ao css/styles.css"
assert n1 == 1 and n2 == 1, "index.html não tem o mapa de módulos / script principal esperados"
open(index, "w", encoding="utf-8").write(html)
print(f"Versão: {version} ({len(modules)} módulos)")
