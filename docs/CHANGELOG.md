# Changelog

Registro cronológico do que foi feito no projeto (mais recente no topo).

## 2026-08-20 (15) — bugfix

- **Corrigido**: sliders do editor de pad (app desktop) não refletiam a
  mudança - arrastar e soltar fazia o valor "voltar" pro que era antes.
  Causa: `set_pad` em campos numéricos responde com `ack` (não
  `pad_config`), e `App.tsx` só registrava o `ack` no log, nunca atualizava
  o estado local `pads` — como o slider é um input controlado ligado a
  esse estado, ele sempre reexibia o valor antigo. Corrigido aplicando o
  `ack` (`pad`/`field`/`value`) no estado local também. Afeta tanto o modo
  demo quanto o módulo real (bug era só no app, não no protocolo/firmware).

## 2026-08-20 (14)

- **Fase I**: tela inicial (grid 8x4 com o número de cada pad, acende verde
  ao ser atingido) que aparece após 4s ocioso e dá lugar à tela de
  configuração assim que qualquer encoder é usado. A tela de configuração
  ganhou um velocímetro (arco + agulha) mostrando onde o valor atual do
  parâmetro cai entre o mínimo e o máximo.
- Grid mapeado 1:1 com a fiação real: linha = MUX físico (0-3), coluna =
  canal dentro do MUX (0-7).
- Velocímetro desenhado via trigonometria (`drawGauge()`), já que a
  Adafruit GFX não tem desenho de arco nativo; faixa min/max de cada
  parâmetro inferida por substring no rótulo (`getGaugeRange()`), já que a
  lib não expõe isso estruturado.
- Simulador do módulo (`HardwareSimulator.tsx`) atualizado com os mesmos
  dois estados — grid com hits simulados periodicamente, velocímetro via
  SVG — usando as mesmas constantes de tempo do firmware
  (`IDLE_TIMEOUT_MS`, `PAD_FLASH_MS`).
- Build/typecheck do firmware e do app validados. **Nada testado em
  hardware real** — em especial a legibilidade do velocímetro na tela
  física de 1.44" ainda precisa de confirmação. Detalhes em
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).

## 2026-08-20 (13)

- **Fase H**: BLE-MIDI (`lathoub/Arduino-BLE-MIDI`, stack Bluedroid já
  embutida no core) como transporte adicional — todo hit/CC vai tanto pro
  USB-MIDI quanto pro BLE-MIDI simultaneamente (não é um "modo" a escolher;
  o BLE só efetivamente transmite quando há um dispositivo pareado).
  Confirmei a API lendo os próprios exemplos vendorizados da HelloDrum-lib
  (`examples/BLE/`, `examples/MUX/muxSensing_BLEMIDI`) e o código-fonte da
  lib BLE-MIDI direto do GitHub antes de implementar.
- Nome anunciado via Bluetooth: `"HelloDrum"`. Instância nomeada `BleMidi`
  (em vez do nome padrão `MIDI` que a lib usaria, que colidiria com o `MIDI`
  já usado pro USB).
- `device_info` ganhou o campo `ble_connected`; o firmware reenvia
  `device_info` automaticamente a cada pareamento/desconexão BLE, sem o app
  precisar dar poll. App desktop: indicador "BLE ●/○" na barra superior,
  modo demo simula pareamento/desconexão periódicos pra exercitar a UI.
- Consumo de recursos antes/depois: RAM 11.9%→19.8%, Flash 10.9%→30.0% (a
  stack Bluedroid é pesada em flash, mas ainda com bastante margem no board
  N8 de 8MB). Build validado, nenhum warning novo.
- **Nada testado em hardware real** — essa fase é mais especulativa que as
  anteriores: compilar não garante que USB-MIDI e BLE-MIDI realmente
  coexistem em runtime sem briga de stack, nem que o pareamento (a lib usa
  bonding BLE) funciona de primeira em iOS/Android/Windows. Detalhes em
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).

## 2026-08-20 (12)

