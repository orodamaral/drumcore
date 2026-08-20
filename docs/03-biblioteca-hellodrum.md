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

## MIDI: USB-MIDI nativo no ESP32-S3 (Fase B — resolvido)

Nenhum exemplo da lib usa USB-MIDI classe nativa em ESP32 — as opções mostradas
são MIDI serial (biblioteca `MIDI.h`, para Hairless MIDI), USB-MIDI via
`USB-MIDI.h` (só para atmega32u4/Teensy) ou BLE-MIDI (ESP32, sem fio). Isso é
esperado: a HelloDrum-lib só cuida da sensing (`pad.hit`, `pad.note`,
`pad.velocity`) e é independente de como o MIDI é transportado.

**Solução adotada** (racional completo em
[01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)): `Adafruit_USBD_MIDI`
(lib `Adafruit TinyUSB Library`) como transporte da mesma `MIDI Library`
(FortySevenEffects) já usada nos exemplos originais — troca só o transporte,
mantém a API `MIDI.sendNoteOn()`/`sendNoteOff()`. Requer `ARDUINO_USB_MODE=0` e
um workaround de linker (`-Wl,--allow-multiple-definition`, conflito com a
TinyUSB pré-compilada do core `arduino-esp32`) — ambos configurados em
`firmware/platformio.ini`.

Build validado (compila e linka), **teste em hardware real ainda pendente**.

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
(Fase C), mas corrigido já agora para não deixar essa armadilha para depois.

**O que foi feito**: `padType[16]` → `padType[32]`; `showInstrument[]` ganhou
mais 16 entradas ("Pad 17" a "Pad 32"). Nenhuma outra lógica foi alterada.
