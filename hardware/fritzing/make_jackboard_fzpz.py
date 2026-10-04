#!/usr/bin/env python3
"""
Gera a peca do Fritzing da jackboard single-layer (DrumCore_Jackboard.fzpz).

Uso:  python hardware/fritzing/make_jackboard_fzpz.py
Saida: hardware/fritzing/DrumCore_Jackboard.fzpz (+ os arquivos soltos em
       hardware/fritzing/part/, pra conferir/editar).

As medidas vem do projeto KiCad hardware/jackboard_singlelayer/ (lidas do
.kicad_pcb e da netlist, sem editar nada - 2026-10-04). Se a placa mudar,
atualizar as constantes abaixo:
  - contorno (Edge.Cuts): x 55.1375-239.1375, y 69.2-126.7 mm (184 x 57,5)
  - jacks J1..J8: origem em x = 234.2075 - 22.5*(n-1), y = 110.05, rot -90;
    pads T (origem), R (+6.35 em y), S (+12.7), TN/RN/SN (-16.23 em x);
    corpo (F.Fab) de x-18.3 a x+0.98, y-6.83 a y+19.7 (passa 3 mm da borda)
  - U2 (controle do MUX, barra 1x8): pino 1 em (156.0275, 74.2), passo -2.54
    em x. Pinos: 1 GND, 2 +3V3, 3 GND (= EN do modulo), 4 S0, 5 S1, 6 S2,
    7 S3, 8 SIG
  - U1 (canais do MUX, barra 1x16): pino 1 em (166.1875, 89.44), passo -2.54
  - J(n) tip = canal 2(n-1), ring = canal 2(n-1)+1 (MUX_C0_RAW...)

Conectores da peca: os 8 pinos de controle (fios pro ESP32) e tip/ring dos
8 jacks (pra ligar os pads no diagrama). Os pads de GND dos jacks aparecem
na vista PCB so' como cobre.
"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "part")
FZPZ = os.path.join(HERE, "DrumCore_Jackboard.fzpz")
NAME = "drumcore_jackboard"
# Fixo: mudar o moduleId faz o Fritzing tratar como outra peca.
MODULE_ID = "DrumCore_Jackboard_SingleLayer_v1_5e1c2a7e"

# ------------------------------------------------------------ geometria (mm, KiCad)
BX0, BY0, BX1, BY1 = 55.1375, 69.2, 239.1375, 126.7
BW, BH = BX1 - BX0, BY1 - BY0
JACK_Y = 110.05
JACK_BOTTOM = JACK_Y + 19.7  # bico do jack, fora da borda
H_TOTAL = JACK_BOTTOM - BY0  # altura com os jacks


def jack_x(n):  # n = 1..8
    return 234.2075 - 22.5 * (n - 1)


CTRL_X1, CTRL_Y, PITCH = 156.0275, 74.2, 2.54
CTRL = ["GND", "VCC", "EN", "S0", "S1", "S2", "S3", "SIG"]
CTRL_DESC = {
    "GND": "GND",
    "VCC": "Alimentacao 3,3 V (VCC do MUX e grampo dos diodos)",
    "EN": "EN do MUX - ja ligado ao GND na placa",
    "S0": "Selecao de canal S0 (ESP32 GPIO39)",
    "S1": "Selecao de canal S1 (ESP32 GPIO40)",
    "S2": "Selecao de canal S2 (ESP32 GPIO41)",
    "S3": "Selecao de canal S3 (ESP32 GPIO42)",
    "SIG": "Saida analogica do MUX (placa A: GPIO2, placa B: GPIO1)",
}
CH_X1, CH_Y = 166.1875, 89.44


def ctrl_x(i):  # i = 0..7
    return CTRL_X1 - PITCH * i


def bx(x):  # KiCad -> coordenada da peca
    return round(x - BX0, 3)


def by(y):
    return round(y - BY0, 3)


# Conectores: 0-7 controle, 8.. = J1 tip, J1 ring, J2 tip...
CONNECTORS = []
for i, n in enumerate(CTRL):
    CONNECTORS.append({"id": f"connector{i}", "name": n, "desc": CTRL_DESC[n]})
for j in range(1, 9):
    for k, (lab, dy) in enumerate((("tip", 0.0), ("ring", 6.35))):
        ch = 2 * (j - 1) + k
        CONNECTORS.append(
            {
                "id": f"connector{8 + 2 * (j - 1) + k}",
                "name": f"J{j} {lab}",
                "desc": f"Jack {j}, {lab} = canal {ch} do MUX (pad {ch + 1} no ConfigTool)",
                "jack": j,
                "dy": dy,
            }
        )

FONT = "font-family=\"'Droid Sans', Arial, sans-serif\""


# ------------------------------------------------------------ breadboard
def breadboard_svg():
    w, h = round(BW, 3), round(H_TOTAL, 3)
    o = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}mm" height="{h}mm" viewBox="0 0 {w} {h}">',
        '<g id="breadboard">',
        # placa (fenolite cobreada)
        f'<rect x="0" y="0" width="{w}" height="{round(BH, 3)}" rx="1" fill="#c9773b" stroke="#8a4a1f" stroke-width="0.3"/>',
        f'<text x="6" y="9" {FONT} font-size="4" font-weight="bold" fill="#5a2c0c">DRUMCORE JACKBOARD</text>',
        f'<text x="6" y="14" {FONT} font-size="2.6" fill="#5a2c0c">16 canais - 8 jacks TRS 6,35 mm</text>',
    ]
    # jacks
    for j in range(1, 9):
        x0 = bx(jack_x(j) - 18.3)
        y0 = by(JACK_Y - 6.83)
        jw, jh = 19.3, 26.53
        o.append(f'<rect x="{x0}" y="{y0}" width="{jw}" height="{jh}" rx="1" fill="#222" stroke="#000" stroke-width="0.3"/>')
        cx = bx(jack_x(j) - 9.0)
        # bico rosqueado saindo da borda
        o.append(f'<rect x="{round(cx - 5, 3)}" y="{round(by(BY1) - 0.5, 3)}" width="10" height="{round(H_TOTAL - by(BY1) + 0.5, 3)}" fill="#3a3a3a" stroke="#000" stroke-width="0.2"/>')
        o.append(f'<circle cx="{cx}" cy="{round(H_TOTAL - 1.6, 3)}" r="1.4" fill="#000"/>')
        o.append(f'<text x="{cx}" y="{round(y0 + 4.2, 3)}" {FONT} font-size="3.2" fill="#eee" text-anchor="middle">J{j}</text>')
    # modulo do MUX (azul) entre as 2 barras
    mx0, mx1 = bx(CH_X1 - 15 * PITCH) - 2.2, bx(max(CH_X1, CTRL_X1)) + 2.2
    my0, my1 = by(CTRL_Y) - 2.4, by(CH_Y) + 2.4
    o.append(f'<rect x="{round(mx0, 3)}" y="{round(my0, 3)}" width="{round(mx1 - mx0, 3)}" height="{round(my1 - my0, 3)}" rx="1" fill="#1f5fbf" stroke="#0d3a80" stroke-width="0.3"/>')
    o.append(f'<rect x="{round(mx1 - 11, 3)}" y="{round((my0 + my1) / 2 - 2.2, 3)}" width="8" height="5.2" fill="#111"/>')
    o.append(f'<text x="{round(mx0 + 3, 3)}" y="{round((my0 + my1) / 2 + 1.2, 3)}" {FONT} font-size="1.9" fill="#fff">CD74HC4067 16-ch MUX</text>')
    for i in range(16):  # barra dos canais (so' desenho)
        x = bx(CH_X1 - PITCH * i)
        o.append(f'<rect x="{round(x - 0.6, 3)}" y="{round(by(CH_Y) - 0.6, 3)}" width="1.2" height="1.2" fill="#bbb"/>')
    # pinos de controle (conectores)
    for i, n in enumerate(CTRL):
        x, y = bx(ctrl_x(i)), by(CTRL_Y)
        o.append(f'<rect id="connector{i}pin" x="{round(x - 0.8, 3)}" y="{round(y - 0.8, 3)}" width="1.6" height="1.6" fill="#d4af37" stroke="#8a6d1a" stroke-width="0.15"/>')
        o.append(f'<text x="{x}" y="{round(y + 3.4, 3)}" {FONT} font-size="1.05" fill="#fff" text-anchor="middle">{n}</text>')
    # tip/ring de cada jack (conectores) - no corpo do jack
    for c in CONNECTORS[8:]:
        x = bx(jack_x(c["jack"]) - 9.0)
        y = by(JACK_Y + 3 + c["dy"] * 1.4)
        lab = "T" if c["dy"] == 0 else "R"
        o.append(f'<circle id="{c["id"]}pin" cx="{x}" cy="{round(y, 3)}" r="1.1" fill="#c0c0c0" stroke="#666" stroke-width="0.15"/>')
        o.append(f'<text x="{round(x + 2.2, 3)}" y="{round(y + 0.9, 3)}" {FONT} font-size="2.4" fill="#eee">{lab}</text>')
    o += ["</g>", "</svg>"]
    return "\n".join(o)


# ------------------------------------------------------------ esquematico (grade de 0,1 pol)
def schematic_svg():
    # unidades: 1 = 0,01 pol (grade de 0,1 pol = 10)
    pins_l, pins_r = CTRL, CONNECTORS[8:]
    rows = max(len(pins_l), len(pins_r))
    W = 300  # 3 pol
    H = (rows + 3) * 10
    body_x0, body_x1 = 30, W - 30
    o = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W / 100}in" height="{H / 100}in" viewBox="0 0 {W} {H}">',
        '<g id="schematic">',
        f'<rect x="{body_x0}" y="5" width="{body_x1 - body_x0}" height="{H - 10}" fill="#fff" stroke="#000" stroke-width="1"/>',
        f'<text x="{W / 2}" y="{H / 2 - 4}" {FONT} font-size="9" text-anchor="middle" fill="#000">DrumCore</text>',
        f'<text x="{W / 2}" y="{H / 2 + 7}" {FONT} font-size="9" text-anchor="middle" fill="#000">Jackboard</text>',
        f'<text x="{W / 2}" y="{H / 2 + 17}" {FONT} font-size="6" text-anchor="middle" fill="#555">16 canais</text>',
    ]
    for i, n in enumerate(pins_l):
        y = 20 + i * 10
        o.append(f'<line id="connector{i}pin" x1="0" y1="{y}" x2="{body_x0}" y2="{y}" stroke="#000" stroke-width="1"/>')
        o.append(f'<rect id="connector{i}terminal" x="0" y="{y - 0.5}" width="1" height="1" fill="none"/>')
        o.append(f'<text x="{body_x0 + 3}" y="{y + 2.5}" {FONT} font-size="7" fill="#000">{n}</text>')
    for k, c in enumerate(pins_r):
        y = 20 + k * 10
        o.append(f'<line id="{c["id"]}pin" x1="{body_x1}" y1="{y}" x2="{W}" y2="{y}" stroke="#000" stroke-width="1"/>')
        o.append(f'<rect id="{c["id"]}terminal" x="{W - 1}" y="{y - 0.5}" width="1" height="1" fill="none"/>')
        o.append(f'<text x="{body_x1 - 3}" y="{y + 2.5}" {FONT} font-size="7" fill="#000" text-anchor="end">{c["name"]}</text>')
    o += ["</g>", "</svg>"]
    return "\n".join(o)


# ------------------------------------------------------------ pcb (posicoes reais dos furos)
def thru(id_attr, x, y, size, drill, square=False):
    ring = (size - drill) / 2
    r = round(drill / 2 + ring / 2, 3)
    idp = f' id="{id_attr}"' if id_attr else ""
    if square:
        s = round(size - ring, 3)
        return (
            f'<rect{idp} x="{round(x - s / 2, 3)}" y="{round(y - s / 2, 3)}" width="{s}" height="{s}" '
            f'fill="none" stroke="#F7BD13" stroke-width="{round(ring, 3)}"/>'
        )
    return f'<circle{idp} cx="{x}" cy="{y}" r="{r}" fill="none" stroke="#F7BD13" stroke-width="{round(ring, 3)}"/>'


def pcb_svg():
    w, h = round(BW, 3), round(H_TOTAL, 3)
    pads = []
    for i in range(8):
        pads.append(thru(f"connector{i}pin", bx(ctrl_x(i)), by(CTRL_Y), 1.7, 1.0, square=(i == 0)))
    for i in range(16):
        pads.append(thru(None, bx(CH_X1 - PITCH * i), by(CH_Y), 1.7, 1.0, square=(i == 0)))
    for j in range(1, 9):
        x = jack_x(j)
        tip_id = f"connector{8 + 2 * (j - 1)}pin"
        ring_id = f"connector{9 + 2 * (j - 1)}pin"
        pads.append(thru(tip_id, bx(x), by(JACK_Y), 3.0, 1.4))
        pads.append(thru(ring_id, bx(x), by(JACK_Y + 6.35), 3.0, 1.4))
        pads.append(thru(None, bx(x), by(JACK_Y + 12.7), 3.0, 1.4))
        for dy in (0, 6.35, 12.7):
            pads.append(thru(None, bx(x - 16.23), by(JACK_Y + dy), 3.0, 1.4))
    silk = [f'<rect x="0.1" y="0.1" width="{round(BW - 0.2, 3)}" height="{round(BH - 0.2, 3)}" fill="none" stroke="#fff" stroke-width="0.2"/>']
    for j in range(1, 9):
        x0 = bx(jack_x(j) - 18.3)
        silk.append(f'<rect x="{x0}" y="{by(JACK_Y - 6.83)}" width="19.3" height="26.53" fill="none" stroke="#fff" stroke-width="0.2"/>')
        silk.append(f'<text x="{bx(jack_x(j) - 9)}" y="{by(JACK_Y - 8)}" {FONT} font-size="2" fill="#fff" text-anchor="middle">J{j}</text>')
    for i, n in enumerate(CTRL):
        silk.append(f'<text x="{bx(ctrl_x(i))}" y="{round(by(CTRL_Y) - 1.6, 3)}" {FONT} font-size="0.95" fill="#fff" text-anchor="middle">{n}</text>')
    o = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}mm" height="{h}mm" viewBox="0 0 {w} {h}">',
        '<g id="silkscreen">',
        *silk,
        "</g>",
        # THT: os mesmos pads nas 2 camadas de cobre
        '<g id="copper0"><g id="copper1">',
        *pads,
        "</g></g>",
        "</svg>",
    ]
    return "\n".join(o)


def icon_svg():
    return "\n".join(
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="0.6in" height="0.6in" viewBox="0 0 60 60">',
            '<g id="icon">',
            '<rect x="2" y="14" width="56" height="26" rx="2" fill="#c9773b" stroke="#8a4a1f"/>',
            *[f'<rect x="{4 + i * 7}" y="30" width="5" height="16" fill="#222"/>' for i in range(8)],
            '<rect x="30" y="17" width="20" height="9" fill="#1f5fbf"/>',
            "</g>",
            "</svg>",
        ]
    )


def fzp_xml():
    def conn(c):
        i = c["id"]
        return f"""  <connector id="{i}" name="{c['name']}" type="male">
   <description>{c['desc']}</description>
   <views>
    <breadboardView><p layer="breadboard" svgId="{i}pin"/></breadboardView>
    <schematicView><p layer="schematic" svgId="{i}pin" terminalId="{i}terminal"/></schematicView>
    <pcbView><p layer="copper0" svgId="{i}pin"/><p layer="copper1" svgId="{i}pin"/></pcbView>
   </views>
  </connector>"""

    connectors = "\n".join(conn(c) for c in CONNECTORS)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<module fritzingVersion="0.9.6" moduleId="{MODULE_ID}">
 <version>1</version>
 <title>DrumCore Jackboard (16 canais)</title>
 <label>JB</label>
 <date>2026-10-04</date>
 <author>Projeto DrumCore</author>
 <tags><tag>DrumCore</tag><tag>CD4067</tag><tag>multiplexer</tag><tag>jack</tag><tag>e-drum</tag></tags>
 <properties>
  <property name="family">DrumCore</property>
  <property name="variant">single-layer</property>
  <property name="canais">16 (8 jacks TRS 6,35 mm)</property>
 </properties>
 <url>https://orodamaral.github.io/drumcore/hardware.html</url>
 <description>Jackboard do DrumCore: 8 jacks TRS 6,35 mm (tip e ring = 16 canais) com rede de protecao por canal e um multiplexador CD74HC4067. Controle: GND, VCC (3,3 V), EN (ja no GND na placa), S0-S3 e SIG. Medidas do projeto KiCad hardware/jackboard_singlelayer (184 x 57,5 mm). Licenca CC BY-NC 4.0.</description>
 <views>
  <iconView><layers image="icon/{NAME}_icon.svg"><layer layerId="icon"/></layers></iconView>
  <breadboardView><layers image="breadboard/{NAME}_breadboard.svg"><layer layerId="breadboard"/></layers></breadboardView>
  <schematicView><layers image="schematic/{NAME}_schematic.svg"><layer layerId="schematic"/></layers></schematicView>
  <pcbView><layers image="pcb/{NAME}_pcb.svg"><layer layerId="copper0"/><layer layerId="silkscreen"/><layer layerId="copper1"/></layers></pcbView>
 </views>
 <connectors>
{connectors}
 </connectors>
 <buses>
  <bus id="gnd"><nodeMember connectorId="connector0"/><nodeMember connectorId="connector2"/></bus>
 </buses>
</module>
"""


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    files = {
        f"part.{NAME}.fzp": fzp_xml(),
        f"svg.breadboard.{NAME}_breadboard.svg": breadboard_svg(),
        f"svg.schematic.{NAME}_schematic.svg": schematic_svg(),
        f"svg.pcb.{NAME}_pcb.svg": pcb_svg(),
        f"svg.icon.{NAME}_icon.svg": icon_svg(),
    }
    for fn, text in files.items():
        with open(os.path.join(OUT_DIR, fn), "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
    with zipfile.ZipFile(FZPZ, "w", zipfile.ZIP_DEFLATED) as z:
        for fn, text in files.items():
            z.writestr(fn, text)
    print(f"{FZPZ} ({len(CONNECTORS)} conectores)")


if __name__ == "__main__":
    main()
