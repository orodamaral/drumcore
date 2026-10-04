# Peça do Fritzing — DrumCore Jackboard

`DrumCore_Jackboard.fzpz` é a jackboard single-layer como peça do
[Fritzing](https://fritzing.org/), para desenhar a ligação do módulo
(ESP32-S3 + jackboards + tela + encoder) e dos pads.

## Como usar

No Fritzing: **Arquivo > Abrir** (ou arraste o `.fzpz` para a janela). A peça
aparece no bin **Minhas peças** (*My Parts*), família "DrumCore".

## O que a peça tem

- **Medidas reais** do projeto KiCad (`hardware/jackboard_singlelayer/`):
  placa de 184 × 57,5 mm, jacks a cada 22,5 mm, furos nas posições reais
  (vista PCB).
- **24 conectores**:
  - **8 de controle do MUX:** GND, VCC (3,3 V), EN, S0, S1, S2, S3, SIG. O
    EN já vai para o GND na própria placa (no Fritzing, EN e GND estão no
    mesmo barramento), então bastam 7 fios até o ESP32.
  - **Tip e ring dos 8 jacks** (J1 tip = canal 0 = pad 1 no ConfigTool, J1
    ring = canal 1, e assim por diante), para ligar os pads no diagrama.

Ligação no ESP32-S3: S0–S3 = GPIO39/40/41/42 (as 2 placas em paralelo), SIG da
placa A = GPIO2, da placa B = GPIO1. Ver [docs/02-hardware.md](../../docs/02-hardware.md).

## Gerar de novo

```
python hardware/fritzing/make_jackboard_fzpz.py
```

Gera o `.fzpz` e os arquivos soltos em `part/` (`.fzp` + SVGs das vistas
protoboard, esquemático, PCB e ícone). As medidas ficam no topo do script. Se a
placa mudar no KiCad, atualize lá.
