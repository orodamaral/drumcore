# Visão Geral do Projeto

## Objetivo

Desenvolver um módulo MIDI-USB para bateria eletrônica, usando ESP32-S3 como
cérebro do sistema, capaz de:

1. Ler até 32 entradas analógicas (pads piezo, pratos multi-zona, hi-hat, pedais)
   através de 4 multiplexadores CD4051 (8 canais cada).
2. Converter os sinais lidos em eventos MIDI (Note On/Off, Control Change) e
   enviá-los via **USB-MIDI nativo** (classe de dispositivo USB, plug-and-play,
   sem necessidade de driver ou software intermediário como Hairless MIDI).
3. Prever uma tela (TFT ST7735 128x128, SPI) e botões físicos para configuração
   do módulo diretamente no hardware (sensibilidade, threshold, curva, nota
   MIDI de cada pad, etc).
4. Oferecer uma interface desktop para configuração completa do módulo (todos os
   parâmetros de cada pad, mapeamento de notas, backup/restore de configuração).

## Escopo funcional (alto nível)

| # | Funcionalidade | Status |
|---|---|---|
| 1a | Leitura de 32 canais via 4x CD4051 (sensing) | Compilado, sem teste em hardware real |
| 1b | Envio MIDI-USB nativo (Note On/Off) | Compilado, sem teste em hardware real |
| 2 | Tela TFT (ST7735) + botões de configuração no hardware | Em planejamento (hardware da tela definido) |
| 3 | Interface desktop de configuração | Em planejamento |

## Decisões já tomadas

Ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) para o histórico
completo e o racional de cada decisão. Resumo:

- **Placa**: ESP32-S3 (USB OTG nativo → permite USB-MIDI classe de dispositivo).
- **Toolchain**: PlatformIO.
- **Biblioteca base**: [HelloDrum-arduino-Library](https://github.com/RyoKosaka/HelloDrum-arduino-Library),
  vendorizada (fork local) em `firmware/lib/HelloDrum-arduino-Library`, para podermos
  modificar livremente.

## Como este projeto é documentado

- **docs/01-decisoes-arquiteturais.md** — registro de decisões técnicas (estilo ADR),
  com contexto e alternativas consideradas.
- **docs/02-hardware.md** — esquema de ligação (pinout ESP32-S3 ↔ 4x CD4051 ↔ pads,
  tela TFT, botões).
- **docs/03-biblioteca-hellodrum.md** — notas sobre a API da biblioteca base, o que
  foi entendido do código-fonte, e o que foi/será modificado em relação ao original.
- **docs/CHANGELOG.md** — o que foi feito, em ordem cronológica.

Sempre que uma decisão relevante for tomada ou algo novo for aprendido sobre a
biblioteca/hardware, isso deve ser registrado nesses arquivos.
