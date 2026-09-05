# DrumCore — logos

Referência visual: `DrumCore Logos.html` (abre offline no navegador, contém as 5 direções em tamanho grande, versão 1-bit e ícone quadrado).

**Direção escolhida: 1A (pixel / grade de pads)** — já implementada como serigrafia
(F.SilkS) na `hardware/jackboard/drumcore_jackboard.kicad_pcb`: wordmark "DRUMCORE"
em bitmap 5x7 pixel-art (134 quadrados individuais), canto superior esquerdo da
placa, lado componente (topo). As outras 4 direções (1B-1E) seguem no arquivo de
referência apenas como registro histórico, não usadas.

## Paleta (mesma da UI do módulo)

| Nome | HEX | RGB565 |
|---|---|---|
| BG | #101418 | 0x10A3 |
| SURFACE | #1E252B | 0x1925 |
| LINE | #38434D | 0x3A09 |
| TXT_DIM | #7A8894 | 0x7C52 |
| TXT | #E6EDF3 | 0xE77E |
| ACCENT | #00D2FF | 0x069F |
| HIT | #FF7A1A | 0xFBC3 |

## Tipografia

- **Silkscreen** (Google Fonts) — usada em 1A e em todos os rótulos técnicos. É a fonte pixel; no firmware o equivalente é a GFX 5x7.
- **Archivo** (Google Fonts), pesos 500 / 700 / 900 — usada em 1B, 1C, 1D, 1E.

## As 5 direções

**1A — Pixel / grade de pads.** Grade 8x4 de quadrados de 14 px (gap 3) acima do wordmark em Silkscreen 30 px, tracking 2 px. Uma célula acesa em HIT. É a que casa direto com a tela LIVE.

**1B — Peso partido.** Archivo, "DRUM" em 500 / TXT_DIM e "CORE" em 900 / TXT, 56 px, tracking −2 px, sublinhado ACCENT de 3 px na largura do texto. Ícone: quadrado ACCENT com "DC" em 900.

**1C — Núcleo concêntrico.** Dois quadrados de borda 5 px (76 px externo, 44 px interno) com um quadrado HIT de 16 px no centro, à esquerda do lockup "DRUMCORE" (Archivo 900, 38 px) + "TRIGGER MODULE" (Silkscreen 10 px, tracking 3 px). Única direção com símbolo separável do texto.

**1D — Envelope.** Wordmark Archivo 700, 48 px, tracking 5 px, sobre uma linha de base de 24 barras que descrevem o decay de um trigger (primeiras 2 barras em HIT).

**1E — Placa.** Caixa de borda 3 px dividida: bloco "DC" invertido (Archivo 900, 44 px) + "DRUMCORE" (700, 24 px) e "32 PAD · ESP32-S3" (Silkscreen 8 px, ACCENT).

## Uso na tela de boot (128x128)

O arquivo HTML mostra 1A, 1B e 1D aplicadas ao boot, em 2x. Regras:
- Wordmark centralizado, cor ACCENT, baseline em y≈50.
- Barra de progresso 80x4 em x=24, y=82 (trilho SURFACE, preenchimento ACCENT).
- `v0.1  ESP32-S3` em Silkscreen size 1, cor LINE, y=110.
- Para 1A no firmware, o wordmark cabe em size 2 da GFX 5x7 (8 caracteres × 12 px = 96 px, sobra 16 px de margem em cada lado).

## Grade de 1A como bitmap

Padrão de células acesas (grade 8 colunas × 4 linhas, índice 0 na esquerda em cima, ordem em linha):
`1,2,5,6,9,11,12,14,17,18,21,22,25,26,29,30` acesas em TXT; a célula `12` em HIT; restantes em SURFACE.

Ícone 4x4: acesas `1,2,4,7,8,11,13,14` em TXT; célula `5` em HIT.

## Pendências

- Se uma segunda jackboard (ou outra placa futura) precisar do logo, repetir o
  mesmo processo (bitmap 5x7 manual + import pixel-a-pixel via Konnect — ver
  `hardware/jackboard/assets/pixel.svg`) já que não existe arquivo vetorial
  (.svg/.ai) do wordmark, só a arte pixel-a-pixel direto no `.kicad_pcb`.
