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
`MIDI` que já usamos pro USB. Usamos `BLEMIDI_CREATE_INSTANCE("HelloDrum",
BleMidi)` em vez do default — isso nomeia a interface MIDI como `BleMidi` e,
como efeito colateral da macro, cria também um objeto de transporte chamado
`BLEBleMidi` (prefixo `BLE` + nome escolhido) — é nele (não em `BleMidi`)
que registramos os callbacks de conexão. `"HelloDrum"` é o nome anunciado via
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
`PAD_FLASH_MS`) pra ficar fiel ao firmware. Ver
[06-simulador-hardware.md](06-simulador-hardware.md).

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
