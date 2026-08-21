# Módulo de bateria eletrônica — Especificação de UI

Hardware: ESP32-S3, display TFT 1.44" 128x128, 2 rotary encoders com botão, 32 pads.
Referência visual: `Modulo Bateria UI.dc.html` (abra no navegador — telas em tamanho real e ampliadas).

---

## 1. Controles

**ENC1 — página**
| Evento | Ação |
|---|---|
| Girar | Troca de página: LIVE ◀▶ PADS ◀▶ GLOBAL (circular). Dentro de PAD_EDIT / SIGNAL, troca o pad em foco. |
| Push | Alterna entre PAD_EDIT e SIGNAL do pad atual. Sem efeito nas páginas de topo. |
| Hold 600 ms | Volta direto para LIVE de qualquer lugar. |

**ENC2 — navegação e valor**
| Evento | Ação |
|---|---|
| Girar | Move a seleção na lista. Em modo edição, altera o valor do parâmetro selecionado. |
| Push | Entra no item / confirma. Em parâmetro, alterna entre navegar e editar. |
| Hold 600 ms | Volta um nível na hierarquia. |

Debounce sugerido: 5 ms nos pinos A/B, 25 ms no botão. Hold = 600 ms sem release.
Aceleração: >8 detents/s muda o passo de 1 para 5 (apenas em valores 1–127).

## 2. Máquina de estados

```
BOOT --(init ok / qualquer botão)--> LIVE

ENC1 girar:   LIVE <-> PADS <-> GLOBAL <-> LIVE   (circular)

PADS      + ENC2 push      -> PAD_EDIT (pad selecionado)
PAD_EDIT  + ENC2 push      -> alterna NAV <-> EDIT do parâmetro
PAD_EDIT  + ENC2 hold      -> PADS (aplica valores no buffer RAM)
PAD_EDIT  + ENC1 girar     -> pad anterior / próximo, mesma tela
PAD_EDIT  + ENC1 push      -> SIGNAL (push de novo volta)
GLOBAL    + ENC2 push em SALVAR    -> grava NVS + toast "SALVO"
GLOBAL    + ENC2 push em RESTAURAR -> recarrega NVS + toast
qualquer  + ENC1 hold      -> LIVE
```

Edição altera apenas o buffer em RAM. Persistência só acontece em GLOBAL > SALVAR.

## 3. Telas

### SCR 0 — BOOT
- "DRUMCORE" em fonte size 2, cor ACCENT, centralizado em y=38.
- "32 PAD TRIGGER" size 1, TXT_DIM, y=58.
- Barra de progresso 80x4 em x=24,y=82 (trilho SURFACE, preenchimento ACCENT).
- "v0.1  ESP32-S3" size 1, LINE, y=110.
- Sai para LIVE ao terminar init de ADC/MIDI/NVS.

### SCR 1 — LIVE
- Barra de título 128x12: "LIVE" (ACCENT) à esquerda; à direita "USB" (OK se conectado, LINE se não) e "DIN".
- Grade 8x4 de células 14x14 em x=1, y=31. Gap 2 px horizontal, 8 px vertical (bloco 126x68).
- Número do pad (01–32) centralizado na célula, size 1.
- Estados da célula:
  - idle: fundo BG, borda LINE, número TXT_DIM
  - hit (0–60 ms): preenchimento HIT sólido, número BG
  - decay (60–180 ms): fundo BG, borda HIT, número HIT
- **Nunca redesenhar a grade inteira.** Cada trigger repinta apenas o retângulo 14x14 do pad.

### SCR 2 — PADS (lista)
- Título: "PADS" | "NN/32".
- 8 linhas visíveis de 14 px, janela deslizante sobre 32 itens, área x0..125, y12..124.
- Colunas por linha (padding 4 px): `Pnn` (26 px) · sensor abreviado (flex) · `Nnnn` nota MIDI (direita).
- Seleção: fundo ACCENT, texto BG.
- Rolagem só quando a seleção passa da 1ª ou da 8ª linha.
- Scrollbar de 3 px na coluna x=125, altura do cursor proporcional a 8/32.

### SCR 3 — PAD_EDIT
- Título: "PAD nn" | "EDIT".
- 7 linhas de 14 px (y=12..110) — cabem todas, sem rolagem.
- Rodapé 128x12: "ENC2 GIRA VALOR" | "PUSH OK".
- Linha em navegação selecionada: fundo SURFACE, rótulo TXT.
- Linha em modo edição: caixa do valor com fundo EDIT e texto BG.

