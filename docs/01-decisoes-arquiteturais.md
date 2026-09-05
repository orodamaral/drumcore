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

> **Atualização (Fase K, 2026-08-21)**: essa decisão foi revertida — o
> projeto passou a usar 2x CD4067 (`HelloDrumMUX_4067`) em vez de 4x CD4051.
> Ver entrada "Fase K" no final deste documento. Mantida aqui como registro
> histórico do porquê o CD4051 foi escolhido originalmente (era o chip que
> a lib já suportava nativamente) — os fatos técnicos descritos abaixo sobre
> `rawValue[]`/`muxIndex`/offset manual continuam corretos, só que agora
> aplicados à classe `_4067` (16 canais por MUX, não 8).

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

> **Atualização (Fase J, 2026-08-21)**: mapeamento de rotação/clique
> redesenhado por completo pra navegação de 6 telas — ver entrada "Fase J"
> mais abaixo. **Atualização (Fase Y, 2026-09-04)**: reduzido de 2
> encoders pra 1 só (rotate navega, click desce um nível/confirma, hold
> sobe um nível) — ver entrada "Fase Y". Mantida aqui como registro
> histórico do porquê os encoders (2, na época) foram escolhidos no lugar
> dos 5 botões originais da lib — esse racional continua válido mesmo com
> 1 encoder só.

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

## 2026-08-20 — Persistência: EEPROM (NVS) com flag de primeiro boot

**Decisão**: ativar `EEPROM_ESP` (já presente na lib, wrapper sobre NVS do
ESP32) com um layout de 10 bytes por pad (320 bytes pros 32 pads) + 1 byte
extra usado como flag de "já inicializado" (endereço `NUM_PADS*10`, valor
mágico `0xA5`). No `setup()`: se a flag não bater, chama
`HelloDrum::initMemory()` pra cada pad (grava os valores padrão em EEPROM);
senão, chama `HelloDrum::loadMemory()` (restaura o que foi salvo, incluindo
edições feitas via os encoders em boots anteriores).

**Contexto/Racional**: adiamos isso nas Fases A-C de propósito (ver entrada de
2026-08-20 sobre USB-MIDI/Fase C) porque ativar `EEPROM_ESP.begin()` sem um
fluxo de primeiro-boot deixaria `sensitivity`/`threshold1`/etc como `0` (bytes
não inicializados do NVS), o que quebra o sensing (threshold 0 = dispara com
qualquer ruído). A flag de primeiro boot resolve isso: só usamos os valores
lidos da EEPROM depois de termos certeza que ela foi gravada com
`initMemory()` alguma vez.

As escritas feitas durante o uso normal (girar o encoder em modo de edição)
**não precisam de nenhum código nosso** — `HelloDrum::settingEnable()` já
escreve e comita no EEPROM sozinho a cada mudança (é assim que a lib original
já funciona com botões físicos; com os encoders é a mesma coisa, já que
alimentamos os mesmos sinais via `readButton()`).

**Bug encontrado e corrigido na lib vendorizada**: no branch de incremento
(UP) do item SENSITIVITY (item 0) dentro de `settingEnable()`, o endereço de
EEPROM usado era `padNum * 8` — inconsistente com **todos** os outros 9 itens
e com o branch de decremento (DOWN) do próprio item 0, que usam
`padNum * 10`. Isso faria incrementar a sensibilidade de qualquer pad com
`padNum >= 1` sobrescrever um byte de EEPROM de **outro** pad (ex: pad 1
gravaria no endereço 8, que é o campo `noteRim` do pad 0). Corrigido para
`padNum * 10` nos dois branches (ESP32 e AVR) em `hellodrum.cpp`. Esse bug só
foi percebido agora porque a Fase D foi a primeira vez que a persistência
ficou realmente ativa — nas fases anteriores as escritas eram sempre
no-ops silenciosos (EEPROM nunca inicializada).

**Status de validação**: build compila e linka. **Teste em hardware real
ainda pendente** — falta confirmar que os valores realmente persistem entre
reboots (não temos como simular reboot com NVS real sem a placa física).

**Alternativas descartadas**:
- Detectar "primeiro boot" checando se `sensitivity == 0` (em vez de uma flag
  dedicada): descartado por ser um heurística frágil — um valor legítimo
  poderia coincidir, e não cobre todos os campos.

## 2026-08-20 — Interface desktop: Electron + React/TypeScript, protocolo NDJSON via Serial

**Decisão**: interface desktop em Electron + React + TypeScript (build via
`electron-vite`), comunicando com o módulo por porta serial USB-CDC usando um
protocolo texto linha-a-linha em JSON (NDJSON) — não MIDI SysEx.

**Contexto/Racional**: perguntado diretamente ao usuário (duas decisões sem
trade-off óbvio a favor de uma só opção):
- **Stack**: Electron+React foi escolhido entre as opções apresentadas
  (Python+Qt, .NET/WPF-Avalonia, Tauri+React) — UI web é um bom encaixe pra
  uma tela com grid de 32 pads x ~6 parâmetros cada, e Electron empacota bem
  pra Windows.
- **Protocolo**: Serial+JSON em vez de MIDI SysEx — o módulo já expõe uma
  porta CDC desde a Fase B (`ARDUINO_USB_CDC_ON_BOOT=1`), sem custo extra, e é
  muito mais simples de implementar/debugar dos dois lados (dá pra testar com
  qualquer terminal serial, sem precisar decodificar SysEx). O contrato
  completo está em [04-protocolo-serial.md](04-protocolo-serial.md).

**Firmware (Fase E)**: adicionada a lib `bblanchon/ArduinoJson` e um
protocolo NDJSON sobre a mesma porta Serial já usada desde a Fase B — todo o
tráfego (comandos, respostas, eventos de hit, logs de boot) passou a ser
JSON, uma linha por objeto. Antes disso, os eventos de hit e as mensagens de
boot eram `Serial.print` em texto livre; converter tudo pra JSON evita ter
que filtrar/distinguir linhas de debug de linhas de protocolo do lado do app.
Leitura da porta serial no firmware é não-bloqueante (acumula caracteres até
`\n` a cada `loop()`, sem usar `Serial.readStringUntil()` com timeout, que
pausaria o sensing/MIDI).

**"Modo demo"**: o app tem uma opção de simular o módulo inteiramente no
renderer (`mockDevice.ts`), sem tocar em porta serial nenhuma — permite
validar/demonstrar a UI antes do hardware estar montado (mesma lógica por
trás de termos priorizado "compila e builda" como critério de validação em
todas as fases do firmware).

**Vulnerabilidades de dependências corrigidas antes de seguir**: o scaffold
inicial (`electron@^31`, `vite@^5`) tinha CVEs conhecidos (Electron: várias
falhas de sandbox/IPC; esbuild/vite: servidor de dev expondo requisições a
qualquer site). Atualizado para `electron@^43`, `vite@^7`, `@vitejs/plugin-
react@^5.2` (a v6 do plugin-react exige vite^8, que por sua vez não é
suportado pelo `electron-vite@^5` ainda — ver changelog do `electron-vite`
antes de tentar subir pra vite 8). `npm audit` limpo (0 vulnerabilidades)
nessa combinação de versões.

**Status de validação**: `npm run typecheck` e `npm run build` passam limpo.
**Nunca testado com o módulo real** (sem hardware) — só o modo demo foi
exercitado, e mesmo assim não com uma execução real de `npm run dev` (só
build estático) nesta sessão.

**Alternativas descartadas**:
- Python + PySide6, .NET (WPF/Avalonia), Tauri+React: alternativas viáveis,
  descartadas só por preferência do usuário nessa decisão, não por algum
  defeito técnico.
- MIDI SysEx como protocolo de config: mais "elegante" (um único cabo/
  interface), mas mais complexo dos dois lados e sem nenhum parsing de SysEx
  já implementado no firmware — descartado em favor de Serial+JSON.

## 2026-08-20 — Nome livre por pad, editável só pelo app desktop

**Decisão**: cada pad ganha um "label" de texto livre (ex: `"Caixa"`),
persistido em EEPROM, editável **exclusivamente** via o app desktop (comando
`set_pad` com `field: "label"`, protocolo serial). O número do pad nunca é
editável. O nome exibido (tela TFT e app) é sempre `"N - label"` (1-based) ou
só `"Pad N"` enquanto nenhum label tiver sido definido.

**Contexto/Racional**: pedido direto do usuário. A escolha de "só pelo app
desktop" (não pelos encoders/TFT) evita ter que resolver entrada de texto
numa tela de 128x128 com 2 encoders (giro+clique não dá um jeito natural de
digitar texto livre sem inventar um teclado on-screen) — um teclado
físico+mouse no desktop já resolve isso de forma trivial.

**Implementação**:
- Firmware: `padLabels[NUM_PADS][20]` (texto livre) + `padNames[NUM_PADS][28]`
  (nome final formatado, é o que a lib recebe via `settingName()`) em
  `main.cpp`. `rebuildPadName(i)` recalcula `padNames[i]` a partir de
  `padLabels[i]` sempre que o label muda. Como `padNames[i]` é um buffer
  mutável (não um `const char*` fixo), atualizar seu conteúdo já reflete
  automaticamente no que `HelloDrumButton::GetPadName()` devolve (usado pela
  tela) — não precisa chamar `settingName()` de novo.
- EEPROM: layout extendido com mais `NUM_PADS * 20` bytes (20 bytes fixos por
  pad, incluindo terminador nulo) depois da flag de primeiro-boot já
  existente (Fase D). Usa `EEPROM_ESP.readBytes()`/`writeBytes()` (slots de
  tamanho fixo, mais simples que `readString()`/`writeString()` pra esse
  caso).
- Protocolo: reaproveitado o comando `set_pad` já existente (campo `field`
  agora aceita `"label"` além dos numéricos), em vez de criar um comando
  novo tipo `set_pad_name` — mantém o protocolo mais uniforme. Único ponto
  assimétrico: `set_pad` com campos numéricos responde com `ack`, mas com
  `field: "label"` responde com o `pad_config` inteiro (mais útil pro app já
  receber o `name` recalculado, e evita inventar um tipo de resposta só pra
  string). Documentado em [04-protocolo-serial.md](04-protocolo-serial.md).

**Efeito colateral (não era o objetivo, mas é consequência direta)**: como a
tela TFT também usa `GetPadName()` pra exibir o nome do pad selecionado, um
pad renomeado via o app aparece com o nome novo na tela física também, sem
código extra — é o mesmo dado, uma única fonte de verdade.

**Status de validação**: build/typecheck do firmware e do app passam limpo.
**Nada testado em hardware real.**

**Alternativas descartadas**:
- Comando dedicado `set_pad_name` (em vez de reaproveitar `set_pad` com
  `field: "label"`): descartado pra não duplicar a validação de `pad` e
  manter só um comando de "alterar campo de um pad".
- Permitir renomear pelos encoders também: descartado pelo próprio usuário
  (edição de texto livre com 2 encoders é uma UX ruim sem um teclado
  on-screen, que não estava no escopo).

## 2026-08-20 — Tipos de sensor: todos os 8, topologia de canais configurável pelo app

**Decisão**: implementar os 8 tipos de sensor documentados pela
HelloDrum-lib (ver [05-tipos-de-sensor.md](05-tipos-de-sensor.md) pro
detalhamento), com a topologia (qual canal é qual tipo, e quais 2 canais
formam um pad de 2 zonas) configurável em runtime só pelo app desktop,
persistida em EEPROM — mesmo padrão já usado pro nome do pad (Fase F).

**Contexto/Racional**: perguntado diretamente ao usuário (duas decisões de
escopo genuinamente abertas — quantos tipos implementar, e onde configurar a
topologia). Escolhido o escopo mais completo porque a lógica de sensing em
si já existe pronta na lib (não precisávamos escrever isso do zero) — o
trabalho real foi o despacho por tipo e a modelagem da topologia.

**O problema central**: o construtor de `HelloDrum` (`pin_1`/`pin_2`) só
aceita pinos no momento da construção — não existe setter público pra
trocar os canais de um pad depois de criado. Isso pareceria exigir destruir
e reconstruir objetos `HelloDrum` toda vez que o usuário mudasse o tipo de
um pad via o app (arriscado e complicado em C++ embarcado).

**Solução**: construir **todos** os 32 objetos `HelloDrum` já com 2 pinos
desde o boot (`HelloDrum(i, i+1)` para `i` de 0 a 30, e `HelloDrum(31)` pro
último, que não tem `i+1`). Métodos de sensing de 1 canal (`singlePiezoMUX()`,
`hihatControlMUX()`, etc) simplesmente nunca leem `pin_2` — não há problema
em ele "existir" sem ser usado. Métodos de 2 canais (`dualPiezoMUX()`,
`cymbal2zoneMUX()`, etc) leem `pin_2` normalmente. Resultado: **nunca
precisamos reconstruir nada** — trocar o tipo de um pad em runtime é só
trocar qual método chamamos nele a cada `loop()` (`dispatchSensing()` em
`main.cpp`), uma tabela de despacho baseada num `byte padTypes[32]` que o
app pode alterar livremente.

**Canais consumidos**: quando `padTypes[i]` é um tipo de 2 canais, o canal
`i+1` fica "consumido" — não é sensoreado nem exposto como pad
independente. Isso é **derivado**, não guardado explicitamente: uma função
`recomputeChannelPrimary()` recalcula um array `bool channelPrimary[32]`
toda vez que algum `padTypes[]` muda, percorrendo os canais em ordem (canal
`i` é consumido se o canal `i-1` for primário **e** seu tipo usar 2 canais -
recursão de profundidade 1 só, já que nenhum tipo usa mais de 2 canais, não
há como formar correntes de 3+). Trocar um pad de volta pra um tipo de 1
canal libera o seguinte automaticamente, sem nenhuma limpeza manual.

**Restrição no encoder/TFT**: `nameIndex`/`nameIndexMax` (globais internas
da lib) não são resetáveis de fora de `hellodrum.cpp` (mesmo problema de
`static` com linkage interno já documentado na entrada de
2026-08-20 sobre encoders). Por isso, `settingName()` continua sendo chamado
pra todos os 32 canais no boot (não só os primários) — a navegação pelos
encoders sempre alcança as 32 posições, mas ao chegar num canal consumido a
tela mostra "Canal ocupado" em vez de item/valor (`renderScreen()` usa
`currentPadIndex()` — um truque de comparação de ponteiro, já que não existe
getter pra ler o `nameIndex` bruto: como `GetPadName()` devolve exatamente o
mesmo ponteiro que passamos em `settingName(padNames[i])`, comparar
`padNames[i] == button.GetPadName()` recupera o índice atual de forma
confiável).

**Hi-hat = 2 pads linkados**: a lib não faz a ligação entre o pedal
(`hihatControlMUX()`/`TCRT5000MUX()`, que atualizam `openHH`/`closeHH`) e o
prato/chimbal em si (`HHMUX()`/`HH2zoneMUX()`, que **não** olham esses
campos - confirmado lendo `FSRSensing()`/`TCRT5000Sensing()` e
`singlePiezoSensing()`/`cymbal2zoneSensing()` em `hellodrum.cpp`). Por isso
os tipos de chimbal (2/4) ganharam um campo `hihat_pedal_channel` (índice de
outro pad, tipo 6 ou 7) — nosso próprio código (`handlePadResult()`) lê o
`openHH` do pad linkado pra decidir qual nota usar. Sem link, assume "sempre
aberto".

**Limitação herdada e simplificação feita**: a lib só tem 3 slots de nota
independentes por pad (`note`/`note_rim`/`note_cup`), e `note_rim` seta 4
campos internos da lib pro mesmo valor de uma vez (`noteRim`, `noteEdge`,
`noteClose`, `noteOpenEdge` — mesmo aliasing que `settingEnable()` já faz).
Isso significa que não dá pra ter uma nota diferente pra "borda com o
chimbal aberto" vs "fechado" — os dois usariam o mesmo valor. Simplificamos
o despacho do chimbal 2 zonas pra refletir isso honestamente: só a zona do
corpo (bow) distingue aberto/fechado; a borda usa sempre `note_rim`,
independente do estado do pedal. Ver
[05-tipos-de-sensor.md](05-tipos-de-sensor.md).

**Status de validação**: build/typecheck do firmware e do app passam limpo.
**Nada testado em hardware real** — em especial, não temos como confirmar a
faixa real de `pad.pedalCC` nem o comportamento de `HH2zoneMUX()` num
chimbal físico 2 zonas de verdade.

**Alternativas descartadas**:
- Reconstruir os objetos `HelloDrum` dinamicamente (`new`/`delete`) quando o
  tipo de um pad muda: tecnicamente possível no ESP32, mas mais arriscado e
  sem necessidade real, dado que construir todos com 2 pinos desde o início
  resolve o mesmo problema de forma mais simples.
- Deixar a topologia fixa no código-fonte (não configurável em runtime):
  descartado pelo usuário — o objetivo é poder reconfigurar o kit sem
  recompilar/reflashear.
- Permitir canais não-adjacentes formarem um pad de 2 zonas (ex: canal 3 +
  canal 20): descartado por complexidade desproporcional ao ganho — a
  convenção "sempre o canal seguinte" já resolve o problema de forma simples
  e o usuário só precisa cabear o 2º sensor no próximo slot do MUX.

## 2026-08-20 — BLE-MIDI como transporte adicional (simultâneo ao USB-MIDI)

**Decisão**: enviar todo hit/CC tanto por USB-MIDI (Fase B) quanto por
BLE-MIDI, simultaneamente — não é um "modo" que se escolhe, os dois
transportes ficam sempre ativos, e o BLE só efetivamente transmite quando
houver um dispositivo pareado.

**Contexto/Racional**: o pedido foi "implementar também o modo BLE-MIDI" —
li isso como "adicionar", não "substituir". Como os dois transportes usam
periféricos independentes do ESP32-S3 (USB OTG vs. rádio 2.4GHz) e a
biblioteca já expõe um jeito de saber se há alguém pareado
(`setHandleConnected`/`setHandleDisconnected`), simultâneo ficou mais simples
de implementar do que um esquema de troca de modo (que exigiria persistir
"modo atual" em EEPROM, expor isso no protocolo/app, etc. — sem ganho claro
já que os dois cabem ao mesmo tempo).

