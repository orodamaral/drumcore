# Decisões Arquiteturais

Registro cronológico de decisões técnicas relevantes, com contexto e alternativas
consideradas. Formato: **Data — Decisão — Contexto/Racional — Alternativas descartadas**.

---

## 2026-08-20 — Placa: ESP32-S3

**Decisão**: usar ESP32-S3 como microcontrolador do módulo.

**Contexto/Racional**: o objetivo é MIDI-USB nativo (o módulo aparece como
dispositivo MIDI USB plug-and-play no computador/DAW, sem software intermediário).
O ESP32 "clássico" (WROOM/WROVER) não tem controlador USB nativo — só USB-serial
via chip conversor (CP2102/CH340), o que não permite classe USB-MIDI real. O
ESP32-S3 (e também o S2) tem USB OTG nativo, suportado pelo core arduino-esp32 via
TinyUSB, permitindo implementar a classe MIDI USB de verdade.

**Alternativas descartadas**:
- ESP32-S2: também teria USB nativo, mas o S3 tem mais memória/performance e
  Wi-Fi+BLE mais robusto, útil caso o projeto evolua para incluir BLE-MIDI como
  opção adicional no futuro.
- ESP32 clássico + BLE-MIDI: viável, mas não atende ao requisito de "módulo
  MIDI-USB" (seria sem fio, não USB).
- ESP32 clássico + Hairless MIDI (serial-to-MIDI): funcional mas depende de
  software rodando no PC, não é plug-and-play.

## 2026-08-20 — Toolchain: PlatformIO

**Decisão**: desenvolver o firmware com PlatformIO (não Arduino IDE).

**Contexto/Racional**: projeto de longa duração, com múltiplas bibliotecas e
necessidade de builds reprodutíveis e bom versionamento das dependências junto
com o código no Git. PlatformIO tem melhor suporte a isso e integra bem com
VSCode.

**Nota de setup**: o PlatformIO CLI ainda não está instalado na máquina de
desenvolvimento no momento da criação do projeto — precisa ser instalado antes
da primeira compilação (via extensão do VSCode ou `pip install platformio`).

**Alternativas descartadas**:
- Arduino IDE: mesmo fluxo dos exemplos originais da HelloDrum-lib, porém pior
  controle de versão de dependências e menos adequado a um projeto que também
  terá firmware + interface desktop versionados juntos.

## 2026-08-20 — Biblioteca base: fork + vendorização

