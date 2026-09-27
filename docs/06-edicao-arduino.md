# Edição Arduino (ideia, não implementada)

> **Status: proposta registrada em 2026-09-27, sem código.** Nada aqui foi
> implementado nem testado. Fica documentado para retomar depois que as
> placas dos MUX estiverem montadas e o sensing de 2/3 zonas estiver mais
> maduro. Placa disponível para teste: **Arduino Mega** (Rodrigo).

## Motivação

Levar o DrumCore para quem já tem um Arduino (Mega ou Uno), sem precisar de
ESP32-S3. A lib base ([HelloDrum](03-biblioteca-hellodrum.md)) nasceu no
Arduino e já tem versão com EEPROM para AVR, então sensing, curvas e leitura
por MUX existem lá.

## Montagens pensadas

| Montagem | Placa | Canais | Saída MIDI |
|---|---|---|---|
| Completa (atual) | ESP32-S3 | 32 via 2× CD4067 (jackboards) | USB-MIDI + BLE-MIDI |
| Arduino | Mega 2560 + MocoLUFA | 32 via 2× CD4067 (mesmas jackboards) | USB-MIDI (16U2) |
| Arduino lite | Mega 2560 | 16 direto nas analógicas A0–A15 = 8 jacks | USB-MIDI (16U2) |
| Lite pequena (talvez) | Uno / Nano / Pro Micro | 6 / 8 / 9 analógicas diretas | USB-MIDI (16U2 ou nativo 32U4) |

Na lite a convenção de jack continua igual (ver
[02-hardware.md](02-hardware.md)): A0 = tip e A1 = ring do jack 1, A2/A3 do
jack 2, e assim por diante. Sem MUX não há tempo de estabilização entre
canais — as 16 leituras do Mega levam ~2 ms.

## Limites de hardware (por que não é só recompilar)

| | ESP32-S3 (hoje) | Mega 2560 | Uno |
|---|---|---|---|
| RAM | 320 KB (firmware usa ~65 KB) | 8 KB | 2 KB |
| EEPROM | à vontade | 4 KB | 1 KB |
| Config dos 32 pads na EEPROM (1219 bytes) | ok | ok | **não cabe** |
| Buffer da tela 160×128 (`GFXcanvas16`, 40 KB) | ok | **não cabe** | **não cabe** |
| BLE-MIDI | sim | não | não |

Consequências:

- **Tela**: no AVR, desenhar direto na TFT, sem buffer (mais lento, mas
  funciona), ou trocar por OLED 128×64 (buffer de 1 KB). Os módulos ST7735
  costumam ter **lógica de 3,3 V**: no Mega (5 V) precisa de conversor de
  nível ou divisores nas linhas de dados, a não ser que o módulo aceite 5 V.
- **Protocolo**: o NDJSON com ArduinoJson precisa ser enxugado para caber na
  RAM do Mega; no Uno/Nano/Pro Micro (2–2,5 KB) é o principal limite.
- **Lite com menos canais** cabe na EEPROM de 1 KB (16 pads ≈ 600 bytes).

## Pinos (Mega)

Encoder e tela só usam pinos digitais — as 16 analógicas ficam para os pads.

- **Encoder**: A/B em pinos de interrupção (2, 3, 18, 19, 20, 21) + 1
  digital para o botão.
- **TFT SPI**: SPI por hardware em 51 (MOSI) / 52 (SCK) + digitais para CS,
  DC, RST e luz de fundo.
- **OLED I2C** (alternativa): 20 (SDA) / 21 (SCL) — aí o encoder vai em
  2/3/18/19.
- **MUX** (montagem completa): 4 digitais para S0–S3 + 2 analógicas para os
  SIG dos 2 CD4067.

## USB-MIDI e configuração

- **MocoLUFA** (`firmware/MocoLUFA_DrumCoreMega.hex` / `..._DrumCoreUno.hex`
  no repo): firmware gravado no chip USB da placa (ATmega16U2). Um jumper
  — que pode virar uma chave — escolhe entre USB-MIDI class-compliant e
  USB-serial normal (necessário para gravar o firmware do Mega).
- **Problema**: em modo MIDI a serial some, e o ConfigTool (Web Serial) não
  conversa com o módulo — o usuário teria que trocar a chave entre tocar e
  configurar.
- **Proposta**: o ConfigTool falar pelo próprio MIDI, via **SysEx** (Web
  MIDI no Chrome/Edge suporta), com o mesmo protocolo de hoje embrulhado em
  mensagens SysEx. A chave fica só para gravar firmware; no uso normal
  toca e configura ao mesmo tempo.
- **Clones com CH340** (sem 16U2) não rodam MocoLUFA: só MIDI DIN (saída 5
  pinos com optoacoplador) ou ponte serial→MIDI no PC (ex: Hairless MIDI).
- **Leonardo / Pro Micro (ATmega32U4)**: USB nativo, faz USB-MIDI e serial ao
  mesmo tempo, sem chave nem MocoLUFA — mas com os limites de RAM/EEPROM do
  Uno.

## Entradas

Os piezos continuam precisando da proteção por canal da jackboard (1k em
série, grampo duplo com 1N4148, 4,7k no SIG). Para a lite, uma "jackboard
lite": só jacks + proteção, sem o CD4067.

## Ordem sugerida quando retomar

1. Separar no firmware o que é específico de placa (USB/BLE, tela, EEPROM,
   leitura por MUX ou direta) do que é comum (sensing, protocolo, preset de
   fábrica, regra do tip) — para não virarem dois projetos.
2. **Lite no Mega** primeiro: menos peças, testável no Mega disponível.
3. Transporte SysEx no firmware + Web MIDI no ConfigTool.
4. Montagem completa no Mega (jackboards atuais).
5. Uno / Nano / Pro Micro, se houver demanda.