- Criado esquemático visual de ligação (ESP32-S3 ↔ 4x CD4051 ↔ tela TFT ↔ 2
  encoders), reunindo o pinout já documentado num diagrama único. Salvo em
  [docs/assets/esquematico-hellodrum.html](assets/esquematico-hellodrum.html)
  e também publicado como artifact. Inclui notas de montagem que ainda não
  estavam explícitas (VDD/VSS/INH do CD4051, pull-up interno dos encoders).

## 2026-08-20 (11)

- **Simulador do módulo** (nova aba no app desktop): recria a tela TFT
  128x128 + navegação pelos 2 encoders rotativos, pra testar a UX da
  configuração via hardware antes da tela/encoders físicos chegarem.
  Reproduz fielmente a máquina de estados do firmware (navegação de pad/item,
  modo de edição, encoder 2 desabilitado durante edição, mensagem "Canal
  ocupado") - ver [06-simulador-hardware.md](06-simulador-hardware.md) pro
  detalhamento do que é fiel e o que é só aproximação visual.
- Controle por scroll do mouse nos "encoders" na tela, ou por teclado
  (setas + Enter/Espaço) - dataset de 32 pads local com uma mistura de
  tipos pra dar um "tour" pelas telas possíveis sem precisar configurar
  nada primeiro.
- Build/typecheck validados.

## 2026-08-20 (10)

- App desktop: lista de pads trocada de um grid de botões grandes pra uma
  lista compacta (uma linha por pad — número, nome/"Sem nome", nota),
  ocupando uma coluna fixa mais estreita à esquerda, deixando mais espaço
  pro editor do pad. Ajuste de UI, sem mudança de protocolo/firmware.

## 2026-08-20 (9)

- **Fase G**: os 8 tipos de sensor documentados pela HelloDrum-lib (simples,
  aro/dual, chimbal simples, prato 2 zonas, chimbal 2 zonas, prato 3 zonas,
  pedal FSR/VH-10/VH-11, pedal óptico TCRT5000), com a topologia de canais
  (tipo de cada canal, e quais 2 canais formam um pad de 2 zonas)
  configurável em runtime só pelo app desktop, persistida em EEPROM.
  Detalhamento completo em [05-tipos-de-sensor.md](05-tipos-de-sensor.md).
- Confirmado lendo o código-fonte: **nenhum tipo de sensor dessa lib usa mais
  de 2 canais** — inclusive o prato de 3 zonas (a 3ª zona/cup é o mesmo canal
  do switch de borda, discriminado por um threshold mais alto).
- Firmware: todos os 32 pads passaram a ser construídos com 2 pinos desde o
  boot (`HelloDrum(i, i+1)`) pra permitir trocar o tipo de um pad em runtime
  sem reconstruir objetos C++ — só troca qual método de sensing é chamado.
  Canais consumidos por um pad de 2 canais ficam sem configuração própria
  (`"primary": false` no protocolo). Chimbal (prato/simples) e pedal de
  chimbal são pads separados, linkáveis via `hihat_pedal_channel` (a lib não
  faz essa ligação automaticamente). Detalhes e limitações herdadas da lib
  (só 3 slots de nota independentes) em
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).
- Protocolo (`04-protocolo-serial.md`) estendido: `set_pad` ganhou os campos
  `rim_sensitivity`, `rim_threshold`, `note_rim`, `note_cup`, `pad_type` e
  `hihat_pedal_channel`; `pad_config` ganhou `primary`/`consumed_by`; `hit`
  ganhou `zone`.
- App desktop: seletor de tipo de sensor por pad, campos condicionais por
  tipo (só mostra o que faz sentido), seletor de pedal linkado pros tipos de
  chimbal, e exibição diferenciada pra canais consumidos no grid e no editor.
  Modo demo simula a mesma lógica (incluindo consumo de canal e simulação de
  hits por zona).
- Build/typecheck do firmware e do app validados. **Nada testado em
  hardware real** — em especial a faixa de `pedalCC` e o comportamento real
  de `HH2zoneMUX()` num chimbal físico.