**Biblioteca escolhida**: `lathoub/Arduino-BLE-MIDI` (BLE-MIDI 1.0), a mesma
que os exemplos originais da HelloDrum-lib já usam
(`examples/BLE/SimpleSensing_BLEMIDI`, `examples/MUX/muxSensing_BLEMIDI`) —
confirmei a API lendo esses exemplos e o código-fonte da lib direto do
GitHub antes de escrever qualquer coisa. Ela usa a mesma `MIDI Library`
(FortySevenEffects) que já usávamos pro USB, só troca o transporte — mesmo
padrão da Fase B (Adafruit_USBD_MIDI).

**Bluedroid em vez de NimBLE**: essa lib suporta duas stacks BLE no ESP32,
escolhidas por qual header se inclui — `hardware/BLEMIDI_ESP32.h` (Bluedroid,
já embutida no core `arduino-esp32`, sem dependência extra) ou
`hardware/BLEMIDI_ESP32_NimBLE.h` (precisa da lib `h2zero/NimBLE-Arduino`
separada). Escolhemos Bluedroid pra não introduzir mais uma dependência de
terceiros com compatibilidade de versão incerta com o nosso core (3.20017) —
NimBLE é mais leve em RAM/flash e geralmente recomendado pra projetos novos,
mas nosso orçamento de recursos já está confortável mesmo com Bluedroid (ver
abaixo), então não valeu a pena o risco extra agora. Trocar pra NimBLE depois
é só troca de `#include`, as macros (`BLEMIDI_CREATE_INSTANCE`) são
idênticas nos dois casos.

**Evitando colisão de nomes**: `BLEMIDI_CREATE_DEFAULT_INSTANCE()` (usada
nos exemplos originais) cria uma variável chamada `MIDI` — colidiria com o
`MIDI` que já usamos pro USB. Usamos `BLEMIDI_CREATE_INSTANCE("DrumCore",
BleMidi)` em vez do default — isso nomeia a interface MIDI como `BleMidi` e,
como efeito colateral da macro, cria também um objeto de transporte chamado
`BLEBleMidi` (prefixo `BLE` + nome escolhido) — é nele (não em `BleMidi`)
que registramos os callbacks de conexão. `"DrumCore"` é o nome anunciado via
Bluetooth (o que aparece ao parear).

**Consumo de recursos**: build antes de adicionar BLE — RAM 11.9%, Flash
10.9%. **Depois** — RAM 19.8%, Flash 30.0% (de 327680 bytes de RAM e
3342336 bytes de Flash disponíveis). O salto grande é em Flash (a stack
Bluedroid é pesada), mas
ainda com bastante margem no board N8 (8MB). Nenhum conflito de biblioteca
apareceu — o `library.properties` da BLE-MIDI declara `NimBLE-Arduino` e
`ArduinoBLE` como dependências (usadas só pelas variantes de hardware que
não usamos), mas o LDF do PlatformIO (modo "chain", segue os `#include`
reais) não tentou puxar nenhuma das duas.

**Status de validação**: build compila e linka com sucesso. **Nada testado
em hardware real** — isso é ainda mais especulativo que as fases anteriores,
porque compilar não garante que USB-MIDI e BLE-MIDI realmente coexistem em
runtime sem briga de stack/watchdog, nem que o pareamento (a lib usa
`ESP_LE_AUTH_BOND`, ou seja, pede bonding) funciona de primeira em iOS/
Android/Windows. Validar isso é o próximo passo assim que houver hardware.

**Alternativas descartadas**:
- Modo único selecionável (USB *ou* BLE, não os dois): descartado — mais
  complexidade (persistência de modo, UI pra trocar) sem necessidade, já
  que os dois transportes cabem ativos ao mesmo tempo sem conflito aparente.
- NimBLE-Arduino: mais leve, mas dependência extra de terceiros sem
  necessidade imediata dado que Bluedroid já cabe confortavelmente no
  orçamento de flash/RAM atual — guardado como alternativa se surgir
  problema real de recursos ou estabilidade em hardware.

## 2026-08-20 — Tela inicial (grid de pads) + velocímetro na configuração

**Decisão**: a tela TFT ganhou dois estados novos — uma **tela inicial**
(grid 8x4 com o número de cada pad, que acende verde ao ser atingido) que
aparece quando o módulo está ocioso, e um **velocímetro** (arco + agulha)
na tela de configuração, mostrando visualmente onde o valor atual do
parâmetro cai entre o mínimo e o máximo.

**Contexto/Racional**: pedido direto do usuário, pra tornar a tela mais
"bonitinha"/útil no dia a dia (ver ela tocando em vez de só um menu estático
de configuração). O grid 8x4 não é arbitrário — mapeia direto pra `i =
mux*8 + canal`, então cada LINHA do grid corresponde a um CD4051 físico. Não
tentamos mostrar `padType`/consumo de canal nessa tela (ficaria poluído) —
canais consumidos simplesmente nunca acendem (nunca recebem hit), o que já
é auto-explicativo na prática.

**Transição entre telas**: baseada em tempo sem interação
(`lastConfigInteractionMs`, atualizado em `processConfigInput()` a cada
evento real de qualquer encoder) — depois de `IDLE_TIMEOUT_MS` (4s) sem
nenhum giro/clique, a tela volta pro grid. Qualquer interação leva de volta
pra tela de configuração imediatamente. Não distinguimos "está editando" vs
"só navegando" pra esse timeout — qualquer input já reseta o relógio, então
não há risco de a tela "fugir" pro grid no meio de um ajuste de valor.

**Velocímetro sem suporte nativo a arco**: a Adafruit_GFX não tem desenho
de arco — aproximamos com segmentos de reta via trigonometria (5 marcas
fixas + 1 agulha, arco de 150° a 30°, abrindo pra baixo — visual clássico
de painel). Implementado em `drawGauge()`.

**De onde vem o min/max de cada parâmetro**: a lib não expõe isso
estruturado (só o rótulo em texto via `GetSettingItem()`), então
`getGaugeRange()` decide a faixa por *substring* no rótulo (`"SENS"` /
`"THRE"` / `"SCAN"` / `"MASK"` → 1-100, `"CURVE"` → 0-4, `"NOTE"` → 0-127) —
cobre todos os rótulos que existem nos arrays `item[]`/`itemD[]`/
`itemCY2[]`/`itemCY3[]`/`itemHH[]`/`itemHH2[]`/`itemHHC[]` de `hellodrum.h`
(confirmado lendo cada um). No app desktop isso já existe de forma
estruturada (`FieldSpec.min`/`.max` em `protocol.ts`), então o simulador usa
essa fonte diretamente, sem precisar do hack de substring.

**Simulador atualizado em paralelo**: `HardwareSimulator.tsx` replica os
dois estados novos (grid com hits simulados periodicamente, velocímetro via
SVG) usando as mesmas constantes de tempo (`IDLE_TIMEOUT_MS`,
`PAD_FLASH_MS`) pra ficar fiel ao firmware (esse simulador — e o doc que o
descrevia — foi removido do app desktop em 2026-09-04, ver Fase Y mais
abaixo).

**Status de validação**: build/typecheck do firmware e do app passam
limpo. **Nada testado em hardware real** — em especial, a legibilidade do
velocímetro numa tela física de 1.44" (bem menor que a visualização em
tela de computador) só dá pra confirmar na prática; pode precisar de
ajuste de raio/posição.

**Alternativas descartadas**:
- Mostrar o `padType` ou status de canal consumido na tela inicial:
  descartado por poluir uma tela pensada pra ser só "ver o que está
  tocando" — essa informação já está disponível na tela de configuração e
  no app desktop.
- Barra de progresso linear em vez de velocímetro: mais simples de
  desenhar (só `fillRect` proporcional), mas o usuário pediu
  especificamente o visual de velocímetro.

## 2026-08-21 — Fase J: rebranding "DrumCore" + redesenho completo da navegação (design/SPEC.md)

**Decisão**: renomear o projeto de "HelloDrum" para "DrumCore" (exibido como
"DRUMCORE" em telas/branding, "DrumCore" em prosa) e substituir inteiramente
o sistema de tela/encoders das Fases C/I por uma navegação de 6 telas (BOOT,
LIVE, PADS, PAD_EDIT, SIGNAL, GLOBAL), seguindo uma especificação de UI
(`design/SPEC.md` + `design/Modulo Bateria UI.dc.html`) produzida com Claude
Design a partir de uma conversa do usuário fora dessa sessão.

**Contexto/Racional**: pedido direto do usuário ("bati um papo com o claude
design... vamo implementar essa UI"). A biblioteca de terceiros vendorizada
(`firmware/lib/HelloDrum-arduino-Library`, de Ryo Kosaka) **não** faz parte
do rebranding — mantém seu nome, arquivos (`hellodrum.h`/`hellodrum.cpp`) e
identificadores de classe (`HelloDrum`, `HelloDrumMUX_4051`,
`HelloDrumButton`) originais. A pasta raiz do repositório também não foi
renomeada (só o texto de branding em código/docs/UI).

**O antigo sistema de tela/botões foi abandonado, não estendido**: as Fases
C/I giravam em torno de `HelloDrumButton::readButton()`/`settingEnable()` —
um fluxo desenhado pros 5 sinais (SET/UP/DOWN/NEXT/BACK) que os exemplos
originais da lib esperam, e que já tínhamos adaptado pra 2 encoders (ver
entrada de 2026-08-20 sobre navegação). O novo spec pede uma máquina de
estados com semântica bem diferente (2 encoders com papéis distintos —
"página" vs. "navegação/valor" —, gestos de hold de 600ms, edição em RAM
com persistência só sob confirmação explícita) que não mapeia de forma
natural pra esse fluxo de 5 sinais. Optamos por implementar a navegação
inteira em `main.cpp` (novo `enum ScreenPage`, `FieldId`/`FieldDef` +
`getFieldsForType()`/`getFieldValue()`/`setFieldValue()`, detecção de
hold/aceleração por timestamp) e parar de chamar
`HelloDrumButton::readButton()`/`settingEnable()`/`GetPadName()` etc. —
`HelloDrumButton` deixou de ser instanciado. A lib continua fornecendo só a
camada de sensing (`singlePiezoMUX()`, `dualPiezoMUX()`, etc.) e persistência
(`initMemory()`/`loadMemory()`), que não mudou.

**Sistema de campos dinâmico por tipo de sensor (`getFieldsForType()`)**:
o spec original prevê 7 campos fixos por pad (SENSOR/SENSIB/THRESH/SCAN/
MASK/CURVA/NOTA), mas a Fase G já tinha implementado os 8 tipos de sensor
da lib, alguns com mais campos (ex: prato 3 zonas tem thresholds e notas
extras pra edge/cup — até 10 campos). Optamos por manter o modelo de dados
mais rico da Fase G (não reduzir pra só 4 tipos/7 campos como o spec
simplificado sugeria) e fazer a tela PAD_EDIT rolar quando o tipo tem mais
de 7 campos — mesma janela deslizante de 7 linhas usada na lista PADS,
reaproveitando o padrão. `getFieldsForType()` espelha
`PAD_TYPE_META[type].fields` do app desktop (`protocol.ts`), mas descrevendo
como ler/escrever cada campo direto nos membros públicos de `HelloDrum` (via
`getFieldValue()`/`setFieldValue()`), em vez de passar pelo fluxo de botões
da lib.

**Persistência: RAM-only nos encoders, auto-save no protocolo serial
(divergência intencional)**: o spec é explícito — "Edição altera apenas o
buffer em RAM. Persistência só acontece em GLOBAL > SALVAR." Implementamos
isso literalmente pro caminho dos encoders/tela: `setFieldValue()` só
altera os campos em RAM (seta uma flag `unsavedChanges`); só
`saveAllToEeprom()` (chamado em `GLOBAL > SALVAR`) grava de fato, e
`loadAllFromEeprom()` (`GLOBAL > RESTAURAR`) descarta as mudanças não
salvas recarregando da EEPROM. **Mantivemos, de propósito, o comportamento
antigo pro protocolo serial** (`handleSetPad()`/`handleSetGlobal()`
continuam persistindo a cada campo alterado, como desde a Fase D/F) — o app
desktop não tem (e não ganhou) um botão "salvar" equivalente ao da tela
física, então esperar que o usuário abra a aba GLOBAL do app e clique
"Salvar tudo" toda vez que arrasta um slider seria pior UX do que já
funcionava. Os comandos `save_all`/`restore_all` foram adicionados ao
protocolo mesmo assim (documentados em
[04-protocolo-serial.md](04-protocolo-serial.md)), pra permitir que o app
espelhe as mesmas ações da tela quando fizer sentido (ex: descartar edições
feitas nos encoders antes de salvar) — na prática, redundante no caminho
`set_pad`/`set_global`, mas não custa nada expor.

**"SAIDA" (GLOBAL) virou USB/BLE/USB+BLE, não USB/DIN/USB+DIN**: o spec
original (pensado sem contexto do nosso hardware específico) previa DIN
(MIDI 5 pinos) como uma das opções de saída — não existe esse circuito no
projeto (só USB-MIDI da Fase B e BLE-MIDI da Fase H). Em vez de implementar
um "DIN" que nunca faria nada (stub morto), reinterpretamos a mesma posição
na tela GLOBAL como USB/BLE/USB+BLE — as opções reais que o hardware tem.
Isso muda o comportamento de `fireNote()`/`fireControlChange()`: antes (Fase
H) os dois transportes saíam sempre juntos; agora um `byte midiOutput`
(persistido) decide se USB, BLE, ou os dois recebem cada nota/CC.

**"KIT" foi removido do spec, não implementado nem como placeholder**: o
spec original pede um campo "KIT (01-nn)" na tela GLOBAL, sem detalhar o
que uma troca de kit deveria fazer (múltiplos bancos de configuração de
pads selecionáveis por kit). Perguntamos ao usuário se valia implementar
de verdade ou só deixar fixo como placeholder; a resposta foi explícita —
"não vamos implementar isso não, sem kits por enquanto". Por isso o campo
não existe em lugar nenhum: nem `kitNumber` no firmware (nem em RAM, nem em
EEPROM — o bloco de config global ficou com 3 bytes, não 4), nem
`kit_number` no protocolo serial (`set_global`/`device_info`), nem na tela
GLOBAL (que ficou com 5 linhas: MIDI CH, SAIDA, BRILHO, SALVAR, RESTAURAR —
não 6), nem no app desktop ou no `HardwareSimulator.tsx`. Se o recurso for
pedido de novo no futuro, é uma feature nova a projetar do zero (formato de
persistência por kit, o que cada kit duplica ou não), não uma retomada de
código existente.

**Correção de linkage na lib vendorizada — `rawValue[]`**: a tela SIGNAL
(osciloscópio simplificado do envelope do sensor) precisa que `main.cpp`
leia os valores brutos do ADC que `HelloDrumMUX_4051::scan()` grava (dentro
de `hellodrum.cpp`). O array `rawValue[]` era declarado `static` direto no
header (`hellodrum.h`) — igual ao problema já documentado com
`nameIndex`/`editCheck`/`padType[]` nas entradas anteriores, um `static` no
escopo de arquivo/header vira uma cópia **separada e desconectada** por
`.cpp` que faz `#include` (linkage interno), não uma variável
compartilhada. Trocado para `extern int rawValue[64]` no header + a
definição real (`int rawValue[64]`) uma única vez em `hellodrum.cpp`, junto
do resto do estado interno da lib. Essa é a quarta vez que esse mesmo
padrão de bug aparece nessa biblioteca — vale ficar atento a outras
variáveis `static` de escopo de arquivo se precisarmos ler mais estado
interno de fora no futuro.

**Tela SIGNAL usa um envelope aproximado, não uma captura alinhada ao
hit**: o ideal seria capturar exatamente as amostras do ADC durante a
janela de scan/mask de um hit específico. Isso exigiria instrumentar
`hellodrum.cpp` mais a fundo (fora do escopo de "só ler o que já existe").
Optamos por manter um buffer de 120 amostras como uma janela deslizante
contínua do canal em foco, atualizada a cada `loop()` enquanto a tela
SIGNAL está visível, e redesenhada só quando percebemos um hit novo — na
prática mostra o formato geral do envelope de um hit recente, mas não é uma
captura cirurgicamente alinhada ao início do scan. Documentado como
simplificação deliberada no comentário de `captureSignalSample()`.

**Reskin do app desktop (Electron/React)**: paleta e tipografia seguem os
mesmos tokens da tela do módulo (`design/SPEC.md` seção 4: BG/SURFACE/LINE/
TXT_DIM/TXT/ACCENT/EDIT/HIT/OK; fontes Silkscreen + Space Grotesk, via
Google Fonts — exigiu abrir a CSP do `index.html` pra `fonts.googleapis.com`/
`fonts.gstatic.com`, já que o app é Electron com acesso à rede, não um
artifact restrito). A API exposta pelo preload (`contextBridge`) foi
renomeada de `window.helloDrum` para `window.drumCore` (`preload/index.ts`,
`env.d.ts`, `App.tsx`). Nova aba "Global" no app pra configurar canal MIDI/
saída/brilho via `set_global` (sem KIT — ver acima, o campo não existe).
`HardwareSimulator.tsx` foi reescrito do zero (não incrementado) pra
espelhar a nova máquina de 5 páginas em runtime (BOOT não entra, dura só a
inicialização) e a nova semântica dos 2 encoders, incluindo o gesto de hold
de 600ms — simulado no navegador via `onMouseDown`/`onMouseUp` com um
`setTimeout`, já que não existe equivalente nativo de "manter pressionado"
num `<button>` HTML.

**Status de validação**: firmware compila e linka com sucesso via
PlatformIO (`pio run`); app desktop com `npm run typecheck` e `npm run
build` limpos. **Nada testado em hardware real** — em especial, a
legibilidade das 6 telas numa TFT física de 1.44" (bem menor que qualquer
preview), o sentido/aceleração dos encoders, e se o brilho via PWM
(`ledcSetup`/`ledcAttachPin`/`ledcWrite` — API do core 3.x, mais antiga que
o `ledcAttach()` de uma linha que tentamos primeiro e não existe nessa
versão do core) fica suave ou "degrau" na prática.

**Alternativas descartadas**:
- Manter `HelloDrumButton`/`readButton()` e só trocar os textos exibidos:
  descartado porque a semântica de encoder do spec (papéis fixos por
  encoder, hold, edição em RAM) não é representável pelos 5 sinais
  SET/UP/DOWN/NEXT/BACK sem gambiarras piores do que reescrever a
  navegação direto em `main.cpp`.
