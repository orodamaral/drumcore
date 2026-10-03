# Embute o ConfigTool (build do web-app, ../web-app/dist) no firmware, pra
# placa servir o app pelo Wi-Fi (Fase AE, ver docs/08-wifi.md).
#
# Gera include/webapp_files.h (nao versionado) com cada arquivo ja
# compactado em gzip + uma tabela caminho/tipo/dados. Deixa de fora os
# pedacos do gravador de firmware (esptool: esp32*.js, stub_flasher*,
# imagens) - gravar firmware pelo Wi-Fi nao existe nesta fase, e a aba
# Firmware fica escondida quando o app roda a partir da placa.
#
# No index.html entra <meta name="drumcore-hosted"> - e' assim que o app
# sabe que foi aberto a partir da placa (conecta por WebSocket em vez de
# Web Serial, ver web-app/src/hosted.ts).
#
# Sem web-app/dist (ex: build so' do firmware, sem Node), gera uma pagina
# simples avisando que o ConfigTool nao veio nesse build - o firmware
# compila do mesmo jeito. Pra embutir: cd web-app && npm run build, e
# depois compilar o firmware.

Import("env")
import gzip
import os
import re

project_dir = env.subst("$PROJECT_DIR")
dist = os.path.normpath(os.path.join(project_dir, "..", "web-app", "dist"))
out_path = os.path.join(project_dir, "include", "webapp_files.h")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".webmanifest": "application/manifest+json",
}
SKIP = re.compile(r"^(esp32|stub_flasher)|\.png$")

FALLBACK = b"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>DrumCore</title></head>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:60px auto;padding:0 16px">
<h1>DrumCore</h1><p>Este firmware foi compilado sem o ConfigTool embutido.
Use o ConfigTool pelo USB em <a href="https://orodamaral.github.io/drumcore/app/">orodamaral.github.io/drumcore/app</a>.</p>
</body></html>"""


def collect():
    files = []
    if not os.path.isfile(os.path.join(dist, "index.html")):
        print("embed_webapp: web-app/dist nao encontrado - firmware SEM o ConfigTool embutido")
        return [("/index.html", MIME[".html"], FALLBACK)]
    for root, _, names in os.walk(dist):
        for name in sorted(names):
            if SKIP.search(name):
                continue
            path = os.path.join(root, name)
            rel = "/" + os.path.relpath(path, dist).replace(os.sep, "/")
            ext = os.path.splitext(name)[1].lower()
            with open(path, "rb") as f:
                data = f.read()
            if rel == "/index.html":
                data = data.replace(b"<head>", b'<head>\n    <meta name="drumcore-hosted" content="1">', 1)
            files.append((rel, MIME.get(ext, "application/octet-stream"), data))
    return files


def render(files):
    lines = [
        "// GERADO por firmware/embed_webapp.py - nao editar, nao versionar.",
        "#pragma once",
        "#include <Arduino.h>",
        "",
        "struct WebAppFile",
        "{",
        "    const char *path;",
        "    const char *mime;",
        "    const uint8_t *data; // gzip",
        "    size_t len;",
        "};",
        "",
    ]
    total = 0
    for i, (_, _, data) in enumerate(files):
        gz = gzip.compress(data, compresslevel=9, mtime=0)
        total += len(gz)
        body = ",".join(str(b) for b in gz)
        lines.append(f"static const uint8_t WEBAPP_F{i}[] PROGMEM = {{{body}}};")
        files[i] = files[i] + (len(gz),)
    lines.append("")
    lines.append("static const WebAppFile WEBAPP_FILES[] = {")
    for i, (rel, mime, _, n) in enumerate(files):
        lines.append(f'    {{"{rel}", "{mime}", WEBAPP_F{i}, {n}}},')
    lines.append("};")
    lines.append(f"static const size_t WEBAPP_FILE_COUNT = {len(files)};")
    lines.append("")
    return "\n".join(lines), total


files = collect()
text, total = render(files)
os.makedirs(os.path.dirname(out_path), exist_ok=True)
old = None
if os.path.isfile(out_path):
    with open(out_path, encoding="utf-8") as f:
        old = f.read()
if old != text:  # so' reescreve se mudou - evita recompilar a toa
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(text)
print(f"embed_webapp: {len(files)} arquivo(s), {total / 1024:.0f} kB em gzip")
