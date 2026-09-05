# Biblioteca base: HelloDrum-arduino-Library

Fonte original: https://github.com/RyoKosaka/HelloDrum-arduino-Library (v0.7.7,
autor Ryo Kosaka). Vendorizada em `firmware/lib/HelloDrum-arduino-Library`
(histórico Git original removido — o rastreio de mudanças passa a ser feito no
Git deste projeto).

## O que a lib já oferece

- **Sensores**: piezo simples e duplo (com aro/rim), prato 2 zonas (Roland) e 3
  zonas (Yamaha), hi-hat via SoftPot/FSR/óptico (TCRT5000) ou controlador Roland
  VH10/VH11, pedal de hi-hat (FSR).
- **Multiplexação**: `HelloDrumMUX_4051` (8 canais, usada nas Fases A-J) e
  `HelloDrumMUX_4067` (16 canais, usada a partir da Fase K com o breakout
  "HW-178") — ver detalhes de como múltiplos MUXes coexistem em
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
HelloDrumMUX_4067 mux(S0, S1, S2, S3, pinADC); // um por placa HW-178/CD4067
HelloDrum pad(indiceNoRawValue);                // ver cálculo do índice abaixo

// no loop():
mux.scan();               // popula rawValue[] para os 16 canais deste MUX
pad.settingEnable();      // habilita fluxo de configuração via botões físicos
pad.singlePiezoMUX();     // faz a leitura/detecção de hit para este pad
if (pad.hit) { /* pad.note, pad.velocity disponíveis */ }
```

**Cálculo do índice do pad quando há múltiplos MUX**: `pin1 = muxNum * canais_por_mux + canal_local`
(`canais_por_mux` = 8 para `HelloDrumMUX_4051`, 16 para `HelloDrumMUX_4067` —
ver `scan()` de cada classe em `hellodrum.cpp`), onde `muxNum` é a ordem de
instanciação (0 para o 1º MUX criado no código, 1 para o 2º, etc — ver
`muxIndex` estático, **compartilhado entre as duas classes**: misturar
`HelloDrumMUX_4051` e `HelloDrumMUX_4067` no mesmo projeto exigiria calcular
os offsets manualmente, já que não é uma numeração por tipo). No nosso
projeto (Fase K) usamos só `HelloDrumMUX_4067`, então `muxNum` vai só de 0 a
1.

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

## Configuração via encoders em vez de botões (Fase C — superada pela Fase J)

> **Atualização (Fase J, 2026-08-21)**: a partir do redesenho de UI descrito
> em [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md), `main.cpp`
> **parou de instanciar `HelloDrumButton`** e de chamar
> `readButton()`/`settingEnable()`/`GetPadName()`/`GetSettingItem()` — a
> navegação/edição inteira passou a ser código nosso, direto em `main.cpp`
> (`getFieldsForType()`/`getFieldValue()`/`setFieldValue()`). A seção abaixo
> descreve a abordagem da Fase C, mantida aqui como registro histórico —
> ainda é relevante se algum dia quisermos voltar a usar os 5 sinais
> SET/UP/DOWN/NEXT/BACK da lib (ex: pra um painel de botões físicos
> alternativo). A lib continua usada normalmente pra sensing
> (`singlePiezoMUX()` etc.) e persistência (`loadMemory()`/`initMemory()`) —
> só a camada de configuração via botões deixou de ser usada.

A classe `HelloDrumButton` pressupõe 5 botões físicos (EDIT/UP/DOWN/NEXT/BACK),
lidos via `readButtonState()` (que faz `digitalRead()` direto nos pinos do
construtor). Como optamos por encoder(s) rotativo(s) com chave em vez de
botões (2 até a Fase Y, 2026-09-04; 1 só depois — ver
[01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)), usamos o
overload `readButton(bool set, bool up, bool down, bool next, bool back)` —
que já existe na lib exatamente para isso, sem precisar modificar nada. O
`main.cpp` traduz cada evento de encoder (giro/clique) num pulso momentâneo de
um desses 5 sinais e chama `readButton()` manualmente a cada `loop()`;
`HelloDrum::settingEnable()` continua sendo chamado normalmente para todos os
pads, sem saber a diferença entre botão físico e encoder.

**Pegadinha encontrada**: `settingName()` não é só cosmético — incrementa
`nameIndexMax` (limite da navegação entre pads). Sem chamar isso uma vez por
pad no `setup()`, a navegação fica travada no pad 0. Também guarda o
**ponteiro** recebido (não copia a string), então os nomes dos pads precisam
viver num buffer `static`/global, não num buffer temporário de escopo local.
Detalhes em [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).

**Observação (não é nosso bug)**: `HelloDrumButton::GetSettingItem()` não tem
`return` para o caso de `padType[nameIndex]` não bater com nenhum dos tipos
conhecidos (gera o warning "control reaches end of non-void function" no
build) — inofensivo no nosso caso porque todos os nossos pads são
`singlePiezoMUX` (`padType == Snum`), mas é uma fragilidade pré-existente da
lib original, não introduzida por nós.

## Persistência: EEPROM/NVS (Fase D — resolvido)

A lib já vem com `loadMemory()`/`initMemory()` e o wrapper `EEPROM_ESP`
(NVS do ESP32) — só precisávamos ativar isso corretamente. Adicionamos
`EEPROM_ESP.begin()` + um byte de flag ("já inicializado") em `main.cpp`
pra decidir, no boot, entre `initMemory()` (grava defaults, primeiro boot)
ou `loadMemory()` (restaura o que foi salvo). As escritas do dia-a-dia (via
os encoders, em `settingEnable()`) já commitam sozinhas, sem código nosso.
Detalhes e o racional completo em
[01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).

Essa fase também foi quando encontramos o bug do endereço errado de EEPROM
pro item SENSITIVITY (ver "Modificações em relação ao original" abaixo) — só
apareceu agora porque antes a EEPROM nunca tinha sido de fato inicializada
(as escritas eram no-ops silenciosos).

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

### 2026-08-20 — `settingEnable()`: endereço de EEPROM errado pro item SENSITIVITY (UP)

**Arquivo**: `firmware/lib/HelloDrum-arduino-Library/src/hellodrum.cpp`

**Motivo**: ao ativar a persistência em EEPROM (Fase D), percebemos que o
branch de incremento (UP) do item SENSITIVITY dentro de `settingEnable()`
escrevia em `padNum * 8`, enquanto **todos** os outros 9 itens (e o próprio
branch de decremento/DOWN do item SENSITIVITY) usam `padNum * 10` — o layout
real usado por `loadMemory()`/`initMemory()`. Para qualquer pad com
`padNum >= 1`, isso gravava por cima de um byte de **outro** pad (ex: subir a
sensibilidade do pad 1 escrevia no endereço 8, que é o `noteRim` do pad 0).

**O que foi feito**: os dois branches afetados (versão ESP32 com
`EEPROM_ESP.write`, e a versão AVR/não-ESP32 com `EEPROM.write`, ambas no
mesmo padrão) foram corrigidos para `padNum * 10`, consistente com o resto do
código.

### 2026-08-21 — `rawValue[]`: `static` → `extern` (linkage interno impedia leitura externa)

**Arquivos**: `firmware/lib/HelloDrum-arduino-Library/src/hellodrum.h` e
`hellodrum.cpp`

**Motivo**: a tela SIGNAL da Fase J (osciloscópio simplificado do envelope
do sensor, ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md))
precisa que `main.cpp` leia os valores brutos do ADC que
`HelloDrumMUX_4051::scan()` grava em `rawValue[]`. O array era declarado
`static int rawValue[16 ou 64]` direto no header — em C/C++, `static` no
escopo de arquivo/header dá **linkage interno**: cada arquivo `.cpp` que
inclui o header (`hellodrum.cpp` e `main.cpp`) passa a ter sua **própria
cópia isolada** do array, não uma variável compartilhada. `main.cpp` estaria
lendo sempre zeros do seu próprio `rawValue[]`, nunca o que
`hellodrum.cpp` de fato escreve. Esse é o mesmo padrão de bug já visto (e
corrigido de outras formas) com `nameIndex`/`editCheck`/`padType[]` nas
fases anteriores — variáveis `static` de escopo de arquivo nessa lib
tendem a esconder esse problema.

**O que foi feito**: `rawValue[]` trocou de `static int rawValue[...]` para
`extern int rawValue[...]` no header (só declara, não reserva memória), com
a definição real (`int rawValue[...]`, sem `static`/`extern`) movida para
`hellodrum.cpp`, logo após os `#include` de EEPROM — precisa existir
exatamente uma vez no programa inteiro, e esse arquivo já é o "dono" natural
do estado interno de sensing. Nenhuma lógica de `scan()` foi alterada, só a
visibilidade do array.