- Reduzir o modelo de dados de pad pra só os 4 tipos/7 campos do spec
  simplificado: descartado — perderíamos os 8 tipos de sensor da Fase G
  sem necessidade real, só pra bater 1:1 com um mockup que não tinha
  contexto do nosso escopo mais amplo.
- Implementar "DIN" como opção morta na tela GLOBAL (só pra bater com o
  spec ao pé da letra): descartado — preferimos uma opção honesta e
  funcional (BLE) a uma opção que nunca faria nada.
- Dar ao app desktop um botão "Salvar"/"Restaurar" que efetivamente
  passasse a exigir confirmação pra persistir `set_pad`/`set_global` (pra
  unificar o modelo de persistência entre os dois caminhos): descartado —
  mudaria a UX já validada do app (auto-save) sem pedido do usuário, só
  por simetria com a tela física.

## 2026-08-21 — Fase K: multiplexação trocada de 4x CD4051 para 2x CD4067 (HW-178)

**Decisão**: substituir os 4x chip CD4051 avulso (8 canais cada) por 2x
módulos breakout "HW-178" (chip CD4067, 16 canais cada) — mesmas 32 entradas
analógicas totais, só com metade das placas físicas pra montar/cabear.

**Contexto/Racional**: o usuário encontrou/comprou 2 unidades do HW-178 por
um preço melhor do que montar 4x CD4051 soltos (sem contar que o breakout já
vem com os resistores/capacitores de desacoplamento prontos, reduzindo
solda). A biblioteca já suporta `HelloDrumMUX_4067` nativamente (mesma
classe já mencionada desde a entrada de 2026-08-20 sobre multiplexação, só
não tínhamos usado ainda) — troca de chip, não uma modificação de código
sob medida.

**Por que isso não afeta o resto do firmware**: a indexação de pads
(`HelloDrum pads[32]`, `padTypes[]`, EEPROM, protocolo serial, telas) sempre
tratou os 32 canais como um espaço linear único (`i` de 0 a 31) — nunca
soube ou precisou saber quantos chips físicos formam esse espaço. Só a
camada de `HelloDrumMUX_*`/`scan()` muda: em vez de 4 instâncias de
`HelloDrumMUX_4051` (`muxNum*8 + canal_local`, 3 pinos de seleção), agora são
2 instâncias de `HelloDrumMUX_4067` (`muxNum*16 + canal_local`, 4 pinos de
seleção S0-S3) — confirmado lendo `HelloDrumMUX_4067::scan()` em
`hellodrum.cpp`, que usa exatamente esse padrão. `NUM_PADS` continua 32,
`rawValue[64]` (branch ESP32 da lib) segue com folga de sobra.

**Pinout**: `MUX_S0/S1/S2` continuam nos mesmos GPIOs (4/5/6, compartilhados
entre as 2 placas); adicionado `MUX_S3` no GPIO7 — reaproveitando o pino que
antes era o `Z` do 3º CD4051 (que deixou de existir), evitando precisar
caçar um GPIO novo fora das faixas já vetadas (strapping/USB/PSRAM). O GPIO8
(antigo `Z` do 4º CD4051) ficou livre, sem uso previsto por ora. Os 2 pinos
`SIG` (saída analógica de cada HW-178) usam os mesmos GPIOs 1 e 2 que já
eram usados pros 2 primeiros MUX. Detalhes em
[02-hardware.md](02-hardware.md).

**Pino EN do HW-178**: o breakout expõe um pino `EN` (enable, ativo em LOW)
que a lib não controla (o construtor de `HelloDrumMUX_4067` só recebe
S0-S3+SIG, sem EN) — decisão de wiring, não de firmware: ligar `EN` direto
em GND em cada uma das 2 placas, deixando-as sempre habilitadas. Não há
necessidade de desabilitar um MUX (como faria sentido se os dois
compartilhassem um único pino `SIG`), já que cada placa tem seu próprio
pino ADC dedicado.

**Esquemático atualizado**: `docs/assets/esquematico-hellodrum.html`
redesenhado para mostrar 2 blocos HW-178 (com S0-S3 + SIG + EN→GND) em vez
de 4 blocos CD4051 (S0-S2 + Z).

**Status de validação**: firmware compila e linka com sucesso via
PlatformIO (`pio run`). **Nada testado em hardware real** — em especial,
não há confirmação de que o pino `EN` do HW-178 realmente fica sempre
habilitado ligado direto em GND (é o comportamento esperado do datasheet do
CD4067, mas o breakout específico pode ter alguma diferença de fiação não
documentada pelo vendedor).

**Alternativas descartadas**:
- Manter 4x CD4051: descartado por custo/praticidade de montagem — o
  usuário já comprou os 2x HW-178, sem motivo técnico para não usá-los.
- Misturar CD4051 e CD4067 (ex: 2 de cada, pra reaproveitar chips CD4051
  avulsos que sobraram): descartado por complexidade desnecessária — os 2x
  HW-178 já cobrem os 32 canais sozinhos, e misturar exigiria calcular
  offsets manualmente (`muxIndex` é compartilhado entre as duas classes,
  não reinicia por tipo).

## 2026-08-21 — Fase L: pinout reorganizado por ergonomia de montagem (header esquerdo/direito)

**Decisão**: reatribuir os GPIOs dos 2x CD4067, da tela TFT e dos 2
encoders de forma que cada subsistema saia **inteiro de um único header
físico** da placa (esquerdo ou direito) — nenhum sinal de um mesmo módulo
fica dividido entre os dois lados. Header esquerdo = 2x CD4067 + tela TFT.
Header direito = os 2 encoders.

**Contexto/Racional**: o usuário enviou uma foto do pinout real da placa
comprada (dev board ESP32-S3, headers de 22 pinos de cada lado do módulo
WROOM) e pediu que a fiação de cada subsistema saia sempre do mesmo lado,
por ergonomia de montagem — até a Fase K, o pinout tinha sido escolhido "no
papel" (evitando conflitos conhecidos: strapping, USB nativo, PSRAM octal)
sem nenhuma noção de **qual pino sai de qual lado físico da placa real**,
então o barramento dos MUX (S0-S3 num lado, SIG0/SIG1 no outro) e o encoder
2 (A num lado, B/SW no outro) ficavam split entre os dois headers —
exatamente o problema que o usuário queria resolver.

**Dois fatos do pinout real guiaram a divisão** (não foi uma escolha
arbitrária 50/50):
- **`3V3` só existe no header esquerdo** (2 pinos, topo da placa). O header
  direito só expõe `GND`. Como os 2x CD4067 e a tela TFT precisam de VCC,
  eles **têm** que sair do header esquerdo — colocá-los no direito exigiria
  cruzar um fio de 3.3V pela placa de qualquer jeito, o que anularia o
  ganho de ergonomia.
- Os 2 encoders usam só pull-up interno do ESP32-S3 (`INPUT_PULLUP`, sem
  resistor/VCC externo — decisão já registrada na entrada de 2026-08-20
  sobre navegação por encoders) — só precisam de `GND` comum, presente nos
  dois headers. Por isso podem ficar inteiramente no header direito sem
  custo elétrico nenhum.

Ou seja, a divisão "sensing+display de um lado, controles do usuário do
outro" não foi só estética — é a que exige o menor número de fios cruzando
a placa (zero, no caso ideal), porque cada grupo já compartilha a mesma
necessidade (ou não) de alimentação externa.

**Pinos alterados** (`firmware/src/main.cpp`):
- `MUX0_Z`/`MUX1_Z` (SIG dos 2 CD4067): GPIO1/GPIO2 → **GPIO8/GPIO9**
  (ambos ADC1, header esquerdo, ao lado de `MUX_S0-S3` que já estavam lá).
- `TFT_DC`: GPIO9 → **GPIO10** (GPIO9 passou a ser o `SIG` do MUX 1).
- `TFT_CS`: GPIO10 → **GPIO16** (GPIO10 passou a ser o `DC` da tela).
  `TFT_SCLK`/`TFT_MOSI`/`TFT_BLK`/`TFT_RST` não mudaram.
- `ENC1_A/B/SW`: GPIO15/16/17 → **GPIO42/41/40**.
- `ENC2_A/B/SW`: GPIO18/21/38 → **GPIO37/36/35**.

**Achado incidental — GPIO38 aciona um LED embutido nessa placa**: a foto
do pinout real (analisada nesta fase) rotulava GPIO38 como `RGB_LED` além
de `FSPIWP`/`SUBSPIWP`. Esse pino era usado desde a Fase C para o SW do
encoder 2 ("reservada", sem função). Não temos como confirmar sem hardware
se isso já estava causando algum comportamento estranho (ex: o LED
piscando ao girar o encoder, ou o encoder não respondendo por o pino já
estar "ocupado" por outra função da placa), mas de qualquer forma é um
pino a evitar — corrigido nessa mesma passada, mesmo sendo uma correção
independente do pedido original de ergonomia.

**Correção (2026-08-31)**: Rodrigo conferiu o pinout direto na serigrafia
da placa física e o rótulo correto de GPIO38 é `BUILTIN LED` (um LED
simples embutido), não `RGB_LED` — a leitura da foto acima estava errada
nesse ponto específico. O LED RGB endereçável de fato fica no **GPIO48**
(rótulo `RGB LED`), pino que já era excluído do pinout por outro motivo
(`SPICLK_N`, sinal interno de flash/PSRAM — ver risco anotado abaixo para
GPIO35-37/47-48). Isso não muda nenhuma atribuição de pino do firmware:
GPIO38 continua evitado (agora pela razão certa) e GPIO48 continua
excluído (pela razão original, reforçada). Atualizado também em
[02-hardware.md](02-hardware.md), `docs/CHANGELOG.md`,
`docs/assets/esquematico-hellodrum.html` e o comentário em
`firmware/src/main.cpp`.

**Risco não confirmado — GPIO35/36/37 e PSRAM octal (histórico)**: esses
pinos são internos (ligados ao chip de PSRAM) em módulos ESP32-S3 que usam
PSRAM **octal** (ex: variantes "R8" tipo N16R8) — usá-los como GPIO externo
nesses módulos trava a placa. A foto do pinout real expõe os 3 como header
normal, o que sugere que o módulo específico dessa placa **não** é a
variante octal (só teria sentido expor esses pinos se eles não estivessem
ocupados internamente) — mas isso não foi confirmado contra o datasheet/
serigrafia exata do módulo. **Superado pelo ajuste de contiguidade abaixo**:
os encoders não usam mais GPIO35-37, então esse risco deixou de valer pro
pinout atual — mantido aqui só como histórico da Fase L.

**Confirmado (2026-08-31) — é octal, o risco era real**: Rodrigo leu
direto na serigrafia do módulo: `ESP32-S3-N16R8` (16MB flash + 8MB PSRAM
**octal**). Correção de um erro deste assistente na mesma data: uma
mensagem anterior afirmou (errado) que rodar `pio run` tinha "confirmado"
a variante como quad/sem PSRAM — isso é falso, o `pio run` só compila
contra o perfil genérico fixo `board = esp32-s3-devkitc-1` do
`platformio.ini` (8MB, sem PSRAM), sem ler hardware nenhum. Com o módulo
real sendo N16R8, GPIO33-37 **são de fato internos** (barramento de dados
da PSRAM octal) e não devem ser usados como GPIO externo — mas como o
ajuste de contiguidade acima já tirou os encoders desses pinos, não há
nenhuma fiação afetada.

**Corrigido (2026-08-31)**: `firmware/platformio.ini` ajustado pra
refletir o módulo real — `board_build.arduino.memory_type = qio_opi`,
`board_build.partitions = default_16MB.csv`, `board_upload.flash_size =
16MB`/`maximum_size = 16777216` e `build_flags += -D BOARD_HAS_PSRAM`
(sem essa flag o core arduino-esp32 não inicializa a PSRAM externa).
Baseado no board de referência da 4D Systems pra essa mesma combinação
(`framework-arduinoespressif32/boards/4d_systems_esp32s3_gen4_r8n16.json`),
sem trocar o `board` base (continua `esp32-s3-devkitc-1`, cujo
`flash_mode: qio` já era compatível). `pio run` limpo confirma: `HARDWARE:
... 16MB Flash` e partição de app de 6.25MB (era 3.2MB com o perfil
N8/8MB) — `[SUCCESS]`.

**Ajuste de contiguidade física (2026-08-31)**: o pinout de encoders acima
(`ENC1_A/B/SW` = GPIO42/41/40, `ENC2_A/B/SW` = GPIO37/36/35) tinha um vão de
2 pinos (`GPIO39`, `GPIO38`) entre os dois encoders na ordem física real do
header direito (`...44,1,2,42,41,40,39,38,37,36,35,0...`) — o `GPIO38` era
evitado (LED embutido), mas o `GPIO39` ficava pulado sem necessidade,
quebrando a regra de "feixe único contíguo" que já valia pro MUX+tela no
header esquerdo. Reatribuído para usar os 6 pinos realmente contíguos e
livres de qualquer pino evitado: `GPIO1, 2, 42, 41, 40, 39`.
- `ENC1_A/B/SW`: GPIO42/41/40 → **GPIO1/2/42**.
- `ENC2_A/B/SW`: GPIO37/36/35 → **GPIO41/40/39**.

Efeito colateral positivo: o novo intervalo não inclui mais GPIO35-37, então
o risco de PSRAM octal acima deixa de se aplicar a este projeto (nenhum pino
usado depende mais de o módulo ser quad em vez de octal). Também evita
GPIO43/44 (TXD0/RXD0, usados pela porta UART/USB-serial de debug — não
foram usados aqui de propósito, pra não perder o `Serial.print()` de
depuração). Atualizado em [02-hardware.md](02-hardware.md),
`docs/CHANGELOG.md`, `docs/assets/esquematico-hellodrum.html` e
`firmware/src/main.cpp`.

**Status de validação**: firmware compila e linka com sucesso via
PlatformIO (`pio run`). **Nada testado em hardware real** — em especial, a
leitura correta dos encoders nos pinos atuais (GPIO1/2 são ADC1/Touch;
GPIO39-42 são os pinos JTAG MTCK/MTDO/MTDI/MTMS — usáveis como GPIO comum
quando JTAG não está em uso, mas sem histórico de uso anterior neste
projeto) ainda precisa de confirmação física.

**Alternativas descartadas**:
- Manter os encoders divididos entre os dois headers (como estava):
  descartado — é exatamente o problema que o usuário pediu pra resolver.
- Levar um fio de 3.3V até o header direito pra poder colocar o MUX/tela
  lá também: descartado — reintroduziria o mesmo problema de fiação
  cruzando a placa que a reorganização busca eliminar, só que ao contrário.
- Espalhar os 2 encoders entre os dois headers de novo, mas agrupados por
  "papel" (ex: os dois sinais de quadratura de ambos os encoders num lado,
  as duas chaves no outro): descartado — quebraria a regra "cada
  subsistema sai de um único lado" na direção oposta (um subsistema, o
  encoder, ficaria dividido; melhor manter cada encoder inteiro num único
  header, mesmo que os dois encoders entre si fiquem no mesmo header).

**Ajuste de espelhamento da tela com o conector dela (2026-08-31)**:
pedido do Rodrigo — em vez de só "sair do mesmo header, pinos
adjacentes", a tela passa a usar os 6 pinos da **base** do header
esquerdo (`GPIO9,10,11,12,13,14`, logo acima do `5V`/`GND`) em vez de
continuar a sequência logo após o MUX (`17,18,8,9,10,11`). Motivo: o
conector físico da tela segue a ordem `GND VCC SCL SDA RES DC CS BLK`, e
nessa placa o `GND` do header esquerdo é o **último pino da base** (o
`3V3` fica no topo) — subindo a partir do `GND` da base (pulando só o
`5V`, fixo, não é GPIO), os 6 sinais da tela saem na mesma ordem do
conector dela: `SCL`(14, mais perto do `GND`) → `SDA`(13) → `RES`(12) →
`DC`(11) → `CS`(10) → `BLK`(9). Resultado: a fiação da tela sai reta,
pino a pino, sem cruzar — só o `VCC` foge dessa sequência (precisa de um
fio isolado até o `3V3` no topo), aceito de propósito como única exceção.
- `TFT_DC`: GPIO17 → **GPIO11**.
- `TFT_CS`: GPIO18 → **GPIO10**.
- `TFT_MOSI`: GPIO8 → **GPIO13**.
- `TFT_SCLK`: GPIO9 → **GPIO14**.
- `TFT_BLK`: GPIO10 → **GPIO9**.
- `TFT_RST`: GPIO11 → **GPIO12**.

**Trade-off aceito**: a tela deixa de formar um feixe único contíguo com
o MUX (que continua em `GPIO4,5,6,7,15,16`, perto do topo) — sobram
`GPIO17`, `GPIO18`, `GPIO8` livres entre os dois grupos. Priorizado de
propósito: bater com o conector da tela facilita a montagem mais do que
os dois subsistemas seguirem em feixe único (a tela e o MUX já saem por
fios/conectores separados de qualquer forma, só compartilham o mesmo
header). GPIO12/13/14 (antes "livres/sobressalentes") passam a ser usados
pela tela; nenhum pino evitado (strapping, USB, LED, flash/PSRAM) entra
nessa faixa. `pio run` confirma `[SUCCESS]` com o novo pinout. Atualizado
em [02-hardware.md](02-hardware.md), `docs/CHANGELOG.md`,
`docs/assets/esquematico-hellodrum.html` e `firmware/src/main.cpp`.

**Primeiro teste em hardware real (2026-08-31) — tela em branco, causa
raiz encontrada**: após gravar o firmware pela primeira vez (via
`firmware/platformio.ini`, porta `COM5`/CH343 — ver notas de porta
USB/UART abaixo), a tela ficou acesa (backlight ok) mas totalmente em
branco, sem nenhum conteúdo desenhado. Hipóteses investigadas em ordem:
1. Variante de driver errada (`INITR_144GREENTAB` vs `INITR_BLACKTAB`) —
   testado trocando pra `INITR_BLACKTAB`: **mesmo resultado** (branco).
   Duas variantes diferentes dando o mesmo branco descarta essa hipótese
   (se a SPI estivesse chegando no controlador, variantes diferentes
   produziriam pelo menos alguma diferença visual).
2. Interferência do resto do firmware (2900+ linhas: MUX, encoders,
   USB-MIDI, BLE, EEPROM) — testado com um ambiente PlatformIO isolado só
   pra tela (`[env:display_test]` em `platformio.ini`, código em
   `firmware/src/test_display.cpp`, ver comentário no arquivo), sem
   nenhum outro subsistema. **Mesmo resultado** (branco) — descarta
   interferência de software.