## 2026-08-20 (8)

- **Fase F**: nome livre por pad (ex: "Caixa"), editável só pelo app
  desktop. Número do pad fixo — nome exibido sempre `"N - label"` (ou
  `"Pad N"` sem label), na tela TFT e no app.
- Firmware: `padLabels`/`padNames` em `main.cpp`, persistidos em EEPROM
  (layout estendido). Protocolo `set_pad` ganhou o campo `label` (string),
  reaproveitando o comando existente em vez de criar um novo. Detalhes em
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) e
  [04-protocolo-serial.md](04-protocolo-serial.md).
- App desktop: campo de texto no editor do pad (com o número fixo ao lado),
  commit ao sair do campo ou apertar Enter. Modo demo atualizado pra
  simular o mesmo comportamento.
- Build/typecheck do firmware e do app validados. Nada testado em hardware
  real ainda.

## 2026-08-20 (7)

- Iniciada a **interface desktop** (item 4 do escopo original) em
  `desktop-app/` — Electron + React + TypeScript, build via `electron-vite`.
  Decisões (stack e protocolo) perguntadas diretamente ao usuário. Detalhes
  em [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).
- **Fase E do firmware**: protocolo serial NDJSON sobre a porta USB-CDC
  (`bblanchon/ArduinoJson`). Todo o tráfego Serial passou a ser JSON (uma
  linha por objeto) — inclusive os eventos de hit e logs de boot, que antes
  eram texto livre. Contrato completo documentado em
  [04-protocolo-serial.md](04-protocolo-serial.md).
- App desktop implementado: tela de conexão (lista/seleciona porta serial),
  grid dos 32 pads, editor de parâmetros (sliders), log de eventos. Inclui
  **"modo demo"** — simula o módulo inteiramente no processo renderer
  (`mockDevice.ts`), sem precisar de porta serial nem hardware, útil pra
  validar/demonstrar a UI antes da bancada estar montada.
- Corrigidas vulnerabilidades de dependências encontradas no scaffold inicial
  (Electron e esbuild/vite desatualizados) antes de seguir — atualizado para
  `electron@^43`, `vite@^7`, `0` vulnerabilidades no `npm audit`.
- Validado: `npm run typecheck` e `npm run build` (main+preload+renderer)
  passam limpo. Firmware da Fase E compila (RAM/Flash sem mudança
  significativa). **Nada testado com o módulo real** — sem hardware montado,
  só o modo demo do app foi exercitado (e mesmo assim só via build, não
  `npm run dev` de fato nesta sessão).

## 2026-08-20 (6)

- Implementada a **Fase D**: persistência das configurações em EEPROM (NVS).
  `firmware/src/main.cpp` agora chama `EEPROM_ESP.begin()` no `setup()` e usa
  um byte de flag ("já inicializado", endereço `NUM_PADS*10`) pra decidir
  entre `initMemory()` (primeiro boot, grava os defaults) ou `loadMemory()`
  (demais boots, restaura o que foi salvo/editado via os encoders).
- **Bug real encontrado e corrigido na lib vendorizada**: no branch de
  incremento (UP) do item SENSITIVITY, o endereço de EEPROM usado era
  `padNum * 8` em vez de `padNum * 10` (usado por todo o resto do código) —
  gravava por cima de dados de **outro** pad para qualquer `padNum >= 1`.
  Corrigido nas duas variantes (ESP32/AVR) em `hellodrum.cpp`. Só apareceu
  agora porque é a primeira fase em que a EEPROM foi de fato ativada — antes
  as escritas eram no-ops silenciosos. Detalhes em
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) e
  [03-biblioteca-hellodrum.md](03-biblioteca-hellodrum.md).
- Build validado (compila e linka, RAM 11.4%, Flash 10.4%). **Teste em
  hardware real ainda pendente** — não há como simular reboot com NVS real
  sem a placa física, então a persistência de fato ainda não foi confirmada.

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