### 2026-08-22 — Campo `retrigger` + limiar decrescente no `mask_time` (Fase P)

**Arquivos**: `firmware/lib/HelloDrum-arduino-Library/src/hellodrum.h` e
`hellodrum.cpp`

**Motivo**: pesquisa no microDRUM/nanoDRUM (Fase O) encontrou o parâmetro
`Retrigger` — dentro do `mask_time`, deixa passar uma pancada nova se ela
for bem mais forte que a anterior, em vez do corte rígido que a lib sempre
teve. Diferente das mudanças anteriores (bug de índice, linkage), essa é a
**primeira mudança de lógica de sensing** feita nessa lib vendorizada — foi
necessária porque as variáveis que controlam o `mask_time`
(`time_hit`/`time_end`/`loopTimes`) são **privadas** na classe `HelloDrum`,
sem nenhum jeito de implementar isso de fora sem reescrever a detecção de
hit inteira em `main.cpp`.

**O que foi feito**: novo campo público `byte retrigger` (default `0` nos
dois construtores — `0` preserva o comportamento original exatamente, sem
nenhuma mudança de resultado pra quem não usar o recurso). Nas 4 funções
que fazem a comparação `if (time_hit - time_end < maskTime) { return; }`
(`singlePiezoSensing()`, `dualPiezoSensing()`, `cymbal2zoneSensing()`,
`cymbal3zoneSensing()` — confirmado por grep que são os únicos 4 pontos
desse padrão no arquivo inteiro; `HHMUX()`/`HH2zoneMUX()` e variantes já
chamam essas mesmas 4 funções por dentro, então também são cobertas), o
`return` incondicional passou a ser condicional: quando `retrigger > 0`,
calcula um piso que decai com o tempo desde o pico anterior
(`piso = pico_anterior - tempo_decorrido*(retrigger+1)/16`, mesma fórmula
do microDRUM) e só corta se a pancada nova não superar esse piso. O código
original já tinha o comentário `//compare time to cancel retrigger`
exatamente nesse ponto — o autor original parece já ter tido esse conceito
em mente, só nunca chegou a implementar o decaimento.

Ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) (Fase P)
pro racional completo, incluindo por que `Gain` e `Xtalk` (implementados na
mesma fase) **não** precisaram de nenhuma mudança na lib.