3. **Causa raiz**: curto físico na solda de um dos pinos da tela,
   encontrado e corrigido por Rodrigo. Depois da correção, o teste
   isolado (`display_test`) mostrou as cores ciclando corretamente.

Reversão: `tft.initR()` voltado pra `INITR_144GREENTAB` (a variante
correta pra esse tamanho de tela, 1.44"/128×128 — o teste com
`INITR_BLACKTAB` foi feito sob a conexão com curto, portanto inválido e
descartado). Firmware principal regravado com sucesso.

**Ambiente de teste permanente**: `[env:display_test]` fica no
`platformio.ini` como ferramenta de diagnóstico reutilizável (não
depende do `main.cpp`, resolve rápido se um problema futuro é hardware
ou software) — `pio run -e display_test -t upload --upload-port COM5`.
**Cuidado**: rodar `pio run` sem `-e <nome>` processa **todos** os
environments do `.ini` em sequência — se `--upload-port` for passado
assim, cada um sobrescreve o anterior na placa (foi o que aconteceu numa
tentativa aqui: o `display_test` acabou sobrescrevendo o firmware
principal recém-gravado). Sempre usar `-e esp32-s3-devkitc-1` pra
gravar o firmware de verdade.

**Portas COM identificadas nesta placa**: a porta rotulada fisicamente
**"UART"** aparece no Windows como `CH343` (ex: `COM5`) — usa GPIO43/44
(TXD0/RXD0), auto-reset funciona sozinho via RTS, **recomendada pra
gravação**. A porta rotulada **"USB"** é o USB nativo do ESP32-S3 — no
modo bootloader aparece como `USB-Serial/JTAG` (era `COM4` aqui), e uma
vez o firmware rodando (`ARDUINO_USB_MODE=0`+`ARDUINO_USB_CDC_ON_BOOT=1`)
essa mesma porta física passa a carregar tanto `Serial` (console CDC)
quanto a classe MIDI customizada (TinyUSB) — não serve bem pra gravar
(exige BOOT+RESET manual, o app já ocupa a porta).

**Refinamento (mesmo dia)**: "mesmo header" não é o mesmo que "pinos
adjacentes" — a Fase L original já tirava cada subsistema de um único
lado, mas dentro desse lado os pinos ainda podiam estar espalhados (ex:
SIG0/SIG1 em GPIO8/9, física e visualmente distantes de S0-S3 em GPIO4-7
na sequência real da placa, mesmo estando no mesmo header). Reexaminando a
ordem física exata do header esquerdo
(`4,5,6,7,15,16,17,18,8,3,46,9,10,11,12,13,14`), veio o pedido explícito do
usuário pra usar `4,5,6,7,15,16` no MUX — os únicos 6 pinos que formam uma
sequência **contígua** (sem nenhum outro sinal usável entre eles) — e
aplicar o mesmo critério aos demais componentes.

- **MUX (S0-S3, SIG0/SIG1)**: `4,5,6,7,15,16` — sequência contígua na
  ordem física real. **Trade-off aceito**: GPIO15/16 são ADC2, não ADC1
  (as fases anteriores preferiam ADC1 por precaução com o conflito
  clássico ADC2×Wi-Fi). Esse conflito é especificamente com o driver
  Wi-Fi (arbitragem de RF) — este projeto **nunca inicializa Wi-Fi** (só
  BLE-MIDI, que usa outro caminho de rádio e não disputa o ADC2) — então a
  restrição "só ADC1" foi relaxada aqui deliberadamente. Se o projeto um
  dia ganhar Wi-Fi, isso precisa ser reavaliado.
- **TFT (DC, CS, MOSI, SCLK, BLK, RST)**: `17,18,8,9,10,11` — continua a
  mesma sequência física logo depois do MUX, sem pular nada além dos
  pinos de strapping (`3`/`46`, que já eram inevitáveis). `DC`/`CS` ficam
  juntos em `17,18` e `MOSI`/`SCLK` juntos em `8,9` — nenhum desses sinais
  depende de um pino físico específico do chip (SPI é roteado por matriz
  de GPIO no ESP32-S3), então a ordem interna é livre.
- **Encoders**: sem mudança — `42,41,40` e `37,36,35` já eram sequências
  contíguas desde a Fase L original (só coincidência de já estarem bem
  posicionados).

Pinos sobressalentes remanescentes: `12,13,14` (header esquerdo, imediatamente
depois da sequência MUX+TFT) e `1,2,21,39,43,44` (header direito).

**Alternativa descartada**: manter SIG0/SIG1 em GPIO8/9 (ADC1) e aceitar
que ficassem "no mesmo header, mas não adjacentes" — descartado porque o
usuário pediu explicitamente contiguidade física, não só "mesmo lado", e
o motivo original para preferir ADC1 (conflito com Wi-Fi) não se aplica a
este projeto.

## 2026-08-22 — Fase M: tipo de sensor "Caixa 3 zonas" (centro/borda/aro) + bugfix do `PAD_DUAL`

**Decisão**: adicionar `PAD_SNARE_3ZONE` (tipo 8) — uma caixa com 3 sons
(centro da pele, borda da pele, aro/rimshot) — reusando **sem nenhuma
mudança** a mesma sensing já usada pro prato 3 zonas
(`cymbal3zoneMUX()`/`cymbal3zoneSensing()` em `hellodrum.cpp`), só com
zonas/rótulos renomeados pro contexto de caixa.

**Contexto/Racional**: o usuário perguntou como o código trataria uma
caixa real (que tipicamente tem 3 sons: centro da pele, perto da borda da
pele, e o aro) e pediu pra pesquisar como a lib já trata isso. Investigando
`hellodrum.cpp`, achamos que a técnica do prato 3 zonas (tipo 5) já é
exatamente a resposta: 2 piezos (corpo + borda/switch), e o segundo piezo é
comparado contra **2 thresholds em sequência** (`edgeThreshold`,
`cupThreshold`) em vez de um só — isso já separa "vibrou pouco" de "vibrou
muito" no mesmo sensor. É o mesmo princípio físico usado em pads de caixa
reais com 3 sons: eles também não têm 3 sensores — têm 2 (pele + aro), e
distinguem "borda da pele" (vibração leve no sensor do aro) de "aro de
verdade" (vibração forte no mesmo sensor do aro) por amplitude, não por um
terceiro sensor dedicado.

