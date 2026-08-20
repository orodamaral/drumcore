# Biblioteca base: HelloDrum-arduino-Library

Fonte original: https://github.com/RyoKosaka/HelloDrum-arduino-Library (v0.7.7,
autor Ryo Kosaka). Vendorizada em `firmware/lib/HelloDrum-arduino-Library`
(histórico Git original removido — o rastreio de mudanças passa a ser feito no
Git deste projeto).

## O que a lib já oferece

- **Sensores**: piezo simples e duplo (com aro/rim), prato 2 zonas (Roland) e 3
  zonas (Yamaha), hi-hat via SoftPot/FSR/óptico (TCRT5000) ou controlador Roland
  VH10/VH11, pedal de hi-hat (FSR).
- **Multiplexação**: `HelloDrumMUX_4051` (8 canais) e `HelloDrumMUX_4067` (16
  canais) — ver detalhes de como múltiplos MUXes coexistem em
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).
- **Curvas de velocidade**: `setCurve(curveType)`.
- **Persistência**: `loadMemory()`/`initMemory()`, usando EEPROM (no ESP32, via
  `EEPROM_ESP.h`/`EEPROM_ESP.cpp` inclusos na lib — wrapper próprio, já que ESP32
  não tem EEPROM real).
- **Botões de configuração física**: `HelloDrumButton` (5 pinos: SET, UP, DOWN,
  NEXT, BACK) e `HelloDrumButtonLcdShield` (variante para shield de LCD com botão
  único analógico).
- **Exemplos relevantes** (`examples/`):
  - `MUX/muxSensing_u8g2` — MUX 4051 + OLED (u8g2) + botões de config + MIDI
    serial. É o exemplo mais próximo do nosso caso de uso (só falta USB-MIDI
    nativo e múltiplos MUX).
  - `MUX/muxSensing_16ch` — MUX 4067 (16 canais).
  - `BLE/SimpleSensing_BLEMIDI` — envio via BLE-MIDI (não é o nosso caso, mas
    mostra como a lib se integra com MIDI de formas diferentes).
  - `EEPROM/` — inicialização de memória.

## API principal (classe `HelloDrum`, uso via MUX)

```cpp
HelloDrumMUX_4051 mux(S0, S1, S2, pinADC);   // um por chip CD4051
HelloDrum pad(indiceNoRawValue);              // ver cálculo do índice abaixo

// no loop():
mux.scan();               // popula rawValue[] para os 8 canais deste MUX
pad.settingEnable();      // habilita fluxo de configuração via botões físicos
pad.singlePiezoMUX();     // faz a leitura/detecção de hit para este pad
if (pad.hit) { /* pad.note, pad.velocity disponíveis */ }
```

**Cálculo do índice do pad quando há múltiplos MUX**: `pin1 = muxNum * 8 + canal_local`,
onde `muxNum` é a ordem de instanciação do `HelloDrumMUX_4051` (0 para o 1º MUX
criado no código, 1 para o 2º, etc — ver `muxIndex` estático em `hellodrum.cpp`).

## MIDI: lacuna a resolver (USB-MIDI nativo no ESP32-S3)

Nenhum exemplo da lib usa USB-MIDI classe nativa em ESP32 — as opções mostradas
são MIDI serial (biblioteca `MIDI.h`, para Hairless MIDI), USB-MIDI via
`USB-MIDI.h` (só para atmega32u4/Teensy) ou BLE-MIDI (ESP32, sem fio).

Para o nosso requisito de módulo **MIDI-USB** no ESP32-S3, vamos precisar
integrar a lib com a stack USB nativa do core `arduino-esp32` (baseada em
TinyUSB, classe `USBMIDI`), que é independente da lib HelloDrum — a HelloDrum só
cuida da sensing (`pad.hit`, `pad.note`, `pad.velocity`); o envio MIDI é
responsabilidade do nosso código de integração.

**A investigar/decidir quando começarmos a implementar isso**:
- Configuração de build necessária no `platformio.ini` para habilitar o modo USB
  nativo do ESP32-S3 (`ARDUINO_USB_MODE`, `ARDUINO_USB_CDC_ON_BOOT`, etc).
- Se vamos usar a classe `USBMIDI` do core arduino-esp32 diretamente, ou a lib
  `Adafruit_TinyUSB`.

## Modificações em relação ao original

### 2026-08-20 — `padType[16]` → `padType[32]` e `showInstrument[]` (16 → 32 entradas)

**Arquivo**: `firmware/lib/HelloDrum-arduino-Library/src/hellodrum.h`

**Motivo**: ao implementar a leitura dos 32 canais (Fase A), identificamos que
`padType[]` é um array **fixo de 16 posições**, indexado por `padNum` (0..31 no
nosso caso, um por pad instanciado) — e essa indexação acontece dentro de
**toda** chamada de sensing (`singlePiezoMUX()`, `dualPiezoMUX()`, etc, ex:
`padType[padNum] = Snum;`), não só na configuração via botões. Com 32 pads,
qualquer pad com `padNum >= 16` escreveria fora dos limites do array, corrompendo
as variáveis estáticas declaradas depois dele em `hellodrum.h` (`edit`,
`editCheck`, `editdone`, etc) — um bug silencioso de memória, sem erro de
compilação.

O próprio comentário original já alertava para isso: `static byte padType[16];
//if you use more pad, add numer` (sic).

O mesmo problema existe em `showInstrument[]` (também 16 entradas), usado por
`settingName()` — relevante para quando implementarmos a tela OLED/botões
(Fase B), mas corrigido já agora para não deixar essa armadilha para depois.

**O que foi feito**: `padType[16]` → `padType[32]`; `showInstrument[]` ganhou
mais 16 entradas ("Pad 17" a "Pad 32"). Nenhuma outra lógica foi alterada.
