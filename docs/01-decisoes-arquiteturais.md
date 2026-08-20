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