**Implementação**: `PAD_SNARE_3ZONE = 8` despacha pra
`cymbal3zoneMUX()` (dispatchSensing), cabeamento **idêntico** ao
`PAD_DUAL` (pele = `pin_1`, aro = `pin_2` — trocar entre os dois tipos não
exige recabear nada). Campos de configuração reaproveitados: `EDGETHR`/
`RIMTHR` (rim_sensitivity/rim_threshold) e `N.EDGE`/`N.RIM`
(note_rim/note_cup internamente `noteEdge`/`noteCup`). Zonas no protocolo:
`"head"` (centro), `"edge"` (borda), `"rim"` (aro de verdade) — ver
[05-tipos-de-sensor.md](05-tipos-de-sensor.md) pra tabela completa e
[04-protocolo-serial.md](04-protocolo-serial.md) pro contrato de zonas.
Decisões de nomenclatura (tipo novo dedicado, não reaproveitar "Prato 3
zonas" com rótulo genérico; zonas `head`/`edge`/`rim`) confirmadas
diretamente com o usuário via pergunta.

**Bug encontrado e corrigido no caminho — `PAD_DUAL` nunca enviava
hit/nota**: enquanto rastreava onde adicionar o despacho de zona pro tipo
8, percebemos que `handlePadResult()` (a função que decide qual evento
`hit`/nota MIDI enviar por tipo de pad) **nunca teve um `case PAD_DUAL:`**
desde a Fase G — o switch tinha `PAD_SINGLE`, `PAD_HIHAT_SINGLE`,
`PAD_CYMBAL_2ZONE`/`PAD_HIHAT_2ZONE`, `PAD_CYMBAL_3ZONE` e
`PAD_HIHAT_PEDAL`/`PAD_HIHAT_OPTICAL`, mas não `PAD_DUAL` — e sem `default:`
nenhum. Na prática, isso significa que **qualquer pad configurado como
tipo 1 (Aro/Dual) nunca emitiu nota MIDI nenhuma, nem por USB nem por BLE**,
apesar de `dispatchSensing()` continuar chamando `dualPiezoMUX()`
normalmente (a detecção de hit acontecia, só o despacho pra MIDI/protocolo
é que faltava). Confirmamos que isso não era intencional porque tanto
[04-protocolo-serial.md](04-protocolo-serial.md) (zona `hit`) quanto
`mockDevice.ts` (modo demo do app desktop) já documentavam/simulavam as
zonas `"head"`/`"rim"` pra esse tipo desde a Fase G — só a implementação
real no firmware que nunca foi escrita. Corrigido adicionando o `case`
faltante, usando exatamente essas zonas já documentadas.

**Por que isso é especialmente relevante agora**: tipo 1 (Aro/Dual) é o
tipo mais comum pra caixa/tom com aro — bem provável que seja o tipo já
configurado pro pad de caixa do usuário. Sem essa correção, uma caixa
"normal" (2 zonas, sem o refinamento do tipo 8) simplesmente não tocaria
nada.

**Status de validação**: firmware compila e linka com sucesso (`pio run`);
app desktop com `npm run typecheck`/`npm run build` limpos, incluindo o
modo demo atualizado (`mockDevice.ts` simula as 3 zonas do tipo 8) e o
simulador de hardware (`HardwareSimulator.tsx`, pad de exemplo "Caixa"
trocado de tipo 0 pra tipo 8 pra já mostrar a feature). **Nada testado em
hardware real** — em especial, os thresholds de borda/aro do tipo 8 nunca
foram calibrados numa caixa física de verdade (o valor certo depende muito
de onde o piezo do aro é colado e de que aro é esse).

**Alternativas descartadas**:
- Reaproveitar "Prato 3 zonas" (tipo 5) como está, sem tipo novo: o
  usuário preferiu um tipo dedicado com rótulos próprios (Centro/Borda/
  Aro) pra não confundir na tela/app com terminologia de prato.
- Zonas `center`/`edge`/`rim` em vez de `head`/`edge`/`rim`: o usuário
  preferiu `head` por já ser o termo usado no protocolo pro tipo 1
  (Aro/Dual), mantendo consistência entre os dois tipos que compartilham
  o mesmo cabeamento físico.
- Implementar sensoreamento de posição de verdade (centro vs. borda
  detectado por timing/frequência entre 2 piezos, como pads profissionais
  caros fazem): descartado — exigiria modificar a lib vendorizada com DSP
  que ela não tem, fora de escopo pra um piezo simples + scan de
  amplitude.

## 2026-08-22 — Fase N: canal habilitado/desabilitado por pad (`padEnabled[]`)

**Decisão**: adicionar um flag booleano por pad (`padEnabled[i]`,
persistido em EEPROM) que, quando `false`, faz o firmware ignorar aquele
canal por completo — não roda `dispatchSensing()` nem `handlePadResult()`
pra ele, então nenhum ruído lido naquele pino pode virar `hit`/nota MIDI.
Editável tanto pelo app desktop (`set_pad` com `field: "enabled"`) quanto
pela tela/encoders (novo campo `ATIVO`, sempre o 2º item de qualquer tipo
de pad em `PAD_EDIT`).

**Contexto/Racional**: o usuário perguntou sobre um problema conhecido de
multiplexação analógica — um canal do CD4067 sem nenhum sensor físico
conectado fica com o pino de entrada flutuando (alta impedância), captando
ruído (RF, crosstalk do barramento compartilhado com os outros 15 canais
do mesmo chip). Como o firmware varre e processa os 32 canais em todo
`loop()`, um canal flutuando pode gerar `hit`/nota MIDI fantasma sem
ninguém tocar em nada.

**Importante (alinhado com o usuário antes de implementar)**: esse flag
resolve o caso "esse slot não tem sensor nenhum conectado" — não resolve
ruído entrando por acoplamento num canal que **tem** sensor conectado
(isso é hardware: resistor de sangramento ~1MΩ em paralelo com o piezo,
blindagem do fio, etc — fora do escopo de firmware). Documentado
explicitamente pra não criar a expectativa de que desabilitar canais
substitui os cuidados de fiação recomendados.

**Onde persiste**: `EEPROM_ENABLED_ADDR` (1 byte por pad, mesmo padrão já
usado por `padTypes[]`/`hihatPedalChannel[]`), inserido entre
`EEPROM_HIHAT_LINK_ADDR` e `EEPROM_GLOBAL_ADDR` — `EEPROM_SIZE` cresce em
`NUM_PADS` bytes. Todo canal começa habilitado por padrão (`true`) no
primeiro boot, pra não mudar o comportamento de quem já tem o módulo
montado com todos os 32 canais em uso.

**Onde aparece na tela/encoders**: `FIELD_ENABLED` foi inserido como o 2º
campo de `getFieldsForType()` (logo depois de `FIELD_SENSOR`, rótulo
`ATIVO`, faixa `0-1`) — universal pra todos os 9 tipos de pad. Isso empurra
o tipo com mais campos (`PAD_CYMBAL_3ZONE`/`PAD_SNARE_3ZONE`) pra exatos 12
campos, o limite de `MAX_FIELDS_PER_PAD` — não há mais margem pra
adicionar um campo universal novo sem aumentar essa constante. Canal
desabilitado aparece diferenciado (não escondido, por pedido do usuário):
na tela LIVE (grid), sem borda visível e número bem apagado (nunca acende,
já que nunca tem hit); na tela PADS, tipo/nota trocado por "OFF" na cor de
edição (`COL_EDIT`, mesma usada pra "valor em edição" no design/SPEC.md).

**App desktop**: mesmo padrão visual — `PadGrid.tsx` mostra a linha
esmaecida (`opacity: 0.55`) com "desligado" na cor `--edit`; `PadEditor.tsx`
tem um checkbox "Canal ativo" com uma dica explicando o que ele faz.
`HardwareSimulator.tsx` replica a mesma UX da tela real (item `ATIVO`
sempre em primeiro lugar na lista de campos do `PAD_EDIT`, grid LIVE e
lista PADS com o mesmo tratamento visual).

**Status de validação**: firmware compila e linka com sucesso (`pio run`);
app desktop com `npm run typecheck`/`npm run build` limpos. **Nada testado
em hardware real** — em especial, não temos como confirmar na prática que
um canal flutuando de fato geraria falsos hits antes dessa correção (é o
comportamento esperado de uma entrada ADC de alta impedância sem
terminação, mas só a bancada confirma o quanto de ruído aparece de
verdade).

**Alternativas descartadas**:
- Resolver só via hardware (resistor de sangramento em cada canal não
  usado): não descartado como prática recomendada (continua valendo pros
  canais que **têm** sensor), mas não resolve o caso de slots
  genuinamente vazios sem um componente físico ali — pra esse caso, o
  enable/disable por software é mais direto (nenhum componente extra
  precisa ser comprado/soldado só pra "desligar" um canal que não vai ser
  usado).
- Esconder canais desabilitados completamente das listas/grids: o usuário
  preferiu mostrar apagado/cinza, pra deixar claro que existem 32 canais
  físicos e que aquele slot está desligado de propósito (não quebrado ou
  esquecido).
- Empacotar `padEnabled[]` em bits (1 byte pros 8 primeiros pads, etc) em
  vez de 1 byte por pad: descartado por simplicidade — 32 bytes extras de
  EEPROM (NVS) não é um recurso escasso nesse projeto, e 1 byte/pad segue
  o mesmo padrão já usado por `padTypes[]`/`hihatPedalChannel[]`.

## 2026-08-22 — Fase O: assistente de auto-calibração ("auto-tune")

**Decisão**: adicionar um assistente que calibra `sensitivity`/`threshold`/
`scan_time`/`mask_time` de um pad automaticamente — o usuário bate no pad
8 vezes com intensidade normal/forte e o firmware calcula os 4 valores
sozinho, em vez de ajustar cada slider por tentativa e erro. Acessível
tanto pela tela/encoders (novo campo `CALIBRAR`, sempre o último item de
`PAD_EDIT`) quanto pelo protocolo serial (`start_autotune`/
`cancel_autotune`/`apply_autotune`), já que os dois caminhos disparam a
mesma máquina de estados no firmware.

**Contexto/Racional**: o usuário pediu pra explorar
[massimobernava/md-firmware](https://github.com/massimobernava/md-firmware)
(firmware do microDRUM/nanoDRUM) em busca de parâmetros de sensing que a
nossa lib base não tem. Entre vários achados (ver changelog dessa fase), o
recurso "Auto Tune" (`l_loop.ino`, `LogTool()`) se destacou como o de
maior valor prático: em vez de o usuário adivinhar valores de sensibilidade/
threshold/scan/mask por tentativa e erro (o fluxo manual que já tínhamos),
o firmware mede o próprio comportamento do sensor e calcula valores de
partida razoáveis. Implementamos uma versão própria, mais simples que o
original (que tem 2 fases de 25 golpes cada, ~50 no total, e um algoritmo
mais elaborado com várias correções incrementais) — nossa versão usa 1
fase de ruído (2s) + 8 golpes, suficiente pra uma estimativa razoável sem
exigir uma sessão longa do usuário.

**Algoritmo** (`autoTuneTick()` em `firmware/src/main.cpp`, chamado a cada
`loop()` só enquanto a tela `PAGE_AUTOTUNE` está ativa):
1. **Ruído (2s)**: mede o maior valor lido no canal sem que o usuário toque
   no pad — isso vira o piso de ruído (`atNoiseFloor`), com 30% de margem
   de segurança.
2. **Coleta de 8 golpes**: pra cada golpe, detecta o início (valor cruza o
   piso de ruído), acompanha o pico (`atHitPeak`, "assentou" quando nenhum
   valor maior aparece por 8ms) e o tempo até o sinal cair pra metade do
   pico (aproximação de "meia-vida" do decaimento). Acumula esses 3 números
   (tempo até o pico, tempo de meia-vida, valor do pico) pelos 8 golpes.
3. **Cálculo final**: `sensitivity` = pico médio + 15% de margem (deixa
   espaço pra acentos mais fortes que os batidos durante a calibração);
   `threshold` = piso de ruído (já calculado com margem no passo 1);
   `scan_time` = tempo médio até o pico + 20%; `mask_time` = tempo médio de
   meia-vida + 30% (mais generoso, pra evitar retrigger falso). Os 4
   valores são convertidos pra escala 1-100 usada no protocolo/tela
   (dividindo por 10, já que a lib usa `Valor*10` como limiar raw — ver
   `dualPiezoSensing()` etc em `hellodrum.cpp`).

**Só calibra o sensor principal (`pin_1`)**: pads de 2 canais (aro/borda/
cup) continuam precisando de ajuste manual pro 2º sensor — o algoritmo lê
`rawValue[atPad]` diretamente (não `pad.piezoValue`, que é privado na lib;
aplicamos a mesma transformação ESP32 que a lib faz internamente:
`1023 - raw/4`), e `pin_1 == atPad` só é garantido pro canal primário desse
projeto (ver `captureSignalSample()`, mesma convenção já documentada na
Fase G).

**Nova tela `PAGE_AUTOTUNE`**: acessada clicando em `CALIBRAR` (item
universal, sempre o último de `getFieldsForType()` — empurrou
`MAX_FIELDS_PER_PAD` de 12 pra 13, já que `PAD_CYMBAL_3ZONE`/
`PAD_SNARE_3ZONE` chegam a 13 campos agora). Durante o assistente, ENC1
fica desativado (não navega pra outro pad/página) — só ENC2 (aplicar,
quando pronto) e o hold de qualquer encoder (cancelar) funcionam. Resultado
fica em RAM até `PUSH` (aplicar) — mesma convenção de persistência
explícita via `GLOBAL > SALVAR` já usada pelo resto da edição via
encoders.

**Protocolo serial**: `start_autotune`/`cancel_autotune`/`apply_autotune` +
o evento `autotune_status`, emitido a cada mudança de fase relevante (não
só em resposta a comando) — dá pra acompanhar progresso em tempo real
mesmo disparando pelo app desktop, com a contagem de golpes atualizando
sozinha. Ver [04-protocolo-serial.md](04-protocolo-serial.md). Isso exigiu
um pequeno desvio da convenção "sem prototypes" já usada no arquivo:
`handleSerialCommand()` (definida bem antes no arquivo) precisa chamar
`startAutoTune()`/`cancelAutoTune()`/`applyAutoTuneResult()` (definidas
bem depois, junto do resto do fluxo de encoders) — resolvido com 3
forward declarations mínimas, em vez de mover ~250 linhas de código pra
mais cedo no arquivo.

**App desktop**: `PadEditor.tsx` ganhou um painel de calibração (botão
"Calibrar automaticamente", progresso de golpes, resultado com Aplicar/
Descartar). `mockDevice.ts` simula a sequência inteira com temporizadores
(não há ADC de verdade no navegador) — resultado plausível baseado nos
valores atuais do pad, só pra demonstrar a UI. `HardwareSimulator.tsx`
replica a mesma tela/fluxo (incluindo o item `CALIBRAR` na lista de
`PAD_EDIT`), também com temporização simulada.

**Status de validação**: firmware compila e linka com sucesso (`pio run`);
app desktop com `npm run typecheck`/`npm run build`, ambos limpos. **Nada
testado em hardware real** — em especial, os fatores de margem escolhidos
(+15% sensitivity, +20% scan, +30% mask, +30% no piso de ruído) são
estimativas razoáveis baseadas no racional do algoritmo, não calibrados
contra um piezo real — é bem provável que precisem de ajuste fino depois
de testar em bancada.

**Alternativas descartadas**:
- Replicar o algoritmo original do microDRUM ao pé da letra (2 fases de 25
  golpes, ~50 no total, com Gain calculado numa fase e Threshold/Scan/Mask
  na outra): descartado por ser desproporcionalmente mais longo (~2 min
  de golpes) pro ganho adicional — nossa versão simplificada (1 fase de
  ruído + 8 golpes) já produz uma estimativa razoável dos 4 parâmetros que
  o nosso modelo de dados usa.
- Calibrar `rim_sensitivity`/`rim_threshold` (2º sensor) também: descartado
  por ora — exigiria detectar e separar hits no sensor secundário durante
  a mesma janela de coleta, mais complexo, e a maioria dos pads (tipo 0,
  simples) não tem 2º sensor de qualquer forma.
- Persistir o resultado direto na EEPROM ao terminar a calibração (sem
  esperar `GLOBAL > SALVAR`): descartado pra manter consistência com o
  resto da edição via encoders, que já é RAM-only até salvar explicitamente.
- Adicionar `Gain` (multiplicador de calibração separado de sensitivity,
  como o microDRUM tem) nessa mesma fase: descartado por ora — o usuário
  priorizou auto-tune primeiro entre os achados da pesquisa; `Gain`,
  `Retrigger` e `Xtalk` ficam como candidatos pra uma fase futura.

## 2026-08-22 — Fase P: `Retrigger`, `Gain` e `Xtalk` (parâmetros do microDRUM)

**Decisão**: implementar os 3 parâmetros de sensing restantes encontrados
na pesquisa do microDRUM/nanoDRUM (Fase O) que ainda não tínhamos —
`retrigger`, `gain` e supressão de crosstalk (`xtalk`/`xtalk_group`) — um
por pad, universais (aparecem pra todos os 9 tipos). Cada um teve uma
estratégia de implementação bem diferente, dependendo do quanto o ponto de
intervenção necessário estava exposto pela lib vendorizada:

### `Retrigger` — exigiu modificar a lib (a única mudança "de lógica" de sensing que já fizemos nela)

O `mask_time` da lib é um corte rígido: `if (time_hit - time_end < maskTime)
{ return; }` — nenhuma pancada nova é considerada até o tempo todo passar,
não importa a força. Essa lógica mora inteiramente em variáveis **privadas**
da classe `HelloDrum` (`time_hit`, `time_end`, `loopTimes`) — inacessíveis
de `main.cpp`. Não tinha como implementar retrigger de fora sem reescrever
a detecção de hit inteira por conta própria (abandonando a lib pra esse
caso). Em vez disso, modificamos a própria lib (4 funções: `singlePiezoSensing()`,
`dualPiezoSensing()`, `cymbal2zoneSensing()`, `cymbal3zoneSensing()` —
confirmado por grep que só existem esses 4 pontos de "`time_hit - time_end
< maskTime`" no arquivo inteiro; `HHMUX()`/`HH2zoneMUX()` e variantes já
chamam essas mesmas 4 funções internamente, então cobrem também chimbal).
Adicionado um novo campo público `retrigger` (byte, 0-100) à classe
`HelloDrum`, default `0` (== comportamento original, exato, sem nenhuma
mudança de resultado pra quem não usar o recurso). Quando `retrigger > 0`,
dentro do `mask_time` calculamos um "piso" que decai com o tempo desde o
pico anterior (`piso = pico_anterior - tempo_decorrido*(retrigger+1)/16` —
mesma fórmula do original) e deixamos passar se a pancada nova ultrapassar
esse piso. Interessante: o código original já tinha o comentário
`//compare time to cancel retrigger` nesse exato ponto — o autor original
claramente já tinha o conceito em mente, só nunca implementou o decaimento.

**Nota**: essa é a primeira vez que modificamos a *lógica* de detecção de
hit da lib (as mudanças anteriores documentadas em
[03-biblioteca-hellodrum.md](03-biblioteca-hellodrum.md) foram um bug de
índice de array e um problema de linkage — nunca uma mudança de
comportamento). Mantivemos o padrão de "0 = sem mudança nenhuma" pra não
alterar silenciosamente o comportamento de quem já tinha esse projeto
configurado.

### `Gain` — resolvido inteiramente em `main.cpp`, sem tocar na lib

`Gain` (10-200 = 0.10x-2.00x, 100 = neutro) normaliza a amplitude lida do
sensor **antes** do threshold — útil pra compensar piezos com saída muito
forte ou muito fraca sem precisar reajustar sensibilidade/threshold junto.
Como o valor "em repouso" do ADC (sem ninguém tocando o pad) fica próximo
do topo de escala (`rawValue` perto de 4095, é disso que vem o
`1023 - raw/4` da lib — a transformação assume repouso ≈ topo de escala),
multiplicar `rawValue` diretamente por um fator quebraria essa suposição
(um gain de 0.5, por exemplo, criaria uma leitura de "repouso" de ~511 em
vez de ~0 depois da transformação, gerando hits fantasma). A fórmula que
usamos preserva o repouso independente do gain: `raw' = 4095 - gain*(4095 -
raw)` — só escala o *desvio* em relação ao topo de escala, não o valor
absoluto. Aplicado em `applyPadGain()`, chamado a cada `loop()` logo depois
do `mux[].scan()` e antes do `dispatchSensing()` — a lib nunca fica sabendo
que existe um gain, só lê um `rawValue[]` já calibrado. Pra pads de 2
canais, o mesmo gain é aplicado aos dois canais (pele+aro) — não tem um
campo separado pro 2º canal, diferente de sensitivity/threshold que já têm
`rim_sensitivity`/`rim_threshold` — decisão de simplicidade, ver
"Alternativas descartadas".

### `Xtalk`/`Xtalk_group` — também resolvido em `main.cpp`, sem tocar na lib

O microDRUM tem 2 mecanismos de crosstalk (grupo de pads montados juntos, e
índice compartilhado entre multiplexadores). Implementamos só **um**
mecanismo, mais genérico — grupos de pads definidos livremente pelo usuário
(`xtalk_group`, 0-4, `0` = nenhum) — que cobre os dois casos de uso: tanto
"esses pads estão no mesmo rack" (vibração mecânica) quanto "esses dois
canais especificamente dão crosstalk entre si" (inclusive o caso mais
óbvio pro nosso hardware: o mesmo índice local nos 2 CD4067, que
compartilham o barramento S0-S3 — ver
[02-hardware.md](02-hardware.md)) — o usuário só precisa colocar os pads
suspeitos no mesmo grupo.

**Algoritmo** (`suppressCrosstalk()`, chamado a cada `loop()` depois do
`dispatchSensing()` e antes do `handlePadResult()` — ou seja, depois que a
lib já decidiu hit/velocity, mas antes de qualquer nota/protocolo saírem):
1. Pra cada pad que bateu nesse ciclo, calcula o pico entre suas zonas
   (`velocity`/`velocityRim`/`velocityCup`, todos públicos na lib).
2. Pra cada pad com `xtalk_group > 0` e `xtalk > 0`, compara seu próprio
   pico com o **maior pico entre os OUTROS pads do mesmo grupo** (excluindo
   ele mesmo — importante: sem essa exclusão, um pad com 2 zonas batendo
   ao mesmo tempo poderia suprimir a si mesmo, já que suas próprias zonas
   estariam no "grupo"). Se a diferença passar de uma margem (que encolhe
   conforme `xtalk` sobe — `margem = (100-xtalk)*127/100`), o hit inteiro
   desse pad é descartado (`hit`/`hitRim`/`hitCup` voltam a `false`).

Complexidade O(32²) no pior caso (32 pads, busca linear pelo "maior dos
outros do grupo") — irrelevante num ESP32-S3 a 240MHz rodando isso 1x por
`loop()`.

**Onde persiste**: os 3 parâmetros (`retrigger` fica dentro do próprio
objeto `HelloDrum`, mas **não** é persistido pelo mecanismo próprio da lib
— `loadMemory()`/`initMemory()` só conhecem os 10 campos originais) ganham
blocos próprios de EEPROM em `main.cpp` (`EEPROM_RETRIGGER_ADDR`,
`EEPROM_GAIN_ADDR`, `EEPROM_XTALK_ADDR`, `EEPROM_XTALK_GROUP_ADDR`, 1
byte/pad cada), mesmo padrão já usado pra `enabled` (Fase N). `EEPROM_SIZE`
cresce em `4*NUM_PADS` bytes.

**Tela/encoders**: `RETRIG` e `GAIN` entram logo depois de `MASK`
(universal, todos os tipos); `XTALK`/`XGRUPO` entram no fim da lista, antes
de `CALIBRAR`. Isso empurra `MAX_FIELDS_PER_PAD` de 13 pra 17 — o tipo mais
cheio (`PAD_CYMBAL_3ZONE`/`PAD_SNARE_3ZONE`) chega exatamente nesse limite.
Uma lista de 17 itens numa tela de 7 linhas visíveis significa bastante
scroll pra tipos de 2 canais — aceito por ora, dado que Retrigger/Gain/
Xtalk são parâmetros de ajuste fino, usados bem menos que os básicos
(sensibilidade/threshold/scan/mask), que continuam nas primeiras posições.

**Status de validação**: firmware compila e linka com sucesso (`pio run`),
incluindo a lib vendorizada modificada; app desktop com `npm run
typecheck`/`npm run build`, ambos limpos. **Nada testado em hardware
real** — em especial: (1) a fórmula de retrigger nunca foi testada contra
um piezo de verdade tocando um rufo rápido; (2) a fórmula de gain foi
derivada matematicamente (preservar o repouso apesar do multiplicador),
não validada contra um piezo real de saída fraca/forte; (3) crosstalk
nunca foi testado com 2 pads de verdade montados no mesmo rack, ou entre
os 2 CD4067 de verdade.

**Alternativas descartadas**:
- Implementar retrigger de fora da lib, com sensing próprio em `main.cpp`
  (abandonando `dispatchSensing()`/a lib pra pads com retrigger ativado):
  descartado — mais complexo, duplicaria lógica de scan/curva já madura na
  lib, e o ponto de intervenção necessário (`time_hit`/`time_end`) é
  simples o suficiente pra modificar direto com baixo risco.
- `Gain` separado pro 2º canal (`rim_gain`, mesmo padrão de
  `rim_sensitivity`/`rim_threshold`): descartado por simplicidade — um
  gain só, aplicado aos dois canais de um pad de 2 zonas, já resolve o
  caso comum (o mesmo tipo de piezo em ambos os sensores do mesmo pad);
  diferenças de gain entre pele e aro do mesmo pad seriam um refinamento
  raro.
- Implementar os 2 mecanismos de crosstalk do microDRUM (grupo E índice de
  multiplexador) separadamente: descartado — o mecanismo de grupo, sendo
  livremente configurável pelo usuário, já cobre o caso do índice
  compartilhado entre os 2 CD4067 (é só colocar os pads de índice `c` e
  `16+c` no mesmo grupo, se isso realmente causar problema na prática).
- Comparar o pico entre TODOS os pads do grupo sem excluir o próprio pad
  da comparação: descartado — causaria falsa supressão de pads de 2 zonas
  que batem em 2 sensores no mesmo instante (ex: um rimshot forte que
  ativa pele e aro juntos).

## Fase Q (2026-08-31): bug não resolvido no array `pads[]` — contorno temporário

**Contexto**: depois de resolver a tela em branco (curto de solda) e o
`ARDUINO_USB_CDC_ON_BOOT` travando o boot antes do `setup()`, sobrou um
terceiro problema, este sem causa raiz identificada apesar de várias
horas de investigação isolada.

**Sintoma**: `HelloDrum pads[NUM_PADS] = { HelloDrum(0,1), HelloDrum(1,2),
..., HelloDrum(31) };` (lista de inicializadores com construtores
não-triviais, a forma original desde a Fase A) trava o boot — watchdog
reset (`RTCWDT_RTC_RST` ou `TG1WDT_SYS_RST`, variou) antes do `setup()`
ser alcançado, sem nenhum erro/exceção impressa.

**Isolamento passo a passo** (ambiente `test_pads` no `platformio.ini`,
código em `firmware/src/test_pads.cpp`):
1. **Bisecção por tamanho do array** (forma antiga, lista de
   inicializadores): 4, 16, 24, 26 elementos funcionam; 27, 28, 32
   travam. Hipótese inicial: os temporários de cada elemento do
   initializer-list de um array de tipo não-POD podem ficar vivos
   simultaneamente até o fim da instrução inteira (sem garantia de RVO
   fora de C++17) — `sizeof(HelloDrum)` (~100 bytes) × 27+ elementos
   estouraria a pilha de 4KB da tarefa principal (`main_task`, onde
   construtores globais rodam, antes do `setup()`).
2. **Correção aplicada**: array default (`HelloDrum pads[N];`, construtor
   padrão trivial adicionado) + `HelloDrum::begin(pin1[, pin2])` chamado
   num loop dentro do `setup()` (tarefa do loop, pilha ~8KB, uma chamada
   sequencial por vez, sem acumular temporários). Ver
   `firmware/lib/HelloDrum-arduino-Library/src/hellodrum.h`/`.cpp`.
3. **A correção não resolveu sozinha**: com `pads[i].begin(i, i+1)` num
   loop simples (sem nenhum print), o boot ainda trava — a mesma
   sequência 0..31 que travava como array atômico também trava como
   sequência de chamadas. Isso invalida a hipótese de pilha da tarefa
   principal como causa única (ou pelo menos como causa suficiente).
4. **Isolamento por valor**: chamadas *individuais* `begin(28,29)`,
   `begin(28,0)` (só `pin_1`=28), `begin(0,28)` (só `pin_2`=28),
   `begin(29,0)` (só `pin_1`=29) — todas funcionam perfeitamente quando
   testadas sozinhas (todas as outras 31 chamadas usando valores
   constantes seguros). Isso descarta "valor 27/28/29 específico" como
   causa isolada.
5. **Teste de watchdog por tempo**: um loop de 32 iterações fazendo só
   `Serial.printf`/`flush` (sem nenhuma chamada a `HelloDrum`) completa
   sem problema — descarta `Serial.flush()`/watchdog de tarefa por
   tempo como causa.
6. **BLE-MIDI desativado** (`#if 0` em volta de `BleMidi.begin()` etc.)
   no firmware principal: não mudou nada — mesmo reset, endereço de
   crash variando entre tentativas (`0x4037fd40`, `0x4037c75c`,
   `0x40379501`, etc.) — um sintoma mais consistente com memória
   corrompida (stack/heap overflow com conteúdo variável) do que um bug
   de lógica determinístico.
7. **Único padrão 100% confirmado seguro**: 32 chamadas *idênticas*
   `begin(0, 1)` (valores constantes, sem variar), tanto isoladas quanto
   no firmware principal completo. É o contorno atualmente em uso.

**Conclusão**: a causa raiz não foi encontrada. As evidências apontam pra
algo relacionado a variação/sequência de valores através de múltiplas
chamadas (não um valor isolado, não contagem pura, não tempo/watchdog,
não BLE, não `Serial`), mas o mecanismo exato permanece desconhecido. É
possível que seja uma instabilidade de hardware (a mesma placa já
apresentou um curto de solda nesta mesma sessão) em vez de um bug de
software determinístico — os endereços de crash variáveis entre
tentativas idênticas são o principal indício nessa direção.

**Contorno em produção agora** (`firmware/src/main.cpp`, função
`setup()`): todos os 32 pads chamam `begin(0, 1)` — todos leem o mesmo
canal 0 do MUX. Isso desbloqueia o boot (tela, USB-MIDI, BLE-MIDI,
EEPROM funcionando), mas **não há leitura real de sensor por pad
ainda** — qualquer sinal no canal 0 dispara "hit" em todos os 32 pads
simultaneamente (visível no protocolo NDJSON). Suficiente pra validar a
interface e o restante do firmware; **insuficiente pra uso real com
pads físicos conectados**.

**Pendente pra retomar em outra sessão** (✅ **resolvido na Fase S,
2026-09-01** — ver seção abaixo):
1. Investigar a causa raiz com mais tempo/calma (o ambiente
   `test_pads` fica pronto pra isso — `pio run -e test_pads -t upload
   --upload-port COM5`).
2. Cogitar testar com outro cabo/porta USB ou verificar solda de novo,
   dado o histórico de instabilidade física nesta placa.
3. Restaurar `pads[i].begin(i, i+1)` (leitura real por pad) assim que a
   causa raiz for entendida ou contornada de forma mais específica —
   sem isso, os 2x CD4067/32 pads físicos não podem ser conectados de
   verdade.
4. BLE-MIDI foi reativado (não era a causa) — o `#if 0` foi removido do
   `main.cpp`.

## 2026-09-01 — Fase R: USB-MIDI nunca enumerava como MIDI (só como "Serial" genérica) — causa raiz e correção

**Sintoma**: pela porta USB nativa (não a ponte UART/CH343 usada pra
gravar/depurar), o Windows sempre reconhecia o módulo como um dispositivo
serial genérico ("USB Serial Device") — nunca como MIDI, em nenhuma DAW.
Isso valia mesmo depois de: renomear o dispositivo pra "DRUMCORE" (USB e
BLE), adicionar um número de série USB (descartando a hipótese de cache de
driver do Windows), e desinstalar/reinstalar o driver. O `setup()`
completava normalmente (sem travar) em todos os testes.

**Investigação (na ordem, cada hipótese testada e descartada antes da
próxima)**:
1. Ordem de inicialização (`TinyUSBDevice.begin()` → `Serial.begin()` →
   `usb_midi.setStringDescriptor()` → `MIDI.begin()` → detach/attach) bate
   exatamente com o exemplo oficial da Adafruit
   (`Adafruit_TinyUSB_Library/examples/MIDI/midi_test`) — não é isso.
2. `ARDUINO_USB_MODE` de fato resolve pra `0` no `main.cpp` (confirmado
   via `#pragma message` num build só de compilação) — o aviso de
   "redefined" do compilador (`-DARDUINO_USB_MODE=1` do board JSON vs
   `-D ARDUINO_USB_MODE=0` do nosso `build_flags`) é inofensivo: o
   último `-D` da linha de comando vence, é só o nosso valor.
3. Cache de driver do Windows (VID/PID sem serial, placa já gravada com
   várias configs de USB diferentes ao longo do projeto) — descartado
   depois de adicionar `TinyUSBDevice.setSerialDescriptor(...)` +
   desinstalar o driver manualmente: nenhuma mudança.
4. `-Wl,--allow-multiple-definition` (documentada desde a Fase B/C como
   necessária pra resolver símbolos duplicados entre a TinyUSB
   pré-compilada do core, `libarduino_tinyusb.a`, e a TinyUSB que a lib
   Adafruit compila do próprio source) — removida como teste: o link
   funcionou **limpo, sem nenhum erro de símbolo duplicado**. Ou seja,
   sem tocar em `USB.h`, `libarduino_tinyusb.a` nunca chegava a ser
   puxado pro link — essa flag não tinha efeito nenhum nesse ponto (mas
   acabou sendo necessária de novo mais adiante, ver item 6).

**Causa raiz encontrada**: no ESP32 (diferente de SAMD/RP2040/nRF, as
outras placas que a lib Adafruit TinyUSB suporta),
`Adafruit_USBD_Device::begin()` **não liga o periférico USB de
verdade** — é essencialmente um no-op nesse chip
(`Adafruit_TinyUSB_esp32.cpp`: `TinyUSB_Port_InitDevice()` é um stub
vazio de propósito, com o comentário "ESP32 will use the arduino-esp32
core initialization"). A inicialização de verdade (reset do periférico,
mux dos pinos D+/D-, reset do core USB, `tusb_init()`) só acontece via
`USB.begin()` (classe `ESPUSB`, `USB.cpp`, parte do core arduino-esp32) —
e o core só chama isso sozinho no boot (`cores/esp32/main.cpp`,
`app_main()`) se `ARDUINO_USB_CDC_ON_BOOT`, `ARDUINO_USB_MSC_ON_BOOT` ou
`ARDUINO_USB_DFU_ON_BOOT` estiverem ligados. Desligamos
`CDC_ON_BOOT` de propósito desde a Fase B (corrigiu um travamento de
boot diferente — ver comentário em `firmware/platformio.ini`), e nunca
ligamos os outros dois — então esse religamento nunca acontecia. A porta
nativa ficava com a identidade padrão de fábrica (serial simples via
periférico "USB-Serial/JTAG" do ROM), e o descritor MIDI que
`usb_midi`/`Adafruit_USBD_Device` monta em RAM nunca chegava a ser
servido de verdade pro host.

**Primeira tentativa de correção (falhou)**: chamar `USB.begin()`
manualmente no `setup()`, depois de montar o descritor MIDI. Isso *religa*
o hardware de verdade (confirmado — RAM subiu, uma task nova apareceu),
mas trava o boot: a task "usbd" criada por `esp32-hal-tinyusb.c`
(`while(1) { tud_task(); }`, sem nunca ceder o processador) usa a
implementação de `tud_task()` que "ganha" no link (a da lib Adafruit,
compilada do source — vence a do core, pré-compilada em
`libarduino_tinyusb.a`, por causa do `-Wl,--allow-multiple-definition`,
que mantém a primeira definição encontrada). Como são duas pilhas TinyUSB
diferentes (a task foi escrita pra rodar com a implementação do core, não
a da Adafruit), o resultado é incompatível: núcleo 0 trava, watchdog
aborta (`task_wdt: ... CPU 0: usbd`), reboot em loop infinito — pior que
o bug original (nem enumerava mais como dispositivo nenhum). Revertida.

**Correção que funcionou**: replicar, dentro do nosso próprio
`firmware/src/main.cpp` (sem editar o arquivo vendorizado da lib), a
mesma sequência de inicialização que a própria Adafruit usa nas *outras*
plataformas que suporta — a que está deixada desligada de propósito em
`Adafruit_TinyUSB_esp32.cpp` num bloco `#if 0` ("This port implemented is
not needed and left here for reference only"):
`periph_module_reset/enable(PERIPH_USB_MODULE)` → `usb_hal_init()` +
configuração dos pinos D+/D- (`USBPHY_DM_NUM`/`DP_NUM`) → reset do core
USB (`USB0.grstctl`) → `tusb_init()` → task própria rodando
`tud_task()` em loop. A diferença crucial pra tentativa anterior: aqui
**tudo** (a task, o `tusb_init()`, o reset de hardware) usa peças de
baixo nível que vêm da *mesma* origem (Adafruit) que "ganha" no link —
nada do core (`USB.h`/`esp32-hal-tinyusb.c`) é chamado, então não há
mistura de duas implementações incompatíveis. `-Wl,--allow-multiple-definition`
continua necessária (sem ela, o link falha com dezenas de "multiple
definition" reais entre `usbd.c` do core e da Adafruit — só não aparecem
se nada referenciar `USB.h`/símbolos do core).

Detalhe de API: a versão da lib TinyUSB vendorizada aqui (Adafruit TinyUSB
Library 3.7.7) trocou `tusb_init(void)` (macro antiga, exige
`CFG_TUSB_RHPORT0_MODE` definido em `tusb_config.h`, o que esse port ESP32
da Adafruit não define) por `tusb_init(rhport, tusb_rhport_init_t*)`
(API nova, com `role`/`speed` explícitos) — usamos a nova.

Função nova: `bringUpNativeUsbHardware()`, chamada em `setup()` logo
**depois** de `MIDI.begin()` (o descritor precisa estar completo em RAM
antes do hardware religar e o host pedir o descritor pela primeira vez).

**Confirmado funcionando**: "DRUMCORE" aparece como entrada MIDI ativa
numa DAW real (Audio & MIDI Setup), com o dispositivo plugado na porta
nativa (não a ponte UART/CH343).

**BLE-MIDI**: confirmado anunciando corretamente — "DRUMCORE" aparece num
scanner BLE genérico (nRF Connect for Mobile), então o rádio/firmware
está OK. O problema é do lado do host: o Windows MIDI Services (a pilha
nova da Microsoft) ainda não tem transporte nativo BLE-MIDI (recurso
planejado, não implementado até fev/2026 — ver blog oficial da Microsoft).
Solução: um app-ponte que conecta o dispositivo BLE-MIDI ao Windows MIDI
Services, ex. "BLE-MIDI Connect" (Microsoft Store) ou "Perfect Bluetooth
MIDI For Windows" (open source). Não é um bug do firmware.

## 2026-09-01 — Fase S: causa raiz do bug do array `pads[]` (Fase Q) finalmente encontrada

**Retomando a Fase Q** (bug não resolvido, contorno em uso: todos os pads
com `begin(0, 1)` constante) — a pedido do Rodrigo, investigação
retomada usando o ambiente `test_pads` já preparado pra isso.

**O que mudou desde a Fase Q que permitiu achar a causa**: dessa vez o
log de boot da `test_pads` (via monitor serial, COM5) mostrou uma linha
que a investigação anterior não tinha capturado:

```
DEBUG: entrou no setup() (test_pads, sem flush)
[   307][E][esp32-hal-gpio.c:102] __pinMode(): Invalid pin selected
... (8x, repetindo)
rst:0x8 (TG1WDT_SYS_RST)
```

**Causa raiz**: `hellodrum.cpp` (biblioteca vendorizada) tem, no topo do
arquivo, `//#define PULLUP //<-- uncomment this line to enable pullup
mode (UNTESTED).` — uma flag opcional do autor original, comentada por
padrão. O código usa `#ifdef PULLUP` em vários lugares (incluindo dentro
de `begin()`) pra decidir se chama `pinMode(pin, INPUT_PULLUP)`. O
problema: o **core arduino-esp32 já define seu próprio `PULLUP` **
(`#define PULLUP 0x04` em `esp32-hal-gpio.h`, uma das flags de modo do
`pinMode()`), incluído via `Arduino.h`. Como `#ifdef` só verifica se o
*nome* existe (não o valor nem quem definiu), `#ifdef PULLUP` dava
**sempre verdadeiro no ESP32** — completamente ao contrário da intenção
do autor original (que assumia que só ficaria ativo se *ele* descomentasse
aquela linha).

Efeito prático: **todo `begin()` chamava `pinMode(pin1/pin2, INPUT_PULLUP)`**
— só que nesse projeto (arquitetura com 2x CD4067 MUX), `pin1`/`pin2`
passados pra `begin()` não são pinos GPIO físicos — são **índices de
canal do MUX** (0-31). `pinMode(26, INPUT_PULLUP)`, por exemplo, mexe de
verdade no GPIO26 físico do ESP32-S3, que nesse chip é reservado
internamente (barramento da flash/PSRAM) — reconfigurar esse pino em
pleno funcionamento corrompe o acesso à flash/PSRAM em uso, causando os
travamentos/resets observados. Isso explica com precisão o padrão
"funciona até ~26, quebra a partir de 27+" documentado na Fase Q — 26 é
exatamente onde a sequência de índices (0..31, usados dois a dois como
`pin1`/`pin2`) começa a alcançar a faixa de GPIOs reservados. Também
explica por que chamadas *isoladas* com os mesmos valores perigosos
funcionavam bem sozinhas (no ambiente `test_pads` mínimo, sem SPI/TFT/USB
disputando os mesmos barramentos) mas travavam na sequência completa
dentro do firmware principal, e por que os endereços de crash variavam
entre tentativas idênticas (corrupção de hardware/memória real, não um
bug de lógica determinístico — a Fase Q já suspeitava disso, só não
sabia a origem).

**Bug secundário encontrado no mesmo lugar**: as funções de sensing
(`singlePiezoSensing`, `dualPiezoSensing`, `cymbal2zoneSensing`, etc.)
também têm blocos `#ifdef PULLUP` que **invertem a leitura do sensor**
(`1023 - valor`) — como a flag estava sempre "ligada" sem ninguém saber,
a leitura de todo pad teria saído invertida assim que sensores de verdade
fossem conectados. Não chegou a ser testado com hardware real ainda, mas
seria um bug funcional sério, separado do travamento.

**Correção** (`firmware/lib/HelloDrum-arduino-Library/src/hellodrum.cpp`):
- Removidos os dois blocos `#ifdef PULLUP` dentro de `begin(byte pin1)` e
  `begin(byte pin1, byte pin2)` (o `pinMode()` nunca faz sentido aqui
  nessa arquitetura de MUX).
- Adicionado `#undef PULLUP` logo após os `#include`s no topo do arquivo,
  neutralizando os `#ifdef PULLUP` restantes (nas funções de sensing) de
  uma vez só, sem precisar editar cada um — devolve o comportamento que o
  autor original pretendia (flag desligada por padrão).

**Confirmado no hardware real**: `test_pads` com a sequência real
`pads[i].begin(i, i+1)` completa os 32 `begin()` sem nenhum watchdog
reset (antes travava sempre). Restaurado em `firmware/src/main.cpp`
(`setup()`) — cada pad volta a usar seu próprio canal do MUX
(`pin_1=i`, `pin_2=i+1`, o último só `pin_1=i` pra não passar `pin_2=32`,
que não existiria) em vez do contorno `begin(0,1)` constante. Boot
completo confirmado no firmware principal também (tela, USB-MIDI,
BLE-MIDI, EEPROM).

**Ainda pendente**: `padEnabled[i] = false` forçado pra todos os canais
continua em `setup()` — não é mais sobre o bug do `pads[]` (resolvido),
e sim porque os 2x CD4067/32 pads físicos ainda não estão conectados de
verdade; canais ADC flutuando captam ruído e disparariam "hit" aleatórios
sem esse bloqueio. Remover assim que o MUX/pads forem conectados.

## 2026-09-01 — Fase S (continuação): primeiro teste de sensing com hardware real — segundo bug encontrado (fórmula do ESP32 invertida)

**Contexto**: com o MUX físico ainda a caminho, montado um teste
simplificado — 2 piezos ligados direto em 2 GPIOs do ESP32-S3
(`GPIO17`/`GPIO18`, livres — ver `docs/02-hardware.md`), configurados
como um pad dual-zone (`PAD_DUAL`, corpo+aro) via
`TEST_DIRECT_HEAD_PIN`/`TEST_DIRECT_RIM_PIN` em
`firmware/src/main.cpp` (bloco marcado "TESTE TEMPORARIO", removido
quando o MUX chegar).

**Isolamento do circuito** (antes de desconfiar do firmware):
1. Primeiro teste com só um fio solto (sem piezo, sem resistor) disparava
   "hit" sem parar. Aterrar o pino manualmente não mudava nada — mas o log
   de depuração (valor bruto do `analogRead()`, adicionado temporariamente)
   mostrou que o valor bruto realmente ia pra 0 quando aterrado, então os
   pinos físicos estavam certos.
2. Rastreado o circuito de referência oficial da
   `HelloDrum-arduino-Library` — os diagramas "Single Piezo Circuit" e
   "ESP32 with MUX" do próprio autor
   mostram um resistor de 100 kΩ **em paralelo** com os dois terminais do
   piezo (não em série, sem pull-up nenhum) — o repouso fica perto de 0 V,
   uma batida faz o valor subir. Um esquemático próprio foi montado
   (artifact, publicado no chat) documentando isso pro Rodrigo antes de
   conectar os piezos de verdade.
3. Com o resistor de 100 kΩ de verdade instalado (piezo + resistor em
   paralelo, sem pull-up interno), o valor bruto em repouso realmente
   ficou baixo (0 a ~100) — confirma que o circuito está correto.

**Segundo bug encontrado**: mesmo com o circuito certo (repouso baixo),
o firmware continuava disparando "hit" em **todo loop**, sempre com
velocidade máxima. Causa: `hellodrum.cpp` tem, em várias funções de
sensing (`singlePiezoSensing`, `dualPiezoSensing`, `cymbal2zoneSensing`,
`cymbal3zoneSensing`), um trecho só pra ESP32:
```cpp
#ifdef ESP32
  piezoValue = 1023 - piezoValue / 4;
#endif
```
O `/4` normaliza os 12 bits do ADC do ESP32 pra uma faixa equivalente a
10 bits (correto — bate com o range que o resto do código, escrito
originalmente pra AVR/10 bits, espera). Mas o `1023 -` **inverte** a
leitura: repouso (bruto perto de 0) virava o valor **mais alto**
possível — sempre acima do threshold, disparando sem parar — e uma
batida forte (bruto perto do máximo) viraria o valor **mais baixo**,
abaixo do threshold. Exatamente o oposto do que o circuito oficial (sem
inversão, sem pull-up) produz. Não há nenhum estágio inversor (op-amp,
etc.) em nenhum dos dois diagramas oficiais consultados — a inversão no
código não tem justificativa aparente no hardware de referência do
próprio autor.

**Correção** (mesmo arquivo, 4 funções de sensing baseadas em piezo):
trocado `piezoValue = 1023 - piezoValue / 4;` por só
`piezoValue = piezoValue / 4;` (idem pra `RimPiezoValue`/`sensorValue`) —
mantém a normalização de 12→10 bits, remove a inversão. **Não mexido**
em `TCRT5000Sensing`/`FSRSensing` (também têm inversões parecidas) —
são sensores de tecnologia diferente (óptico e resistivo,
respectivamente), sem diagrama de referência conferido ainda; ficam como
estão até serem testados/investigados separadamente.

**Confirmado com hardware real**: depois da correção, batidas reais no
piezo (corpo, `GPIO17`) geraram um "hit" por batida, zona correta
("head", antes sempre aparecia "rim" incorretamente), com velocidade
variando de forma plausível conforme a força de cada batida (33, 50, 88,
86, 24, 78, 64, 107, 74, 69, 65, 2, 97, 37, 81...) — primeira leitura de
sensor real e velocity-sensitive validada de ponta a ponta neste
projeto. Também removido o `pinMode(..., INPUT_PULLUP)` que tinha sido
adicionado antes (pro teste com fio solto, sem resistor) — com o
resistor de 100 kΩ de verdade instalado, pull-up interno não é mais
necessário (e formaria um divisor de tensão indesejado com o resistor).

## 2026-09-02 — Fase T: auto-tune consertado (mesma inversão do ESP32) e evoluído pra 3 níveis de força

**Auto-tune não funcionava**: com o primeiro pad real conectado
(`GPIO17`/`GPIO18`, teste sem MUX — ver Fase S), o assistente de
auto-calibração (Fase O) sempre estourava o timeout de 15 s sem detectar
nenhuma pancada. Causa: `autoTuneTick()`, em `firmware/src/main.cpp`,
tinha sua própria cópia manual da mesma fórmula de normalização do ESP32
que fora corrigida em `hellodrum.cpp` na Fase S — ainda com a inversão
(`1023 - rawValue[atPad] / 4`, em vez de só `rawValue[atPad] / 4`). Com a
fórmula invertida, o piso de ruído calculado na fase `AT_NOISE` (repouso
vira o valor mais alto possível) ficava maior que qualquer valor
alcançável numa pancada de verdade — o assistente nunca via nada acima
do "ruído". Corrigido pra usar a mesma fórmula (sem inversão) das
funções de sensing.

**Configuração corrompida (achado à parte)**: logo depois da correção
acima, o pad 0 tinha `sensitivity:0, threshold:0, mask_time:0, gain:200`
— resíduo de experimentação anterior, não um bug de firmware — causando
disparo constante e erros `map(): Invalid input range, min == max`
(`sensitivity == threshold == 0`). Diagnosticado com um `get_pad` via
script Python/`pyserial` direto na porta serial, corrigido ao vivo com
`set_pad` (sem reflash). Como proteção contra essa classe de config
inválida no futuro, `HelloDrum::curve()` (`hellodrum.cpp`) ganhou uma
salvaguarda: se `sensRaw <= threshold`, força `sensRaw = threshold + 1`
antes de continuar.

**Evolução pra 3 níveis de força**: depois de confirmado funcionando, a
calibração com um bloco único de 8 batidas (intensidade "normal/forte"
livre) foi trocada por 3 blocos de 8 — fraco, médio, forte (24 batidas no
total) — pra melhorar a precisão do resultado. Novo estado
`AutoTuneTier` (`AT_TIER_WEAK`/`AT_TIER_MEDIUM`/`AT_TIER_STRONG`) soma os
picos de cada nível separadamente (`atSumPeakByTier[3]`, em vez de um
único acumulador). `autoTuneTick()` avança de nível a cada 8 golpes
completos (fraco → médio → forte), só chamando `finishAutoTune()` depois
do nível forte.

**Fórmula do resultado** (`finishAutoTune()`): o nível fraco calibra o
`threshold` — 30% do caminho entre o piso de ruído (`atNoiseFloor`) e o
pico médio das batidas fracas, garantindo margem dos dois lados (acima
do ruído, abaixo da batida mais fraca de verdade). O nível forte calibra
a `sensitivity` (teto pra velocity=127) — pico médio das batidas fortes
+15% de folga pra acentos. O nível médio **não entra na fórmula** — é só
uma checagem de consistência implícita (o usuário realmente variou a
força entre os 3 blocos); não há validação automática disso ainda.
`scan_time`/`mask_time` continuam sendo a média sobre os 24 golpes (o
timing de subida/decaimento do sinal não varia muito por força).

**Protocolo/UI atualizados em conjunto**: `autotune_status` (evento
`"collecting"`) ganhou os campos `tier`/`tier_index`/`tier_count` — ver
[04-protocolo-serial.md](04-protocolo-serial.md). A tela física
(`renderAutoTune()`) mostra "NIVEL X/3" + "BATA FRACO/MEDIO/FORTE". O app
desktop (`PadEditor.tsx`, `mockDevice.ts` e o mockup de LCD em
`HardwareSimulator.tsx`) foram atualizados em paralelo pra refletir os 3
níveis, incluindo a simulação do modo demo (sem hardware).

**Tradeoff consciente**: 24 batidas é bem mais cansativo/demorado que as
8 originais — aceito pela precisão adicional (separar claramente o piso
de "toque fraco real" do teto de "toque forte real", em vez de inferir
os dois só do pico médio de um único bloco de intensidade livre).

## 2026-09-02 — Fase U: auto-tune passa a calibrar também o aro (2ª zona) em pads `PAD_DUAL`

**Motivação (ideia do Rodrigo)**: pads de 2 zonas (pele+aro) sempre
disparam os dois piezos juntos — bater na pele "vaza" um pouco pro aro, e
vice-versa. `dualPiezoSensing()` (`hellodrum.cpp`) decide a zona
comparando os dois picos do MESMO golpe, não olhando cada piezo isolado:

```cpp
if ((velocity - velocityRim < RimSensitivity) && (velocityRim > RimThreshold))
    // classifica como ARO
else
    // classifica como PELE
```

`rimThreshold` é o piso mínimo pro aro sequer ser considerado (rejeita
vazamento pequeno); `rimSensitivity` é a diferença máxima pele-aro ainda
aceita como aro de verdade. A Fase O/T nunca calibrava esses dois campos
— só davam pra ajustar na mão, sem dado real de golpes de aro nem do
vazamento cruzado.

**Desenho**: pads com `pad_type == PAD_DUAL` (1) fazem uma **2ª passada
inteira** (os mesmos 3 níveis × 8 golpes = 24 batidas) depois da passada
normal (que vira a rodada `PRIMARY`, pele) — agora pedindo golpes no aro
(rodada `SECONDARY`). Durante as DUAS rodadas, o canal "passivo" (o que o
usuário não está batendo no momento) também é lido em paralelo — não dá
pra calibrar isolado, já que o que importa é a diferença entre os dois.
Novo `AutoTuneZone` (`AT_ZONE_PRIMARY`/`AT_ZONE_SECONDARY`) e variáveis:
`atOtherPeak` (pico do canal passivo durante o golpe atual), `atCrossFloor`
(pior vazamento visto no aro durante golpes na pele — rodada PRIMARY),
`atMaxHeadRimDiff` (pior diferença pele-aro vista durante golpes reais no
aro — rodada SECONDARY), `atSumRimPeakByTier[3]` (picos do aro por nível,
rodada SECONDARY). `autoTuneTick()` só avança pra rodada SECONDARY depois
do nível forte da PRIMARY (se `atCalibrateSecondZone`); só chama
`finishAutoTune()` depois do nível forte da rodada que estiver ativa.

**Fórmula do resultado do aro** (`finishAutoTune()`, só quando
`atCalibrateSecondZone`): `rimThreshold` usa a mesma lógica de margem do
threshold principal (30% do caminho), mas o "piso" agora é
`atCrossFloor` (o vazamento, não o silêncio) em vez do ruído de fundo.
`rimSensitivity` usa o pior caso (`atMaxHeadRimDiff`, tipicamente nas
batidas mais fracas de aro, onde o vazamento da pele pesa proporcionalmente
mais) + uma folga fixa de 15 (não multiplicativa — a diferença pele-aro
pode ser negativa em golpes de aro bem limpos, então uma margem % faria
menos sentido que uma margem fixa nesse caso).

**Escopo deliberadamente limitado a `PAD_DUAL`**: prato 2/3 zonas
(`PAD_CYMBAL_2ZONE`/`PAD_CYMBAL_3ZONE`) também usa 2 canais físicos, mas
`cymbal2zoneSensing()`/`cymbal3zoneSensing()` discriminam zona por FAIXA
de threshold dentro do MESMO canal (edge/cup), não por diferença entre 2
canais — lógica de calibração diferente, que exigiria revisão própria.
Deixado de fora por ora.

**Protocolo/UI atualizados em conjunto**: `autotune_status` ganhou `zone`
(`"primary"`/`"rim"`, só aparece pra pads de aro) no evento `"collecting"`,
e `rim_sensitivity`/`rim_threshold` no `"done"` — ver
[04-protocolo-serial.md](04-protocolo-serial.md). A tela física
(`renderAutoTune()`) mostra "PELE NIVEL X/3"/"ARO NIVEL X/3" durante a
coleta e 2 linhas extras (R.SENS/R.THRE) no resultado. O app desktop
(`PadEditor.tsx`, `mockDevice.ts`, mockup de LCD em
`HardwareSimulator.tsx`) foram atualizados em paralelo, incluindo a
simulação do modo demo.

**Tradeoff consciente** (aceito pelo Rodrigo antes de implementar): pads
de aro agora levam 48 golpes pra calibrar (24 pele + 24 aro) em vez de
24 — o dobro de tempo/esforço físico, pela mesma lógica da Fase T
(precisão > velocidade do assistente).

## 2026-09-02 — Fase V: auto-tune estendido pra prato/caixa 3 zonas (edge + cup/aro)

**Contexto**: perguntado se a caixa 3 zonas (`PAD_SNARE_3ZONE`) já
entrava no auto-tune de 2 zonas da Fase U - não entrava, de propósito
(deixado de fora explicitamente naquela fase). Investigado
`cymbal3zoneSensing()` (`hellodrum.cpp`, reaproveitada tanto por
`PAD_CYMBAL_3ZONE` quanto por `PAD_SNARE_3ZONE` - mesmo código, zonas só
renomeadas no dispatch em `main.cpp`) pra confirmar como ela discrimina
zona, já que é uma lógica **diferente** da do `PAD_DUAL`:

```cpp
// bow/head: aro abaixo do piso o tempo todo
if (velocity > Threshold && firstSensorValue < edgeThreshold && lastSensorValue < edgeThreshold) { ... hit = true; }
// edge/borda: aro entre os 2 pisos, decaindo
else if (velocity > Threshold && firstSensorValue > edgeThreshold && firstSensorValue < cupThreshold && firstSensorValue > lastSensorValue) { ... hitRim = true; }
// cup/aro-forte: aro acima do piso mais alto, decaindo rapido
else if (velocity > Threshold && firstSensorValue > cupThreshold && lastSensorValue < edgeThreshold) { ... hitCup = true; }
// choke: aro alto e sustentado (nao decai)
else if (firstSensorValue > edgeThreshold && lastSensorValue > edgeThreshold && lastSensorValue >= firstSensorValue) { choke = true; }
```

Diferente do `PAD_DUAL` (compara 2 canais), aqui a zona vem de **2
faixas de threshold no MESMO canal secundário** (`edgeThreshold`/
`cupThreshold` - os mesmos campos `rimSensitivity`/`rimThreshold`,
reaproveitados com rótulos diferentes por `pad_type`: "EDGETHR"/"CUPTHR"
no prato, "EDGETHR"/"RIMTHR" na caixa). `velocity` já é a diferença
`|piezoValue - sensorValue|` calculada pela própria lib - não precisamos
reproduzir isso, só o nível (`firstSensorValue`, aproximado aqui pelo
pico observado logo após o início do golpe, igual ao resto do
assistente) que cada zona tipicamente atinge.

**Generalização do desenho da Fase U**: trocado o `bool
atCalibrateSecondZone` (só sim/não) por um `enum AutoTuneShape`
(`AT_SHAPE_SINGLE`/`AT_SHAPE_DUAL`/`AT_SHAPE_TRI`), decidido em
`startAutoTune()` a partir do `pad_type`. `AT_ZONE_TERTIARY` adicionado
ao `AutoTuneZone` (agora `PRIMARY`/`SECONDARY`/`TERTIARY`). Novo
`atSumCupByTier[3]` acumula os picos da rodada TERTIARY (cup/aro-forte).
`autoTuneHasNextZone()`/`autoTuneNextZone()` centralizam a sequência de
zonas por formato, usados tanto no avanço de rodada em `autoTuneTick()`
quanto (implicitamente, via `atShape`) no resto do código.

**Fórmula do resultado** (`finishAutoTune()`, ramo `AT_SHAPE_TRI`):
`edgeThreshold` usa a mesma margem de 30% já usada em toda parte deste
assistente (piso = pior vazamento da rodada PRIMARY no canal secundário,
teto = média fraca da rodada SECONDARY/edge). `cupThreshold` usa 30% do
caminho entre a média FORTE da rodada SECONDARY (edge mais alto
observado) e a média FRACA da rodada TERTIARY (cup mais fraco
observado) - separa as 2 faixas com folga dos dois lados. Salvaguarda:
se as faixas colidirem (edge forte >= cup fraco, fisicamente
inesperado), abre um vão mínimo acima do `edgeThreshold` em vez de
deixar `cupThreshold` inalcançável.

**Nomenclatura de zona alinhada ao protocolo existente**: aproveitando a
generalização, `autotune_status.zone` deixou de usar nomes genéricos
(`"primary"`/`"rim"` como na Fase U original) e passou a reaproveitar o
MESMO vocabulário já usado no evento `hit` por `pad_type`: `"head"`/
`"rim"` (`PAD_DUAL`), `"bow"`/`"edge"`/`"cup"` (`PAD_CYMBAL_3ZONE`),
`"head"`/`"edge"`/`"rim"` (`PAD_SNARE_3ZONE`) - inclusive a 1ª zona
(antes sempre `"primary"`) agora tem o nome de verdade. Pequena mudança
de contrato ainda dentro da mesma sessão de desenvolvimento (nada em
produção consumindo o nome antigo) - ver
[04-protocolo-serial.md](04-protocolo-serial.md).

**Fora de escopo ainda**: `choke` (o gesto de abafar o prato com a mão)
não é uma "zona" que o auto-tune calibra - não tem um `threshold`
próprio na lib, é só a combinação "aro alto e sustentado" das mesmas 2
faixas já calibradas.

**Protocolo/UI atualizados em conjunto**: tela física
(`autoTuneZoneTftLabel()`) mostra "BOW"/"EDGE"/"CUP" (prato) ou "PELE"/
"BORDA"/"ARO" (caixa) durante a coleta. App desktop: `protocol.ts` ganhou
`autoTuneShapeFor()`/`autoTuneZonesFor()` como fonte única do mapeamento
`pad_type` → sequência de zonas (evita reimplementar esse mapeamento 3x
em `PadEditor.tsx`, `mockDevice.ts` e `HardwareSimulator.tsx`); os
rótulos de `rim_sensitivity`/`rim_threshold` no resultado final do
`PadEditor.tsx` agora vêm de `PAD_TYPE_META[padType].fields` (mesmo
rótulo dos sliders) em vez de texto fixo "aro", já que esses 2 campos
significam coisas diferentes por `pad_type`.

**Tradeoff consciente** (mesma lógica das Fases T/U): prato/caixa 3
zonas agora levam 72 golpes pra calibrar (24 por zona × 3 zonas) em vez
de 24.

## 2026-09-02 — Fase W: auto-tune ignora o gain antigo do pad (calibra sempre "do zero")

**Bug relatado (Rodrigo)**: em alguns pads, o nível FRACO da calibração
não estava detectando as batidas — hipótese dele: o código ainda estava
"usando as configurações atuais do pad" em vez de tratar a calibração
como se o pad estivesse sendo configurado do zero.

**Causa raiz confirmada**: `rawValue[]` não é um array próprio do
`main.cpp` — é literalmente o mesmo `int rawValue[]` global declarado
dentro da lib vendorizada (`hellodrum.cpp`), usado tanto pelas funções
`*MUX()` (`piezoValue = rawValue[pin_1]`, sensing de verdade) quanto por
`autoTuneTick()` (que lê o mesmo array pra decidir se uma pancada
aconteceu). `applyPadGain()` (Fase P) escala esse array usando o `gain`
salvo do pad, ANTES de qualquer um dos dois o ler (`loop()`:
`applyPadGain()` → `dispatchSensing()` → ... → `autoTuneTick()`). Se o
pad já tinha um `gain` != 100 (de uma calibração anterior ou ajuste
manual), toda leitura que o assistente faz já vem escalada por esse
valor.

Isso por si só não deveria quebrar a detecção (ruído e sinal escalam
juntos, proporcionalmente) — mas a margem de segurança do piso de
ruído usada pelo assistente tem um termo ADITIVO fixo que não escala:
`atNoiseFloor = (int)(atNoiseFloor * 1.3f) + 5;`. Com gain baixo (ex:
30%), uma batida fraca de verdade que renderia ~30 sem gain vira ~9; o
ruído ambiente que renderia ~2 vira ~0.6, e o piso calculado
(`0.6*1.3+5 ≈ 5.8`) fica perigosamente perto (ou acima) desse ~9 — a
batida fraca não supera o piso, e o assistente nunca detecta o golpe.
Bate exatamente com o sintoma relatado (especificamente o nível
FRACO, o mais sensível a essa margem).

**Correção**: `startAutoTune()` salva o gain atual do pad em
`atSavedGain` e força `padGain[pad] = 100` (neutro) assim que a
calibração começa. Como `rawValue[]` é compartilhado com a lib, isso
também neutraliza a sensing de verdade (`dispatchSensing()`) enquanto a
tela AUTOTUNE está aberta — efeito colateral aceito de propósito: é
exatamente o "calibrar do zero" pedido, e é consistente (os resultados
calculados pelo assistente já assumiam implicitamente gain neutro,
mesmo antes dessa correção).

Novo helper `restoreAutoTuneGainIfActive()` (`if (atState != AT_IDLE)
padGain[atPad] = atSavedGain;`, idempotente) chamado nos 2 únicos
caminhos que saem do assistente sem aplicar: `cancelAutoTune()`
(cobre cancelar em qualquer fase, e os 2 estados de abortado — timeout/
canal desligado — que só saem de fato via `cancelAutoTune()`) e
`goToLive()` (o "pânico" ENC1 hold, que pode interromper a calibração
vindo de qualquer tela sem passar por `cancelAutoTune()`).
`applyAutoTuneResult()`, em vez de restaurar, fixa `padGain[pad] = 100`
de propósito — o resultado calculado só faz sentido combinado com gain
neutro, então uma calibração aplicada sempre zera o gain antigo do pad.

## 2026-09-02 — Fase X: calibração do controlador de pedal (HHC) — range + inversão

**Motivação (Rodrigo)**: o assistente de auto-calibração (Fase O-W) só
serve pra sensores de IMPACTO (piezo) — mede pico de pancada. O
controlador de pedal (`PAD_HIHAT_PEDAL`/`PAD_HIHAT_OPTICAL`, `pad_type`
6/7) é um sensor de POSIÇÃO contínua, sem golpe nenhum — precisava de 2
coisas diferentes: (1) descobrir o range real do sensor (o percurso
físico do pedal raramente cobre o ADC inteiro 0-4095, dependendo do
modelo/montagem — sem calibrar isso, o CC de saída nunca chega nem no 0
nem no 127 de verdade), e (2) uma opção de inverter, porque alguns
sensores mandam a posição de trás pra frente.

**Onde threshold/sensitivity já eram usados pro pedal**: investigando
`FSRSensing()`/`TCRT5000Sensing()` (`hellodrum.cpp`) antes de implementar,
achamos que os campos `threshold`/`sensitivity` **já** funcionam como os
2 pontos de calibração do range — `curve()` faz
`map(valorInterno, threshold*mult, sensitivity*mult, 1, 127)` (`mult` =
10 pra FSR, 40 pro TCRT5000, compensando a normalização de bits
diferente entre os 2 sensores). Ou seja: o mecanismo de range já existia,
só nunca tinha um jeito automático de descobrir os 2 valores certos —
sempre foi ajuste manual, no escuro.

**Assistente de captura de range (`AT_HH_OPEN`/`AT_HH_CLOSED`,
`autoTuneTick()`)**: sensor de posição contínua não tem "golpe" pra
esperar — o assistente pula direto pra essas 2 fases (sem `AT_NOISE`,
sem tiers/zonas). Pede pra segurar o pedal **solto** por
`AUTOTUNE_HH_HOLD_MS` (3s), amostrando só o último `AUTOTUNE_HH_SAMPLE_MS`
(1s) — dá tempo do usuário chegar na posição e o sinal assentar antes de
contar — depois **pressionado até o fim**, mesma lógica.
`hihatInternalValue()`/`hihatFieldMultiplier()` replicam a MESMA
transformação que `FSRSensing()`/`TCRT5000Sensing()` fazem no valor bruto
(inversão + normalização de bits), pra threshold/sensitivity saírem na
escala certa pra sensing de verdade usar depois.

**`finishHihatCalibration()`**: `threshold` = o MENOR dos 2 valores
capturados, `sensitivity` = o MAIOR — sempre nessa ordem (min/max),
garantindo uma faixa válida não-degenerada **independente da polaridade
física do sensor** (não importa se "aberto" deu um valor maior ou menor
que "fechado" no ADC — o range calculado sempre faz sentido). A direção
certa (fica por conta do campo `hihat_invert`, separado — ver abaixo)
não entra nessa conta.

**`hihat_invert`, campo novo (não reaproveitado)**: diferente de
`rim_sensitivity`/`rim_threshold` (sempre reaproveitados entre tipos),
"inverter" é um conceito que nenhum campo existente cobria — novo array
`padHihatInvert[NUM_PADS]` + byte próprio na EEPROM (mesmo padrão do
`padGain[]`/Fase P). Aplicado **no CC final**
(`fireControlChange(HIHAT_PEDAL_CC, invert ? 127-cc : cc)`), não no
`rawValue[]` nem no range calibrado — assim tem efeito imediato ao
ligar/desligar o switch na tela ou no app, sem precisar recalibrar depois
(threshold/sensitivity continuam representando o sensor "como ele é
fisicamente", e o invert só corrige a direção na saída).

**Protocolo**: `autotune_status` ganha `phase`
(`"hh_open"`/`"hh_closed"`) + `hold_elapsed_ms`/`hold_target_ms` no lugar
de `tier`/`zone` pra esse fluxo, e `mode: "hihat_range"` no resultado
final (avisa a UI que `sensitivity`/`threshold` são teto/piso de
posição, não pico de pancada). `set_pad` ganha o campo `hihat_invert`
(`0`/`1`). Ver [04-protocolo-serial.md](04-protocolo-serial.md) e
[05-tipos-de-sensor.md](05-tipos-de-sensor.md).

**UI**: tela física mostra "SOLTE O PEDAL"/"PRESSIONE O PEDAL" com
contagem regressiva de 3s e a mesma barra de progresso das outras
calibrações; tela de resultado usa "MAXIMO"/"MINIMO" em vez de
"SENSIB"/"THRESH" (esconde SCAN/MASK, que esse fluxo não recalcula). App
desktop: checkbox dedicado "Inverter" no `PadEditor.tsx` (mesmo padrão
do checkbox "Canal ativo", não um slider) e mockup de LCD em
`HardwareSimulator.tsx` ganharam um novo item especial na lista de
campos (igual ATIVO), já que a tela física trata isso como mais uma
linha rotacionável, não um checkbox separado.

**Nunca testado com hardware real** — nem o sensor físico (FSR/VH-10/
VH-11/TCRT5000), nem o assistente de captura de range. Ver
[05-tipos-de-sensor.md](05-tipos-de-sensor.md), seção final.

## 2026-09-04 — Fase Y: navegação reduzida de 2 encoders pra 1 (rotate/click/hold)

**Motivação (Rodrigo)**: revisando o uso real da tela (Fase J), o ENC1
(página/pad em foco) tinha poucas responsabilidades na prática — só troca
de página no topo (LIVE/PADS/GLOBAL) e troca de pad dentro de
PAD_EDIT/SIGNAL — enquanto o ENC2 concentrava quase toda a navegação
(item, valor, confirmar, salvar/restaurar, disparar auto-tune). Decisão:
manter 1 encoder só, cobrindo tudo via uma hierarquia de profundidade
(rotate = navega no nível atual, click = desce um nível, hold = sobe um
nível), em vez de 2 eixos simultâneos. Checkpoint de git criado antes
dessa mudança (commit `373dfb9`), caso a UI de 1 encoder não ficasse boa.

**Hardware**: mantidos os pinos GPIO41/40/39 (antes ENC2_A/B/SW) como o
encoder único (`ENC_A`/`ENC_B`/`ENC_SW`) — era o que tinha mais lógica já
testada. GPIO1/2/42 (antes ENC1_A/B/SW) ficam livres/sobressalentes no
header direito.

**Modelo de profundidade** (substitui o mapeamento de 2 encoders da seção
"Navegação: 2 encoders..." acima, já desatualizada desde a Fase J):
- Topo (`homeBrowsing == true`, páginas LIVE/PADS/GLOBAL): rotate circula
  entre as 3; click em PADS/GLOBAL desce pra dentro da lista/linhas dessa
  página (`homeBrowsing = false`); sem efeito em LIVE (nada pra descer).
- PADS (`homeBrowsing == false`): rotate move o cursor da lista; click
  entra em PAD_EDIT no pad selecionado; hold sobe de volta pro topo (ou
  vai direto pra LIVE se já não tinha nada abaixo — "pânico" repetido).
- PAD_EDIT: rotate move o item selecionado (ou ajusta o valor, se
  `editingValue`); click entra em editar o valor (`editingValue = true`,
  antes era toggle — agora só entra, sair é só via hold) ou dispara a
  ação da linha (CALIBRAR/SINAL); hold sai da edição de valor, ou volta
  pra PADS (mantendo `homeBrowsing = false`, ou seja volta pra dentro da
  lista, não pro carrossel do topo).
- GLOBAL: mesmo padrão de PADS+PAD_EDIT combinados (linha selecionada →
  editando valor), com SALVAR/RESTAURAR disparando na hora do click, sem
  entrar em modo de edição.
- SIGNAL/AUTOTUNE: sem esse conceito de profundidade — SIGNAL só usa
  rotate (troca de pad, era o antigo ENC1 rotate) e hold (volta pra
  PAD_EDIT); AUTOTUNE só usa click (aplicar/cancelar) e hold (cancelar
  sempre), igual antes.

**Item novo "SINAL" em PAD_EDIT**: antes, alternar entre PAD_EDIT e
SIGNAL (gráfico ao vivo do sinal) era o click do ENC1 — uma ação lateral
que não cabe no modelo de profundidade linear de 1 encoder só. Virou uma
linha universal na lista de campos (`FIELD_VIEW_SIGNAL`, rótulo "SINAL",
logo antes de "CALIBRAR"), clicável igual ao auto-tune — subiu
`MAX_FIELDS_PER_PAD` de 17 pra 18 (o pad mais cheio, 3 zonas, já usava os
17 antigos por inteiro).

**Protocolo serial**: `enc_input` continua aceitando `"enc": 1` ou `2`
(compatibilidade com o app desktop existente) — os dois valores agora
caem no mesmo handler único (`onEncRotate`/`onEncClick`/`onEncHold`). Não
quebra o app, mas o app não reflete mais o comportamento real do hardware
físico (só 1 encoder).

**Nunca testado com hardware real** — a lógica foi só compilada/gravada
(`pio run -e esp32-s3-devkitc-1 -t upload`), sem o encoder físico
conectado ainda pra confirmar a navegação na tela.

**Ajuste (2026-09-05, "Y2")**: 2 refinamentos pedidos depois de usar a
navegação de 1 encoder na prática:
- **Click volta a alternar** entra/sai do modo de edição de valor em
  PAD_EDIT/GLOBAL (não é mais só "entra, sair é via hold" como descrito
  acima) — testando, ficou claro que exigir hold só pra confirmar um
  valor já ajustado era fricção desnecessária. Hold continua funcionando
  igual (sempre "voltar"), só deixou de ser a ÚNICA forma de sair da
  edição.
- **Hold em PADS/GLOBAL vai direto pra LIVE**, não importa o sub-nível
  (carrossel do topo, lista/linhas, ou editando um valor) — em vez de
  subir um nível de cada vez feito nesses casos.
- Rodapés de instrução nas telas PAD_EDIT/AUTOTUNE (ex: "GIRA SELECIONA"/
  "PUSH ENTRA") removidos — interface considerada simples o bastante sem
  eles.

**Simulador do app desktop removido (2026-09-04, mesmo dia)**:
`HardwareSimulator.tsx`/`EncoderRemote.tsx`/`docs/06-simulador-hardware.md`
(e ~400 linhas de CSS associadas) foram apagados por completo — não fazia
mais sentido simular 2 encoders físicos que deixaram de existir, e
recriar o simulador pro modelo de 1 encoder seria trabalho duplicado sem
pedido concreto. A configuração de pads (`PadEditor.tsx`/`PadGrid.tsx`) e
o modo demo (`mockDevice.ts`) não dependiam do simulador e continuam
intactos. Isso resolve o "próximo passo" que a nota original de protocolo
(logo acima) tinha deixado em aberto.

## 2026-09-05 — Fase Z: pinout reorganizado por função (encoder+tela vs MUX)

**Motivação (Rodrigo)**: a ideia de 1 encoder só (Fase Y) foi aprovada em
definitivo. Segundo pedido: reorganizar o pinout físico — encoder e tela
devem sair de um lado da placa, o MUX do outro, sempre seguindo a
contiguidade dos pinos usados em cada header. Sobre `3V3`/`GND`: não
precisa se preocupar, porque a placa física vai ganhar esses pads
disponíveis nos dois lados (modificação por fora do dev board original) —
isso é o que abre espaço pra reorganizar por função em vez de por
alimentação (que era a restrição real por trás da divisão da Fase L).

**Novo critério de divisão**: até aqui (Fase L), a regra era "quem precisa
de VCC fica no header esquerdo, que é o único com `3V3`". Com `3V3`/`GND`
nos dois headers, a regra virou "agrupar por função": interface do
usuário (encoder + tela) de um lado, sensing (2x CD4067) do outro. A
regra de contiguidade física (cada subsistema usa um bloco de pinos sem
nenhum outro sinal no meio) continua igual — só mudou o critério de quais
sinais formam cada bloco.

**Como os blocos bateram exatos, sem sobra**: o header esquerdo tem um
bloco contíguo de exatamente 9 GPIOs livres logo após o `3V3`/`RST`
(`4,5,6,7,15,16,17,18,8` — descontando os 2 pinos de strapping `3`/`46`
que ficam no meio dessa faixa física) — e encoder (3 sinais) + tela (6
sinais) somam exatamente 9. O header direito tem um bloco contíguo de
6 GPIOs (`1,2,42,41,40,39` — a mesma faixa que os 2 encoders usavam antes
da Fase Y, descontando o `GPIO38` evitado) — e o MUX (S0-S3 + SIG0 + SIG1)
precisa de exatamente 6. Coincidência conveniente, não foi preciso abrir
mão de contiguidade em lugar nenhum pra fazer a troca.

**Pinout resultante**:
| Header | Sinal | GPIO (era) |
|---|---|---|
| Esquerdo | Encoder A | 4 (era MUX S0) |
| Esquerdo | Encoder B | 5 (era MUX S1) |
| Esquerdo | Encoder SW | 6 (era MUX S2) |
| Esquerdo | TFT DC | 7 (era MUX S3) |
| Esquerdo | TFT CS | 15 (era MUX SIG0) |
| Esquerdo | TFT MOSI | 16 (era MUX SIG1) |
| Esquerdo | TFT SCLK | 17 (era teste hall temporário) |
| Esquerdo | TFT BLK | 18 (era livre) |
| Esquerdo | TFT RST | 8 (era livre) |
| Direito | MUX S0 | 42 (era Encoder SW) |
| Direito | MUX S1 | 41 (era Encoder B) |
| Direito | MUX S2 | 40 (era Encoder A) |
| Direito | MUX S3 | 39 (era livre) |
| Direito | MUX0 SIG | 1 (era livre, ex-ENC1 A) |
| Direito | MUX1 SIG | 2 (era livre, ex-ENC1 B) |

**Ajuste (2026-09-06)**: a tabela acima foi a primeira versão da Fase Z,
com a tela na mesma ordem de sinais que ela já usava antes (DC/CS/MOSI/
SCLK/BLK/RST, só migrada de posição). O Rodrigo pediu pra reordenar os 6
GPIOs da tela pra bater com a ordem física real do conector dela (`GND
VDD SCL SDA RES DC CS BLK`) — dentro do MESMO bloco de pinos (`7,15,16,
17,18,8`, a posição não mudou, só qual sinal vai em cada um):
`SCL(7) → SDA(15) → RES(16) → DC(17) → CS(18) → BLK(8)`. Isso é o mesmo
tipo de espelhamento que a Fase L original fazia (antes perto do `GND` da
base do header; agora dentro do bloco novo, com `GND`/`VDD` da tela indo
em pads extras adicionados perto desse bloco). Atualizados
`firmware/src/main.cpp` (`#define TFT_SCLK/MOSI/RST/DC/CS/BLK`),
`docs/02-hardware.md` e o esquemático (`docs/assets/
esquematico-hellodrum.html` + cópia em `site/`).

**ADC1 em vez de ADC2 pro MUX**: dentro do bloco `1,2,42,41,40,39`, só
`GPIO1`/`GPIO2` têm ADC (ADC1_CH0/CH1) — os outros 4 (`42,41,40,39`) não
têm ADC nenhum, então SIG0/SIG1 (que precisam ler tensão analógica) só
podiam ir neles. Isso troca o MUX de ADC2 (Fase L, GPIO15/16) pra ADC1 —
simplifica o racional: ADC2 exigia justificar "tá seguro pq o projeto não
usa Wi-Fi"; ADC1 nunca conflita com nada, esse cuidado nem precisa
existir mais.

**Teste temporário do sensor hall migrado**: `TEST_DIRECT_HEAD_PIN` (ver
Fase S) usava GPIO17 — que virou `TFT_SCLK`, um sinal permanente agora.
Migrado pra GPIO9 (livre, ADC1, no antigo bloco da tela que ficou
desocupado).

**Correção encontrada de brinde**: `docs/02-hardware.md` listava
`GPIO43`/`GPIO44` como "livres, sem uso previsto" — na verdade são o UART
físico que o firmware usa pra `Serial` (protocolo NDJSON) quando compilado
com `ARDUINO_USB_CDC_ON_BOOT=0` (Fase R). Corrigido.

**Arquivos atualizados**: `firmware/src/main.cpp` (defines + comentário
de racional do pinout), `docs/02-hardware.md` (reescrito por completo —
divisão, tabelas, notas), `docs/assets/esquematico-hellodrum.html` (SVG
redesenhado com MUX no header direito e encoder+tela no esquerdo — cópia
sincronizada em `site/assets/schematic.html`).

**Pendente — projeto KiCad real não foi tocado**: `hardware/mainboard/
drumcore_mainboard.kicad_sch`/`.kicad_pcb` ainda têm o desenho de **2
encoders físicos** (símbolos `RotaryEncoder_Switch` duplicados, nets
`ENC1_*`/`ENC2_*`, conector `ENCODERS_CONN`) — a Fase Y só mudou o
firmware (liberou GPIO1/2/42), nunca atualizou a placa; a Fase Z também
não conseguiu (ferramenta de edição de KiCad — Konnect MCP — indisponível
nesta sessão). Falta decidir e aplicar: remover o footprint do 2º encoder
do design (ou deixar posicionado e não montar), e mover as nets do MUX/
tela/encoder pros headers corretos no esquemático e no PCB.

**Resolvido (2026-09-06) — mainboard aposentada, não atualizada**:
Rodrigo decidiu que não vale mais a pena manter um PCB dedicado pra
mainboard — com o pinout novo (Fase Z), a fiação ficou pouca o bastante
(1 encoder + 1 tela de um lado, MUX do outro, tudo em blocos contíguos)
pra conectar tudo direto nos headers da própria placa de dev do ESP32-S3,
sem precisar desenhar/fabricar uma PCB própria. `hardware/mainboard/`
(o `.kicad_sch`/`.kicad_pcb`/`.kicad_pro`/`.kicad_prl` e o `.png`) foi
**apagado do repositório** — o pendente acima (2 encoders desatualizados
no design) fica sem efeito, não existe mais projeto pra corrigir. A
jackboard (`hardware/jackboard/`) continua normalmente, é uma placa de
verdade (conectores TRS + rede de proteção) que ainda faz sentido
fabricar.

**Validado em hardware real (2026-09-06)**: Rodrigo religou o encoder
(GPIO4/5/6) e a tela (GPIO7/15/16/17/18/8, ordem ajustada pro conector
dela) nesse pinout novo e confirmou os dois funcionando — navegação por
encoder e imagem na tela. **Ainda não validado**: o MUX (header direito,
GPIO1/2/42/41/40/39) — o CD4067 físico ainda não foi conectado nesse
layout.