Parâmetros, na ordem:

| # | Rótulo na tela | Faixa | Observação |
|---|---|---|---|
| 1 | SENSOR | enum | PIEZO / DUAL / SWITCH / HH-CTRL |
| 2 | SENSIB | 1–127 | passo 1, acelera para 5 |
| 3 | THRESH | 1–127 | |
| 4 | SCAN | 1–127 | ms |
| 5 | MASK | 1–127 | ms |
| 6 | CURVA | 1–4 | LIN / EXP1 / EXP2 / LOG |
| 7 | NOTA | 1–127 | exibir nome da nota (ex. D1) ao editar |

Clamp nos limites, sem wrap-around.

### SCR 4 — SIGNAL (monitor)
- Título: "PAD nn" | "SIGNAL".
- Área de plot 120x74 em x=4,y=18, com eixo esquerdo e inferior em LINE.
- Faixa ciano translúcida = janela de scan; faixa cinza = mask time; linha horizontal EDIT = threshold.
- Envelope: buffer de 120 amostras, 1 px por amostra, traço OK de 1 px.
- y=96: `VEL 104   PEAK 118`. y=110: `SCAN n` (ACCENT) `MASK n` (LINE) `THR n` (EDIT).
- Redesenhar só quando chega um hit novo; não faz loop de animação.

### SCR 5 — GLOBAL
- Título: "GLOBAL".
- Linhas de 14 px: MIDI CH (1–16) · SAIDA (USB / DIN / USB+DIN) · BRILHO (10–100%) · KIT (01–nn) · SALVAR (ação) · RESTAURAR (ação).
- Linha de ação selecionada usa o mesmo destaque da lista.
- Toast: 100x34 centrado em x=14,y=56, borda OK 1 px, título size 2 e subtítulo size 1; visível 900 ms; salvar a região por baixo antes de desenhar para restaurar sem repintar a tela.

## 4. Tokens de cor

| Nome | HEX | RGB565 | Uso |
|---|---|---|---|
| BG | #101418 | 0x10A3 | fundo das telas |
| SURFACE | #1E252B | 0x1925 | barras de título e rodapé |
| LINE | #38434D | 0x3A09 | bordas, eixos, pad idle |
| TXT_DIM | #7A8894 | 0x7C52 | rótulos secundários |
| TXT | #E6EDF3 | 0xE77E | texto e valores |
| ACCENT | #00D2FF | 0x069F | seleção, título ativo |
| EDIT | #FFB020 | 0xFD84 | valor em edição, threshold |
| HIT | #FF7A1A | 0xFBC3 | pad acionado |
| OK | #35D07F | 0x368F | confirmação, envelope |

## 5. Tipografia e métricas

- Fonte base: GFX 5x7 em size 1 → célula de 6x8 px, máx. 21 caracteres por linha.
- Destaques (boot, toast): size 2 → 12x16 px.
- Títulos de tela: size 1, ACCENT, caixa alta.
- Barra de título: h 12 px, padding lateral 4 px.
- Linha de lista: h 14 px, 8 visíveis.
- Célula de pad: 14x14, gap 2 px horizontal / 8 px vertical.
- Scrollbar: largura 3 px, coluna x=125.

## 6. Widgets reutilizáveis

1. **TitleBar(left, right)** — 128x12, fundo SURFACE. Reescreve só o trecho alterado.
2. **ScrollList(items, sel, top)** — 125x116, 8 linhas de 14 px, seleção invertida em ACCENT, scrollbar proporcional.
3. **ValueRow(label, value, mode)** — 128x14, modos NAV (fundo SURFACE) e EDIT (caixa EDIT).
4. **PadCell(index, state)** — 14x14, três estados (idle / hit / decay), atualização individual.
5. **Toast(title, subtitle)** — 100x34, borda OK, 900 ms, não bloqueia eventos do encoder.

## 7. Notas de implementação

- Toda tela desenha por regiões; evitar `fillScreen` fora da troca de página.
- Uma flag `dirty` por widget resolve o refresh sem full redraw.
- O buffer de configuração dos 32 pads vive em RAM e só vai para NVS via GLOBAL > SALVAR.
- A tela LIVE precisa continuar respondendo a triggers enquanto o usuário navega em outras telas (os triggers não são perdidos, apenas não desenhados).
