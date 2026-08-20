# Changelog

Registro cronológico do que foi feito no projeto (mais recente no topo).

## 2026-08-20 (5)

- Implementada a **Fase C**: tela TFT (ST7735, `Adafruit GFX` + `Adafruit
  ST7735 and ST7789 Library`) e navegação/edição via **2 encoders rotativos
  com chave** (lib `mathertel/RotaryEncoder`), em vez dos 5 botões discretos
  originalmente previstos.
- `firmware/src/main.cpp`: os encoders alimentam
  `HelloDrumButton::readButton(set, up, down, next, back)` diretamente (sem
  modificar a lib), e a tela mostra pad/item/valor atuais, com flash
  transiente "EDITAR"/"OK" ao entrar/sair do modo de edição.
- Pinout proposto para tela e encoders em [02-hardware.md](02-hardware.md).
- **Bug/pegadinha encontrada e corrigida**: `settingName()` precisa ser
  chamado uma vez por pad no `setup()` (incrementa `nameIndexMax`, que limita
  a navegação entre pads) e precisa apontar para um buffer estático/global
  (não temporário) já que guarda o ponteiro recebido, não uma cópia. Detalhes
  em [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).
- Build validado (compila e linka, RAM 11.4%, Flash 10.1%). **Ainda não
  testado em hardware real** — falta confirmar sentido de giro dos encoders,
  `LatchMode`, e a inicialização/cores da tela (`INITR_144GREENTAB`).
- Edições feitas via os encoders ainda **não persistem** (sem EEPROM ativada
  nesta fase, de propósito — habilitar `EEPROM_ESP.begin()` sem também
  implementar `initMemory()` no primeiro boot deixaria sensibilidade/threshold
  zerados e sensing instável). Persistência fica para uma fase futura.

## 2026-08-20 (4)

- **Mudança de hardware**: tela definida como TFT 1.44" 128x128, driver ST7735S
  (SPI), em vez do OLED SSD1306 (I2C) previsto inicialmente — modelo escolhido
  pelo usuário por preço (foto em `Modelo Tela.jpeg` na raiz do projeto).
- Atualizado pinout proposto em [02-hardware.md](02-hardware.md) para os 6
  sinais SPI da tela (SCK, MOSI, RES, DC, CS, BLK), sem conflito com os pinos
  já usados pelos 4x CD4051.
- Decisão de biblioteca registrada em
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md): Adafruit GFX +
  Adafruit ST7735 Library (em vez de u8g2, que é focada em displays
  monocromáticos, ou TFT_eSPI, que exige mais configuração). Ainda não
  implementado no firmware — só a decisão e o pinout.

## 2026-08-20 (3)

- Implementada a **Fase B**: USB-MIDI nativo. `firmware/src/main.cpp` agora
  envia `MIDI.sendNoteOn/sendNoteOff` via `Adafruit_USBD_MIDI` (transporte USB
  nativo/TinyUSB) sempre que um pad é atingido, usando notas de teste
  consecutivas (36 a 67) só para identificar cada canal no DAW.
- `firmware/platformio.ini`: adicionado `ARDUINO_USB_MODE=0` (modo TinyUSB/OTG,
  confirmado no `boards.txt` do core `arduino-esp32` instalado — o padrão do
  board é `ARDUINO_USB_MODE=1`, modo Hardware-CDC, que não suporta classes USB
  customizadas), `ARDUINO_USB_CDC_ON_BOOT=1` (mantém Serial via CDC) e
  `lib_deps` (`Adafruit TinyUSB Library`, `FortySevenEffects/MIDI Library`).
- **Problema de linker encontrado e contornado**: o core `arduino-esp32` 3.x já
  embute sua própria TinyUSB pré-compilada, conflitando (símbolos duplicados)
  com a TinyUSB que a lib Adafruit compila do próprio código-fonte. Resolvido
  com `-Wl,--allow-multiple-definition`. Detalhes em
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).
- Build validado com sucesso (RAM 11.1%, Flash 9.5% no `esp32-s3-devkitc-1`).
  **Ainda não testado em hardware real** — falta confirmar que o módulo
  enumera como dispositivo USB-MIDI de fato e que o Serial (CDC) continua
  funcionando junto (dispositivo composto).

## 2026-08-20 (2)

- Implementada a **Fase A**: firmware básico (`firmware/src/main.cpp`) que
  instancia 4x `HelloDrumMUX_4051` + 32x `HelloDrum` e reporta hits via Serial
  (sensibilidade/threshold padrão da lib, sem MIDI/OLED/botões ainda).
- Definido pinout proposto para o ESP32-S3 (S0/S1/S2 compartilhados + 4 pinos
  ADC1 dedicados, evitando strapping pins e os pinos do USB nativo). Ver
  [02-hardware.md](02-hardware.md).
- **Bug encontrado e corrigido na lib vendorizada**: `padType[16]` e
  `showInstrument[]` (16 entradas) são indexados por `padNum`/`nameIndex`, que
  vão até 31 com 32 pads — causaria overflow de memória a partir do pad 17.
  Ambos ampliados para 32. Detalhes em
  [03-biblioteca-hellodrum.md](03-biblioteca-hellodrum.md).
- PlatformIO CLI instalado (`pip install --user platformio`) e build validado:
  compila com sucesso para `esp32-s3-devkitc-1` (RAM 7.0%, Flash 8.7%). Ainda
  **não testado em hardware real** — o hardware com os 4x CD4051 ainda não foi
  montado, então a lógica de sensing em si não foi validada com sinais reais,
  só a compilação/estrutura do código.

## 2026-08-20

- Estruturação inicial do projeto: repositório Git criado, pastas `docs/`,
  `firmware/` (PlatformIO) e `desktop-app/` criadas.
- Biblioteca [HelloDrum-arduino-Library](https://github.com/RyoKosaka/HelloDrum-arduino-Library)
  (v0.7.7) clonada e vendorizada em `firmware/lib/HelloDrum-arduino-Library`.
- Análise inicial do código-fonte da lib: confirmado suporte nativo a até 8x
  CD4051 (64 canais) via `rawValue[64]` + `muxNum` sequencial — 4x CD4051 (32
  canais) não exige modificação na lib, apenas cálculo manual do índice do pad
  (`muxNum * 8 + canal_local`).
- Decisões tomadas: placa ESP32-S3, toolchain PlatformIO, lib base vendorizada
  (fork local, não dependência externa). Detalhes em
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).
- Identificada lacuna: a lib não tem exemplo de USB-MIDI nativo para ESP32 (só
  BLE-MIDI ou MIDI serial) — vai precisar de integração própria com a stack USB
  (TinyUSB) do core arduino-esp32. Ver
  [03-biblioteca-hellodrum.md](03-biblioteca-hellodrum.md).
- Nota de ambiente: PlatformIO CLI ainda não instalado na máquina de dev.