**Decisão**: usar [HelloDrum-arduino-Library](https://github.com/RyoKosaka/HelloDrum-arduino-Library)
como base, mas vendorizada (copiada) em `firmware/lib/HelloDrum-arduino-Library`
dentro do próprio repositório do projeto, em vez de depender dela como submodule
ou dependência externa intocada.

**Contexto/Racional**: o projeto provavelmente vai precisar de modificações na
biblioteca (ex: integração mais direta com USB-MIDI nativo do ESP32-S3, ajustes
para o esquema de 4 MUXes / 32 canais, integração com a tela OLED e fluxo de
configuração custom). Vendorizar permite modificar livremente e documentar essas
mudanças, sem ficar preso à estrutura de um submodule Git ou depender de PRs
aceitos no repositório original.

**Importante**: qualquer modificação feita na cópia vendorizada da lib deve ser
registrada em [03-biblioteca-hellodrum.md](03-biblioteca-hellodrum.md), na seção
"Modificações em relação ao original", para não perdermos rastro do que é
biblioteca original vs. código nosso.

**Alternativas descartadas**:
- Dependência externa (git submodule ou `lib_deps` do PlatformIO apontando pro
  repo original): manteria a lib "limpa", mas dificultaria modificações
  necessárias no código dela.

## 2026-08-20 — Multiplexação: 4x CD4051 nativamente suportado

**Decisão**: usar a classe `HelloDrumMUX_4051` da própria biblioteca, criando 4
instâncias (uma por chip CD4051), sem necessidade de modificar a lib para isso.

**Contexto/Racional**: ao ler o código-fonte (`hellodrum.cpp`), descobrimos que:
- Existe um array estático global `rawValue[64]` quando compilado para ESP32
  (comentário no código: "8 * 8channel Mux"), ou seja, já suporta até 8 MUXes
  CD4051 (64 canais) nativamente.
- Cada instância de `HelloDrumMUX_4051` recebe um `muxNum` sequencial automático
  (variável estática `muxIndex`, incrementada no construtor) — o 1º MUX
  instanciado no código é `muxNum = 0`, o 2º é `muxNum = 1`, etc.
- O método `scan()` de cada MUX escreve os valores lidos em
  `rawValue[muxNum*8 .. muxNum*8+7]`.
- **Porém**: o construtor de `HelloDrum` (pad) com 1 argumento (`HelloDrum pad(pin1)`)
  usa esse `pin1` diretamente como índice em `rawValue`, **sem aplicar o offset do
  MUX automaticamente**. Ou seja, para pads ligados ao 2º, 3º ou 4º MUX, o índice
  passado deve ser calculado manualmente como `muxNum * 8 + canal_local` (ex: pad
  no canal 3 do 3º MUX instanciado → `HelloDrum pad(2*8 + 3)` = `HelloDrum pad(19)`).
  Isso deve ficar claro no código do firmware (idealmente com uma constante/helper
  que deixe esse cálculo explícito, em vez de números mágicos).

**Conclusão prática**: não é necessário modificar a biblioteca para suportar 4x
CD4051 / 32 canais — é uma questão de uso correto da API existente.

## 2026-08-20 — USB-MIDI nativo: Adafruit TinyUSB + FortySevenEffects MIDI Library

**Decisão**: implementar o envio MIDI usando `Adafruit_USBD_MIDI` (biblioteca
`Adafruit TinyUSB Library`) como transporte da `MIDI Library` (FortySevenEffects,
a mesma já usada nos exemplos originais da HelloDrum-lib) — via
`MIDI_CREATE_INSTANCE(Adafruit_USBD_MIDI, usb_midi, MIDI)`. Isso mantém a mesma
API (`MIDI.sendNoteOn()`/`sendNoteOff()`) já usada no código de sensing, só
trocando o transporte de Serial/BLE para USB nativo.

**Contexto/Racional**: o core `arduino-esp32` (verificamos a v3.20017, instalada
no ambiente de dev) não expõe uma classe Arduino de alto nível para USB-MIDI —
só `USBCDC` e `USBMSC`. A camada MIDI só existe no nível baixo do TinyUSB
(`tinyusb/src/class/midi/midi_device.h`, dentro do próprio core). A
`Adafruit_TinyUSB_Arduino` é a forma prática e testada pela comunidade de obter
uma classe MIDI USB de alto nível no ESP32-S3, confirmada lendo o exemplo oficial
`examples/MIDI/midi_test/midi_test.ino` do repositório.

**Configuração de build necessária** (`firmware/platformio.ini`):
- `-D ARDUINO_USB_MODE=0` — muda o modo USB do ESP32-S3 de "Hardware CDC and
  JTAG" (padrão do board `esp32-s3-devkitc-1`, que é `ARDUINO_USB_MODE=1`) para
  "USB-OTG (TinyUSB)", necessário para expor classes USB customizadas como MIDI.
  Confirmado direto no `boards.txt` do core instalado (menu "USB Mode").
- `-D ARDUINO_USB_CDC_ON_BOOT=1` — mantém uma interface CDC (Serial) ativa desde
  o boot, para continuarmos com debug via Serial monitor mesmo com o dispositivo
  USB composto (CDC + MIDI).

**Problema encontrado e contornado — conflito de linker**: o core `arduino-esp32`
3.x já embute uma TinyUSB pré-compilada (`libarduino_tinyusb.a`, usada
internamente por `USB.cpp`/`USBCDC.cpp`/`USBMSC.cpp`) e a `Adafruit TinyUSB
Library` compila a sua própria a partir do código-fonte — as duas juntas
duplicam símbolos (`tusb.c`, `usbd.c`, `usbd_control.c`, etc) e o link falha
("multiple definition of ..."). Contornado adicionando
`-Wl,--allow-multiple-definition` aos `build_flags`, que faz o linker manter a
primeira definição encontrada (a da Adafruit, confirmado pela ordem nas
mensagens de erro antes da correção). Esse é um conflito conhecido dessa
combinação de versões (core 3.x + Adafruit TinyUSB no ESP32), não um bug do
nosso código.

**Status de validação**: o firmware **compila e linka com sucesso**
(RAM 11.1%, Flash 9.5% no `esp32-s3-devkitc-1`), mas **ainda não foi testado em
hardware real** — não temos como confirmar que o dispositivo enumera
corretamente como USB-MIDI (e que o Serial via CDC continua funcionando
simultaneamente, já que é um dispositivo composto) até termos a bancada
montada. Isso é o próximo passo de validação quando o hardware estiver pronto.

**Alternativas descartadas**:
- Implementar a classe MIDI diretamente sobre a API TinyUSB de baixo nível já
  embutida no core (`esp32-hal-tinyusb.c`), no estilo do que `USBCDC.cpp`/
  `USBMSC.cpp` fazem para suas respectivas classes. Mais trabalho manual
  (descritores USB, callbacks de classe) e sem exemplo de referência pronto —
  descartado em favor da solução já testada pela comunidade.

## 2026-08-20 — Tela: TFT ST7735 (SPI) em vez de OLED SSD1306 (I2C)

**Decisão**: usar uma tela TFT 1.44" 128x128, driver ST7735S, interface SPI
(modelo definido pelo usuário por preço — foto em `Modelo Tela.jpeg` na raiz do
projeto), em vez do OLED SSD1306/I2C previsto inicialmente (que era só o
componente usado nos exemplos da HelloDrum-lib, não um requisito do projeto).

**Contexto/Racional**: o requisito original (item 2 do escopo) era só "prever
possibilidade de tela + botões de configuração" — o componente específico
ficou em aberto até o usuário encontrar um modelo com bom preço. A troca para
SPI (em vez de I2C) muda o pinout (6 sinais dedicados: SCL/SCK, SDA/MOSI, RES,
DC, CS, BLK — vs. 2 pinos compartilhados de I2C) e a biblioteca a usar: a
`u8g2` (usada nos exemplos originais da lib) é focada em displays
monocromáticos e não é a escolha natural para uma TFT RGB colorida.

**Biblioteca escolhida**: `Adafruit GFX Library` + `Adafruit ST7735 and
ST7789 Library` — API simples via construtor (`Adafruit_ST7735(cs, dc, rst)`),
sem exigir edição de arquivo de configuração dentro da lib (diferente da
`TFT_eSPI`, que exige customizar `User_Setup.h` ou definir dezenas de
`build_flags` equivalentes). Como o uso aqui é uma tela de configuração (texto,
menus, valores) e não algo performance-crítico, a simplicidade da Adafruit
pesou mais que a velocidade extra da TFT_eSPI.

**A fazer quando implementarmos o código da tela (Fase C)**:
- Adicionar `lib_deps` no `platformio.ini` (`adafruit/Adafruit GFX Library`,
  `adafruit/Adafruit ST7735 and ST7789 Library`).
- Validar se o pino BLK (backlight) fica fixo em 3.3V ou controlado por GPIO
  (permite dimming/desligar a tela).

**Alternativas descartadas**:
- Manter OLED SSD1306/I2C: descartado porque o usuário já encontrou/comprou
  (ou está prestes a) o modelo TFT por preço.
- `TFT_eSPI`: mais rápida (usa DMA/SPI otimizado para ESP32) mas exige mais
  configuração inicial; guardado como alternativa caso a Adafruit se mostre
  lenta demais na prática (o que não é esperado para uma tela de config).

## 2026-08-20 — Navegação: 2 encoders rotativos com chave (em vez de 5 botões)

**Decisão**: usar 2 encoders rotativos com chave (push-button) para navegar e
editar a configuração, em vez dos 5 botões discretos (EDIT/UP/DOWN/NEXT/BACK)
que a classe `HelloDrumButton` pressupõe nos exemplos originais da lib.

**Mapeamento adotado**:
- **Encoder 1 (pad/valor)** — rotação: navega entre pads (fora do modo de
  edição) ou ajusta o valor do parâmetro selecionado (dentro do modo de
  edição) — o comportamento já muda automaticamente conforme o estado interno
  da lib, sem lógica extra nossa. Chave: entra/confirma a edição do item atual
  (equivalente ao botão EDIT/SET).
- **Encoder 2 (item/parâmetro)** — rotação: navega entre os parâmetros do pad
  selecionado (SENSITIVITY, THRESHOLD, SCAN TIME, ..., NOTE) — equivalente aos
  botões NEXT/BACK. Chave: sem função definida ainda (reservada).

**Contexto/Racional**: a lib já expõe exatamente o ponto de extensão certo
para isso — `HelloDrumButton::readButton(bool set, bool up, bool down, bool
next, bool back)` — um overload que recebe os 5 sinais diretamente, em vez de
`readButtonState()` (que leria botões físicos via `digitalRead()` nos pinos do
construtor). Não precisamos modificar a lib: o `main.cpp` lê os 2 encoders
(via a lib `mathertel/RotaryEncoder`, decodificação em quadratura por
interrupção) e a chave de cada um (debounce simples por tempo), traduz cada
evento (giro ou clique) em um "pulso" momentâneo de um dos 5 sinais (LOW só
durante a chamada em que o evento ocorreu, HIGH nas demais — imita uma
pressionada rápida de botão físico) e chama `readButton()` manualmente a cada
`loop()`. `HelloDrum::settingEnable()` (chamado para todos os pads a cada
`loop()`, como nos exemplos originais) continua lendo os mesmos sinais
internamente, sem saber a diferença entre um botão físico e um encoder.

O construtor de `HelloDrumButton` ainda exige 5 pinos, mas como nunca chamamos
`readButtonState()` (só `readButton()` manualmente), esses pinos nunca são
lidos — usamos `255` como placeholder.

**Bug/pegadinha encontrada durante a implementação**: `HelloDrum::settingName()`
não é só cosmético — além de guardar o nome do pad em `showInstrument[]`, ele
incrementa `nameIndexMax` (variável global da lib que limita até onde a
navegação entre pads pode ir). Sem chamar `settingName()` uma vez por pad na
inicialização, `nameIndexMax` fica 0 e a navegação via encoder fica travada no
pad 0. Além disso, `settingName()` guarda o **ponteiro** que recebe (não copia
a string) — por isso os nomes dos pads (`"Pad 1"`, `"Pad 2"`, ...) são escritos
num buffer `static`/global (`padNames[NUM_PADS][8]` em `main.cpp`) que dura o
programa todo, e não num buffer temporário de escopo local (que causaria um
ponteiro pendente/lixo de memória depois de sair do loop de setup).

**Biblioteca escolhida para os encoders**: `mathertel/RotaryEncoder` —
decodificação em quadratura testada e estável, funciona bem por interrupção
(`attachInterrupt` + `tick()` nos pinos A/B de cada encoder), sem exigir
hardware dedicado (PCNT) do ESP32.

**Status de validação**: build compila e linka com sucesso. **Ainda não
testado em hardware real** — nem os encoders, nem a tela, nem os 4x CD4051
foram montados na bancada até agora. Pontos que só dão pra confirmar com
hardware real: sentido de giro dos encoders (CW/CCW pode estar invertido
dependendo da fiação — fácil de corrigir trocando A/B ou invertendo o sinal no
código), e se o `LatchMode::FOUR3` é o mais adequado para o modelo de encoder
usado (pode precisar de `FOUR0` dependendo do encoder).

**Alternativas descartadas**:
- 5 botões discretos (EDIT/UP/DOWN/NEXT/BACK), como nos exemplos originais da
  lib: descartado por preferência do usuário (encoders dão uma navegação mais
  compacta e fluida com menos componentes físicos no painel).
- Usar a chave do encoder 2 para alguma função imediatamente: deixada em
  aberto por enquanto (reservada) até surgir uma necessidade concreta (ex:
  atalho para "salvar tudo"/"voltar pra tela inicial").
