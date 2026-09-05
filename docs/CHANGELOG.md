# Changelog

Registro cronológico do que foi feito no projeto (mais recente no topo).

## 2026-09-06 — Aba de Firmware no app desktop + instalador do app

- **Objetivo**: montar/atualizar um DrumCore sem saber programar — hoje
  exigia PlatformIO CLI (firmware) e `npm run dev` (app desktop).
- **Nova aba "Firmware"** no app (`desktop-app/src/renderer/src/components/
  FirmwareManager.tsx`): busca a release de firmware mais recente no
  GitHub (tag `fw-v*`), baixa o binário e grava no ESP32-S3 via Web Serial
  + `esptool-js` (port oficial da Espressif do protocolo esptool, sem
  precisar de Python/esptool.py instalado). Cobre primeira gravação e
  atualização com o mesmo fluxo. Inclui a foto da placa com a porta
  USB-UART marcada (a que faz auto-reset pro bootloader, confirmada pelo
  Rodrigo) como guia visual.
- **Pipeline de release do firmware** (`.github/workflows/
  firmware-release.yml`, tag `fw-v*`): builda com PlatformIO, mescla
  bootloader+partition table+app num único `.bin` (offset `0x0`, via
  `esptool merge_bin` — offsets extraídos do log verboso do próprio build
  em vez de hardcoded, `.github/scripts/extract_flash_args.py`), publica
  junto com um `manifest.json`.
- **Versão do firmware**: era só o literal `"v0.1"` sem fonte única —
  agora `FW_VERSION` é injetado via `build_flags` a partir da tag git
  (`firmware/version_flag.py`), usado na tela BOOT e no campo
  `firmware_version` de `device_info` (permite o app comparar "versão
  conectada" vs "última release").
- **Instalador do próprio app desktop**: `electron-builder` (NSIS,
  Windows) + pipeline própria (`.github/workflows/app-release.yml`, tag
  `app-v*`) — sem isso, ter uma aba de firmware no app não ajudava quem
  não sabe rodar `npm run dev`. Sem assinatura de código por enquanto
  (SmartScreen vai avisar).
- Testado localmente nesta máquina: `npm run dist` gerou um instalador
  `.exe` funcional (~107MB) com o módulo nativo do `serialport`
  recompilado certo pro Electron. O fluxo de flash em si (esptool-js +
  Web Serial) só é validável com hardware real — ver
  `desktop-app/src/main/index.ts` (handler `select-serial-port`, escolhe a
  primeira porta da lista por simplicidade, revisar se aparecer mais de
  uma porta serial disponível na prática).

## 2026-09-06 — Jackboard: roteamento completo, silk final, logo e ajuste de placa

- **Roteamento completo** (via Konnect MCP): as 16 trilhas de canal (U1 →
  rede de proteção de cada canal) e o barramento de controle U2↔J9 (S0-S3,
  SIG, +3V3, GND) foram totalmente roteados. Conflitos de cruzamento
  resolvidos com detours e com divisão de camada (56 trilhas de junção
  série→paralelo→diodo movidas pra B.Cu). DRC limpo: 0 `shorting_items`,
  0 `unconnected_items` — só ficam os 112 avisos de courtyard/PTH aceitos
  por design (footprints de jack fisicamente próximos dos resistores/diodos
  do canal, sem risco elétrico real).
- **U1/U2 recentralizados**: os headers do HC4067 (U1, 16 pinos) e do
  header de controle (U2, 8 pinos) estavam deslocados ~8mm à direita do
  centro real da placa (resquício de uma placa mais larga de uma fase
  anterior). Corrigido com um shift uniforme de -8.32mm em X nos dois, com
  re-roteamento completo das 66 trilhas afetadas.
- **Silkscreen só com referência (sem valor)**: referências dos resistores/
  diodos (R.SilkS/F.SilkS) ajustadas à mão pelo Rodrigo no KiCad — texto de
  valor ocultado, referência rotacionada legível dentro do componente.
  Nenhuma ferramenta Konnect expõe edição de `fp_text`/rotação hoje (só
  gráficos de footprint, não texto) — ajuste feito direto na UI do KiCad.
- **Logo "DRUMCORE" na serigrafia** (F.SilkS, canto superior esquerdo):
  wordmark pixel-art 5x7 (134 quadrados), direção 1A do `design/LOGOS.md`.
  Construído pixel a pixel via `import_svg_logo` (a ferramenta só persiste
  a 1ª forma de um SVG multi-shape — workaround: 1 chamada por pixel, com
  um SVG reutilizável de 1 quadrado). Colocado por engano em B.SilkS
  (verso) na primeira tentativa; corrigido para F.SilkS (frente/topo).
- **Pad de teste +3V3 no estilo dos resistores**: o antigo via de acesso a
  +3V3 perto do J1 foi substituído por um footprint de pad único (círculo
  THT 1.6mm/furo 0.8mm, mesmas dimensões do pad dos resistores) — criado via
  `create_footprint` na biblioteca local do projeto
  (`drumcore_jackboard.pretty/TestPoint_3V3.kicad_mod`). O net do pad não
  pôde ser atribuído por nenhuma ferramenta Konnect (sem símbolo no
  esquemático, não há chamada de "atribuir net a um pad solto"); atribuído
  manualmente pelo Rodrigo no KiCad (Pad Properties → Net → `/+3V3`).
- **Ajuste de dimensão da placa**: altura reduzida em ~2.5mm (feito manualmente
  pelo Rodrigo no KiCad) pra deixar a rosca de um dos jacks pra fora da
  placa. A malha de GND (`GND_POUR_BOTTOM`, B.Cu) foi recriada com o novo
  contorno e recalculada (`refill_zones`).
- **Gerbers regenerados** (3x ao longo do dia, conforme cada ajuste acima) em
  `hardware/jackboard/fab/`, incluindo `drumcore_jackboard_gerbers.zip`.
- **Arquitetura esclarecida (confirmado por Rodrigo)**: o sistema final usa
  **2 jackboards idênticas** (16 canais cada) para completar os 32 canais
  já descritos em `docs/00-visao-geral.md`/`docs/02-hardware.md` (2x
  CD4067) — a jackboard atual não é uma redução de escopo, é a primeira das
  duas unidades. `README.md` atualizado pra refletir isso.

## 2026-09-06 — Pinout da tela ajustado pro conector + mainboard aposentada

- **Tela**: os 6 GPIOs (dentro do mesmo bloco contíguo da Fase Z) foram
  reordenados pra bater com a ordem física do conector dela (`GND VDD SCL
  SDA RES DC CS BLK`) — `SCL(7) → SDA(15) → RES(16) → DC(17) → CS(18) →
  BLK(8)`, a pedido do Rodrigo. Atualizados `firmware/src/main.cpp` (+
  `test_display.cpp`/`test_hall.cpp`, que tinham pinos antigos próprios),
  `docs/02-hardware.md` e o esquemático.
- **Validado em hardware real**: Rodrigo religou o encoder e a tela
  nesse pinout novo — os dois confirmados funcionando (navegação por
  encoder, imagem na tela). O MUX ainda não foi conectado nesse layout.
- **Mainboard aposentada**: com o pinout novo, a fiação ficou pouca o
  bastante pra conectar tudo direto nos headers da própria placa de dev
  do ESP32-S3, sem precisar de uma PCB dedicada — `hardware/mainboard/`
  (`.kicad_sch`/`.kicad_pcb`/`.kicad_pro`/`.kicad_prl`/`.png`) foi
  **apagado** do repositório. Isso resolve (por não ser mais relevante) o
  pendente da Fase Z sobre esse projeto ainda ter 2 encoders desenhados —
  não existe mais projeto pra corrigir. A jackboard continua normalmente.

## 2026-09-05 — Fase Z: pinout reorganizado por função (encoder+tela vs MUX)

- **Motivação**: a placa física ganhou pads de `3V3`/`GND` extras nos 2
  headers (modificação fora do dev board original) — isso removeu a
  restrição de alimentação que forçava o MUX e a tela a ficarem no mesmo
  header (Fase L). Pedido do Rodrigo: reorganizar por FUNÇÃO — encoder +
  tela de um lado, MUX (sensing) do outro, sempre mantendo blocos de
  pinos fisicamente contíguos.
- **Novo pinout**: header ESQUERDO = encoder (`GPIO4,5,6`) + tela
  (`GPIO7,15,16,17,18,8`), um bloco contíguo de 9 pinos. Header DIREITO =
  2x CD4067 (`GPIO42,41,40,39` pras linhas de seleção S0-S3, `GPIO1,2`
  pros 2 pinos SIG — os únicos 2 ADC desse bloco, agora ADC1 em vez de
  ADC2). Teste temporário do sensor hall (`TEST_DIRECT_HEAD_PIN`) migrado
  de GPIO17 (virou sinal permanente da tela) pra GPIO9 (livre).
- **Ajuste (2026-09-06)**: os 6 GPIOs da tela, dentro desse mesmo bloco,
  foram reordenados pra bater com a ordem física do conector dela (`GND
  VDD SCL SDA RES DC CS BLK`) — `SCL(7) → SDA(15) → RES(16) → DC(17) →
  CS(18) → BLK(8)`, a pedido do Rodrigo.
- De quebra, corrigida uma nota antiga: `GPIO43`/`GPIO44` nunca estiveram
  livres — são o UART físico usado pelo `Serial` (protocolo NDJSON), não
  "sem uso previsto" como o doc dizia.
- Atualizados `firmware/src/main.cpp`, `docs/02-hardware.md`,
  `docs/assets/esquematico-hellodrum.html` (e a cópia em `site/`). Ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) (Fase Z)
  pro racional completo.
- **Validado em hardware real (2026-09-06)**: Rodrigo religou o encoder e
  a tela nesse pinout novo — os dois confirmados funcionando (navegação e
  imagem na tela). O MUX ainda não foi conectado nesse layout.
- **Pendente** (resolvido no dia seguinte — ver entrada 2026-09-06 acima):
  `hardware/mainboard/*.kicad_sch`/`.kicad_pcb` ainda não tinham sido
  atualizados pra esse pinout novo nem pra 1 encoder só (Fase Y). A
  fiação do MUX também ainda precisa ser feita.

## 2026-09-04 — Fase Y: navegação reduzida de 2 encoders pra 1 (rotate/click/hold)

- **Motivação**: o ENC1 (página/pad em foco) tinha poucas responsabilidades
  na prática, enquanto o ENC2 concentrava quase toda a navegação. Decisão:
  1 encoder só, cobrindo tudo via hierarquia de profundidade — girar
  navega no nível atual, clicar desce um nível (ou confirma/dispara uma
  ação), segurar sempre volta um nível (em PADS/GLOBAL, volta direto pra
  LIVE).
- Item novo "SINAL" na lista de campos do PAD_EDIT — antes, alternar
  PAD_EDIT↔SIGNAL era o click do ENC1 (uma ação lateral que não cabia no
  modelo de profundidade linear); virou uma linha clicável, igual o
  CALIBRAR.
- Rodapés de instrução (ex: "ENC2 GIRA VALOR") removidos das telas
  PAD_EDIT/AUTOTUNE — interface considerada simples o bastante sem eles.
- **Simulador do LCD + encoders removido do app desktop**
  (`HardwareSimulator.tsx`, `EncoderRemote.tsx`,
  `docs/06-simulador-hardware.md`, ~400 linhas de CSS) — não fazia mais
  sentido simular 2 encoders físicos que deixaram de existir. A
  configuração de pads (`PadEditor.tsx`/`PadGrid.tsx`) e o modo demo
  (`mockDevice.ts`) continuam intactos.
- Protocolo `enc_input` continua aceitando `enc: 1` ou `2` (compatibilidade
  com o app existente) — os dois caem no mesmo handler físico agora. Ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) (Fase Y)
  pro mapeamento completo.

## 2026-09-04 — Jackboard: pinos T/R corrigidos + rede de proteção por canal

- Esquemático da jackboard (`hardware/jackboard/`): jacks usavam TN/RN
  (contato normal/switched) como sinal por engano — corrigido pra T/R de
  verdade (Tip = canal par, Ring = canal ímpar), com TN/RN/S/SN todos em
  GND.
- Rede de proteção por canal adicionada (16x): resistor série 100Ω +
  resistor paralelo 100kΩ + diodo BAT85, mesma topologia do esquema de
  referência da HelloDrum-arduino-Library pro MUX.
- PCB: os 8 jacks recriados com a netlist corrigida e realinhados no
  passo físico de 22.5mm; os 48 componentes de proteção posicionados no
  espaço livre entre as duas colunas de pads de cada jack; cluster do MUX
  recentralizado sobre a fileira de jacks. Roteamento das trilhas fica
  pra uma próxima etapa — placa ainda não fabricada nem testada.
- Firmware: novo ambiente de teste isolado `test_hall`
  (`firmware/src/test_hall.cpp`) — mostra a leitura bruta do sensor hall
  (SS49E) na tela + Serial, sem MUX/encoders/USB-MIDI/BLE/EEPROM.

## 2026-09-02 — Fase X: calibração do controlador de pedal (HHC) — range + inversão

- **Novo assistente de captura de range** (`PAD_HIHAT_PEDAL`/
  `PAD_HIHAT_OPTICAL`, pad_type 6/7): diferente do resto (sensor de
  posição contínua, não de impacto) — pede pra segurar o pedal solto e
  depois pressionado até o fim, 3s cada, e calcula `threshold`/
  `sensitivity` (min/max) sozinho. Esses 2 campos já eram usados pela lib
  como os pontos de calibração do range (`curve()`/`map()` em
  `FSRSensing()`/`TCRT5000Sensing()`) — só nunca tinham um jeito
  automático de descobrir os valores certos.
- **Novo campo `hihat_invert`** (Sim/Não): alguns sensores mandam a
  posição invertida — liga isso pra corrigir. Aplicado no CC final
  (`127 - CC`), não no range calibrado — efeito imediato, sem precisar
  recalibrar. Novo array `padHihatInvert[]` + persistência EEPROM (mesmo
  padrão do `gain`, Fase P).
- Protocolo (`autotune_status` ganha `phase`/`hold_elapsed_ms`/
  `hold_target_ms`/`mode`, `set_pad` ganha `hihat_invert` — ver
  [04-protocolo-serial.md](04-protocolo-serial.md)), tela física e app
  desktop (checkbox dedicado "Inverter", mockups de LCD e modo demo)
  atualizados em conjunto. Ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) (Fase X)
  pro relato completo.
- **Nunca testado com hardware real** (nem o sensor físico, nem o
  assistente) — ver [05-tipos-de-sensor.md](05-tipos-de-sensor.md).

## 2026-09-02 — Fase W: auto-tune agora ignora o gain antigo do pad (calibra sempre "do zero")

- **Bug relatado**: em alguns pads, o nível FRACO da calibração não
  detectava as batidas. Causa: `rawValue[]` é um array global
  compartilhado entre `main.cpp` e a lib (`int rawValue[]` em
  `hellodrum.cpp`) — `applyPadGain()` (Fase P) escala ele usando o
  `gain` que o pad já tinha ANTES de `autoTuneTick()` ler o mesmo
  array. Se esse gain não estava neutro (100, ex: de uma calibração/
  ajuste manual anterior), a margem de segurança do piso de ruído
  (`atNoiseFloor*1.3 + 5`) tem um "+5" fixo que não escala junto — com
  gain baixo, uma batida fraca de verdade podia não superar esse piso.
- **Correção**: `startAutoTune()` agora salva o gain atual do pad
  (`atSavedGain`) e força `padGain[pad] = 100` (neutro) assim que a
  calibração começa — o assistente sempre parte "do zero", como pedido.
  Como `rawValue[]` é compartilhado, isso também neutraliza a sensing de
  verdade enquanto a calibração está rodando (consistente — os
  resultados calculados assumem gain neutro). Restaurado em
  `cancelAutoTune()`/`goToLive()` (ambos os únicos caminhos de saída sem
  aplicar, incluindo o "pânico" ENC1 hold → LIVE) se o usuário não
  aplicar; fica em 100 de propósito se aplicar
  (`applyAutoTuneResult()`), já que o resultado calculado só faz sentido
  combinado com gain neutro.
- Ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)
  (Fase W) pro relato completo.

## 2026-09-02 — Fase V: auto-tune estendido pra prato/caixa 3 zonas (edge + cup/aro)

- **Generalização da Fase U**: o assistente de auto-calibração agora
  também cobre `PAD_CYMBAL_3ZONE` (prato) e `PAD_SNARE_3ZONE` (caixa),
  não só `PAD_DUAL`. `cymbal3zoneSensing()` (`hellodrum.cpp`) discrimina
  zona por 2 FAIXAS de threshold no MESMO canal secundário (`edgeThreshold`/
  `cupThreshold`), diferente do `PAD_DUAL` (diferença entre 2 canais) —
  então esses pads fazem 2 rodadas extras (edge, depois cup/aro) em vez
  de 1, cada uma com os mesmos 3 níveis × 8 golpes.
- `bool atCalibrateSecondZone` virou `enum AutoTuneShape`
  (single/dual/tri), decidido por `pad_type` em `startAutoTune()`. Novo
  `atSumCupByTier[3]` acumula a rodada extra do cup/aro-forte.
  `edgeThreshold` sai da mesma margem de 30% usada em todo o assistente;
  `cupThreshold` sai de 30% do caminho entre o edge mais forte e o cup
  mais fraco observados, com salvaguarda contra faixas sobrepostas.
- **Nomenclatura de zona alinhada ao protocolo**: `autotune_status.zone`
  passou de nomes genéricos (`"primary"`/`"rim"`) pro MESMO vocabulário
  já usado no evento `hit`: `"head"`/`"rim"` (`PAD_DUAL`), `"bow"`/
  `"edge"`/`"cup"` (prato), `"head"`/`"edge"`/`"rim"` (caixa) — ver
  [04-protocolo-serial.md](04-protocolo-serial.md).
- App desktop: `protocol.ts` ganhou `autoTuneShapeFor()`/
  `autoTuneZonesFor()` como fonte única do mapeamento `pad_type` →
  sequência de zonas (evita reimplementar isso em 3 arquivos
  diferentes); rótulos de `rim_sensitivity`/`rim_threshold` no resultado
  agora vêm do mesmo lugar que os sliders (`PAD_TYPE_META`), não mais um
  texto fixo "aro". Ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)
  (Fase V) pro relato completo, incluindo a lógica de
  `cymbal3zoneSensing()` investigada antes de implementar.
- **Tradeoff aceito de antemão**: prato/caixa 3 zonas agora levam 72
  golpes pra calibrar (24 por zona × 3 zonas) em vez de 24.

## 2026-09-02 — Fase U: auto-tune passa a calibrar também o aro em pads de 2 zonas

- **Ideia do Rodrigo**: em pads `PAD_DUAL` (pele+aro), os 2 piezos sempre
  disparam juntos (bater na pele "vaza" pro aro e vice-versa), e a
  classificação de zona (`dualPiezoSensing()` em `hellodrum.cpp`) decide
  isso comparando os 2 picos do mesmo golpe — não olhando cada piezo
  isolado. O auto-tune (Fase O/T) nunca calibrava `rim_sensitivity`/
  `rim_threshold` (sempre manual), então essa comparação nunca tinha dado
  real por trás.
- **Nova 2ª passada**: pads `PAD_DUAL` agora repetem os 3 níveis inteiros
  (mais 24 golpes) batendo no ARO, depois da passada normal na pele —
  capturando os dois canais em paralelo nas duas rodadas (o que importa é
  a diferença entre eles, não cada um isolado). `rimThreshold` sai do
  pior vazamento visto no aro durante os golpes de pele; `rimSensitivity`
  sai do pior caso (maior diferença pele-aro) visto nos golpes reais de
  aro, com folga.
- **Fora de escopo por ora**: prato 2/3 zonas (mesmo tendo 2 canais
  físicos) usa uma lógica de discriminação diferente (faixa de threshold
  no mesmo canal, não diferença entre 2 canais) — não mexido.
- Protocolo (`autotune_status` ganha `zone`/`rim_sensitivity`/
  `rim_threshold` — ver [04-protocolo-serial.md](04-protocolo-serial.md)),
  tela física e app desktop (`PadEditor.tsx`, `mockDevice.ts`,
  `HardwareSimulator.tsx`) atualizados em conjunto. Ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) (Fase U)
  pro relato completo, incluindo a fórmula do resultado do aro.
- **Tradeoff aceito de antemão**: pads de aro agora levam 48 golpes pra
  calibrar (24 pele + 24 aro) em vez de 24.

## 2026-09-02 — Fase T: auto-tune corrigido (mesma inversão do ESP32 da Fase S) e evoluído pra 3 níveis de força

- **Bug encontrado**: `autoTuneTick()` (`firmware/src/main.cpp`) tinha
  sua própria cópia da fórmula de normalização do ESP32 que fora
  corrigida em `hellodrum.cpp` na Fase S — ainda invertida
  (`1023 - rawValue[atPad] / 4`). Era a causa do "auto-calibrar não
  funciona": o piso de ruído calculado ficava mais alto que qualquer
  pancada real, e o assistente sempre estourava o timeout de 15s.
  Corrigido pra `rawValue[atPad] / 4` (sem inversão).
- **Achado à parte**: pad 0 estava com `sensitivity`/`threshold`/
  `mask_time` zerados (resíduo de experimentação anterior), causando
  disparo constante e erros `map(): min == max`. Corrigido ao vivo via
  `set_pad` (sem reflash); adicionada uma salvaguarda em
  `HelloDrum::curve()` pra essa classe de config nunca mais travar/
  disparar sem parar.
- **Calibração em 3 níveis** (fraco/médio/forte, 8 golpes cada — 24 no
  total, antes eram 8 de intensidade livre): nível fraco calibra o
  `threshold`, nível forte calibra a `sensitivity`, nível médio serve só
  de checagem de consistência. Novo `atSumPeakByTier[3]` no lugar de um
  único acumulador. Atualizado em conjunto: tela física
  (`renderAutoTune()`), protocolo serial (`autotune_status` ganha
  `tier`/`tier_index`/`tier_count` — ver
  [04-protocolo-serial.md](04-protocolo-serial.md)), e o app desktop
  (`PadEditor.tsx`, `mockDevice.ts`, mockup de LCD em
  `HardwareSimulator.tsx`). Ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) (Fase T)
  pro relato completo, incluindo a fórmula do resultado.

## 2026-09-01 — Fase S (continuação): primeiro sensing real validado — fórmula do ESP32 estava invertida

- **Marco**: primeira leitura de piezo real, velocity-sensitive,
  confirmada de ponta a ponta neste projeto — testado com 2 piezos
  ligados direto em `GPIO17`/`GPIO18` (sem o MUX, que ainda não chegou),
  configurados como um pad dual-zone de teste (ver `TEST_DIRECT_HEAD_PIN`/
  `TEST_DIRECT_RIM_PIN` em `firmware/src/main.cpp`).
- **Bug encontrado**: `hellodrum.cpp` tinha, em 4 funções de sensing
  baseadas em piezo (`singlePiezoSensing`, `dualPiezoSensing`,
  `cymbal2zoneSensing`, `cymbal3zoneSensing`), uma fórmula só pra ESP32
  (`piezoValue = 1023 - piezoValue / 4`) que **invertia** a leitura —
  repouso virava "batida forte" e vice-versa. Confirmado contra os
  circuitos de referência oficiais da lib (piezo + resistor de 100 kΩ em
  paralelo, sem inversão nenhuma). Corrigido pra só normalizar 12→10 bits,
  sem inverter (`piezoValue = piezoValue / 4`). `TCRT5000Sensing`/
  `FSRSensing` (sensores ópticos/resistivos, tecnologia diferente) não
  foram mexidos - ficam pendentes de investigação própria.
- Depois da correção: cada batida gera um hit, zona certa ("head" em vez
  de sempre "rim"), velocidade variando de forma plausível com a força da
  batida. Ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)
  (Fase S) pro relato completo, incluindo os diagramas de referência
  consultados.
- Removido o `pinMode(..., INPUT_PULLUP)` usado no teste anterior (fio
  solto, sem resistor) — com o resistor de 100 kΩ de verdade instalado,
  pull-up interno não é necessário.

## 2026-09-01 — Fase S: causa raiz do bug do array `pads[]` (Fase Q) encontrada e corrigida

- **Marco**: leitura real por pad restaurada (`pads[i].begin(i, i+1)`,
  cada pad no seu próprio canal do MUX) — desde a Fase Q, todos os 32
  pads liam o mesmo canal (`begin(0,1)` constante) como contorno de um
  bug não identificado.
- **Causa raiz**: `hellodrum.cpp` (lib vendorizada) usa `#ifdef PULLUP`
  pra decidir se chama `pinMode(pin, INPUT_PULLUP)` dentro de `begin()` —
  uma flag que o autor original comentou por padrão
  (`//#define PULLUP`). O core arduino-esp32 já define seu próprio
  `PULLUP` (`0x04`, flag de modo do `pinMode()`) — `#ifdef` só olha se o
  nome existe, não quem definiu, então essa flag ficava **sempre ativa**
  no ESP32. `begin()` chamava `pinMode()` usando `pin1`/`pin2` como se
  fossem GPIOs reais, mas nesse projeto (MUX 2x CD4067) esses valores são
  índices de canal (0-31) — ao coincidir com um GPIO reservado
  internamente (flash/PSRAM), corrompia o sistema. Explica o padrão "ok
  até uns 26, quebra a partir de 27+" da Fase Q. Bug secundário
  encontrado no mesmo lugar: as funções de sensing também tinham
  `#ifdef PULLUP` invertendo a leitura do sensor — teria deixado a
  detecção de toque errada com sensores reais conectados. Ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) (Fase S)
  pro relato completo.
- Corrigido em `firmware/lib/HelloDrum-arduino-Library/src/hellodrum.cpp`
  — removidos os `pinMode()` de dentro de `begin()`, `#undef PULLUP`
  logo no topo do arquivo neutraliza o resto.
- `padEnabled[i] = false` continua forçado em todos os canais (não é
  mais sobre esse bug — é só porque os pads físicos ainda não estão
  conectados, e os canais ADC flutuando captariam ruído).
- BLE-MIDI confirmado anunciando certinho (visível num scanner BLE
  genérico) — o Windows MIDI Services ainda não tem transporte BLE-MIDI
  nativo; precisa de um app-ponte (ex. "BLE-MIDI Connect" na Microsoft
  Store). Não é um bug do firmware.

## 2026-09-01 — Fase R: USB-MIDI funcionando de verdade + tela em paisagem

- **Marco**: USB-MIDI reconhecido de verdade por uma DAW ("DRUMCORE"
  aparece em Active MIDI Inputs) — até então a porta nativa só enumerava
  como uma serial genérica, mesmo com o firmware "correto" segundo a API
  da Adafruit TinyUSB. Causa raiz: no ESP32,
  `Adafruit_USBD_Device::begin()` não religa o periférico USB de verdade
  (isso fica a cargo do core arduino-esp32, mas só acontece automaticamente
  se `CDC_ON_BOOT`/`MSC_ON_BOOT`/`DFU_ON_BOOT` estiverem ligados — nenhum
  estava). Corrigido religando o hardware manualmente em
  `bringUpNativeUsbHardware()` (`firmware/src/main.cpp`), replicando a
  sequência de baixo nível que a própria lib Adafruit deixa desligada de
  propósito nesse chip. Ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) (Fase R)
  pro histórico completo da investigação (incluindo uma primeira tentativa
  que travava o boot).
- Nomes USB/BLE unificados como "DRUMCORE" (fabricante, produto, porta
  MIDI, nome do dispositivo Bluetooth) + número de série USB fixo
  (`setSerialDescriptor`), antes nunca definido.
- BLE-MIDI ainda não confirmado funcionando do lado do host (não
  encontrado num scanner BLE) — investigação pausada pra focar no
  USB-MIDI primeiro.
- **Tela girada pra paisagem** (era retrato desde a Fase J, mas o painel
  físico real é 128x160, não 128x128 como a doc antiga assumia — sticker
  confirma "1.8' 128x160 RGB_TFT"). `tft.setRotation(1)`; barras de
  título/rodapé e a grade da tela LIVE redesenhadas pra usar a largura
  cheia da tela; lista de PADS também alargada.
- Removido o controle de brilho da tela (PWM no backlight não tinha
  efeito visível na faixa útil dessa placa clone — não valia a pena
  investigar mais fundo agora): backlight fica sempre ligado no máximo,
  sem dimming. Removido de `main.cpp`, do protocolo serial
  (`set_global`/`device_info`) e do app desktop.
- Coluna de tipo na lista de PADS trocada pra mostrar o nome configurado
  pelo pad (`label`), com `--` se vazio, em vez do tipo de sensor.
- Campo "ATIVO" na tela PAD_EDIT mostra "SIM"/"NAO" em vez de `1`/`0`.
- Novo comando de protocolo `enc_input` (`firmware/src/main.cpp` +
  `docs/04-protocolo-serial.md`) — encoder virtual via serial, chama os
  mesmos handlers dos encoders físicos. Novo componente
  `EncoderRemote.tsx` no app desktop, visível quando conectado ao
  hardware real — permite navegar a tela do módulo pelo app antes dos
  encoders físicos estarem conectados.

## 2026-08-31 — Fase Q: primeiro boot completo em hardware real (com contorno pendente)

- **Marco**: primeiro boot completo do firmware principal até `goToLive()`
  — tela renderizando, USB-MIDI e BLE-MIDI ativos, EEPROM funcionando,
  protocolo NDJSON emitindo eventos. Ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) (Fase Q)
  pro histórico completo da investigação.
- **Bug não resolvido**: o array `HelloDrum pads[32]` (inicializado com
  pinos sequenciais `0,1,2,...,31`, a forma original desde a Fase A)
  trava o boot com watchdog reset, sem causa raiz identificada apesar de
  investigação extensiva (isolamento por tamanho de array, por valor
  individual, por tempo, com/sem BLE — nada explicou o padrão observado).
  **Contorno em produção**: todos os 32 pads chamam `begin(0, 1)`
  (valores constantes) — desbloqueia o boot, mas todos os pads leem o
  mesmo canal do MUX (sem leitura real de sensor por pad ainda).
  **Pendente**: investigar a causa raiz e restaurar a leitura real
  (`begin(i, i+1)`) antes de conectar os pads/MUX físicos de verdade.
- Refatorado `HelloDrum` (biblioteca vendorizada) pra ter um construtor
  padrão trivial + método `begin(pin1[, pin2])` explícito, permitindo um
  array `pads[]` default (sem lista de inicializadores) inicializado
  dentro do `setup()` em vez de como array global — corrige um problema
  real e distinto (estouro de pilha da tarefa principal com arrays
  agregados de 27+ elementos não-triviais), mesmo esse não sendo a causa
  completa do bug acima.
- Novo ambiente de teste/regressão `test_pads` no `platformio.ini`
  (`firmware/src/test_pads.cpp`) — isola o array `pads[]` sem
  MUX/TFT/USB-MIDI/BLE/EEPROM, útil pra retomar a investigação depois.
- **Correção de um erro deste assistente**: `ARDUINO_USB_CDC_ON_BOOT=1`
  fazia o `app_main()` do core chamar `Serial.begin()` (USBCDC) antes do
  `setup()` do sketch, antes do `TinyUSBDevice.begin()` — travava
  esperando uma pilha TinyUSB que ainda não existia. Corrigido pra `0`.

## 2026-08-22 — Fase P: `Retrigger`, `Gain` e `Xtalk` (parâmetros do microDRUM)

- **`Retrigger`** (0-100, `0` = desligado): dentro do `mask_time`, uma
  pancada bem mais forte que a anterior pode "furar" o corte e disparar de
  novo — limiar decrescente com o tempo, evita perder golpes em rufos/
  rolls rápidos. **Única mudança de lógica de sensing já feita na lib
  vendorizada** — modificadas as 4 funções que fazem detecção de hit
  (`singlePiezoSensing`, `dualPiezoSensing`, `cymbal2zoneSensing`,
  `cymbal3zoneSensing`; HH/HH2zone já chamam essas mesmas 4 por dentro),
  porque a lógica de `mask_time` mora em variáveis privadas da lib.
  Comportamento original preservado exatamente quando `retrigger == 0`
  (default).
- **`Gain`** (10-200 = 0.10x-2.00x, 100 = neutro): recalibra a amplitude
  lida do sensor antes do threshold — sem tocar na lib, aplicado direto no
  `rawValue[]` em `main.cpp` com uma fórmula que preserva o "repouso" do
  sensor independente do multiplicador (`raw' = 4095 - gain*(4095-raw)`).
- **`Xtalk`/`Xtalk_group`** (0-100 / 0-4, `0` = desligado/sem grupo):
  suprime um hit se outro pad do mesmo grupo bateu bem mais forte no mesmo
  instante — cobre tanto vibração mecânica entre pads montados juntos
  quanto crosstalk elétrico entre canais (inclusive os 2 CD4067 que
  compartilham o barramento S0-S3). Também resolvido sem tocar na lib,
  rodando entre o `dispatchSensing()` e o `handlePadResult()`.
- Universais pros 9 tipos de pad — `MAX_FIELDS_PER_PAD` subiu de 13 pra 17.
  Persistem em EEPROM em blocos próprios (mesmo padrão do `enabled`, Fase
  N) — `retrigger` fica dentro do objeto `HelloDrum`, mas não é persistido
  pelo mecanismo próprio da lib.
- Validado: `pio run` compila e linka com sucesso (lib vendorizada
  modificada incluída); `npm run typecheck`/`npm run build` no app
  desktop, ambos limpos. **Nada testado em hardware real.**

## 2026-08-22 — Pesquisa: microDRUM/nanoDRUM (massimobernava/md-firmware)

- Explorado o código-fonte do firmware do microDRUM/nanoDRUM em busca de
  parâmetros de sensing que a nossa lib base (HelloDrum) não tem. Achados
  de maior valor: assistente de auto-calibração ("Auto Tune"), `Retrigger`
  (threshold decrescente durante o mask_time, evita perder golpes em
  rolls), `Gain` (multiplicador de calibração por canal), supressão de
  crosstalk entre multiplexadores/grupos de pads, choke de prato, e
  detecção de "foot splash"/"foot close" no pedal de chimbal por
  velocidade de fechamento. Implementado nessa mesma sessão: auto-tune
  (Fase O, ver abaixo). Os demais ficam como candidatos pra fases futuras.

## 2026-08-22 — Fase O: assistente de auto-calibração ("auto-tune")

- **Novo recurso**: bate no pad 8x e o firmware calcula sensibilidade,
  threshold, scan time e mask time sozinho — inspirado no "Auto Tune" do
  microDRUM/nanoDRUM, com um algoritmo próprio mais simples (1 fase de
  ruído de 2s + 8 golpes, em vez de ~50 golpes em 2 fases).
- **Firmware**: nova tela `PAGE_AUTOTUNE` (acessada pelo item `CALIBRAR`,
  sempre o último campo de qualquer pad em `PAD_EDIT`); só calibra o
  sensor principal do pad (pin_1) — pads de 2 canais continuam com ajuste
  manual pro 2º sensor. `MAX_FIELDS_PER_PAD` subiu de 12 pra 13.
- **Protocolo serial**: `start_autotune`/`cancel_autotune`/`apply_autotune`
  + evento `autotune_status` (progresso em tempo real, não só resposta a
  comando) — dá pra disparar/acompanhar tanto pela tela física quanto pelo
  app desktop.
- **App desktop**: painel de calibração no `PadEditor` (botão, progresso,
  aplicar/descartar); `mockDevice.ts` simula a sequência inteira com
  temporizadores; `HardwareSimulator.tsx` replica a mesma tela/fluxo.
- Validado: `pio run` compila e linka com sucesso; `npm run typecheck` e
  `npm run build` no app desktop, ambos limpos. **Nada testado em
  hardware real** — os fatores de margem usados no cálculo (+15%/+20%/
  +30%) são estimativas, não calibrados contra um piezo real.

## 2026-08-22 — Fase N: canal habilitado/desabilitado por pad (ruído em slot vazio)

- **Novo campo `enabled` por pad** (protocolo + `padEnabled[]` no
  firmware, persistido em EEPROM): canal desligado é completamente
  ignorado (`dispatchSensing()`/`handlePadResult()` nunca rodam pra ele) —
  resolve slots sem sensor físico conectado captando ruído/interferência e
  gerando `hit`/nota MIDI fantasma. Não resolve ruído em canal que
  **tem** sensor conectado (isso é hardware — resistor de sangramento).
- **Tela/encoders**: novo campo `ATIVO` (universal, 2º campo de todo tipo
  de pad em `PAD_EDIT`). Canal desligado aparece apagado na tela LIVE
  (grid) e como "OFF" na tela PADS — visível, não escondido.
- **App desktop**: checkbox "Canal ativo" no `PadEditor`, lista de pads
  (`PadGrid`) mostra linha esmaecida com "desligado"; `HardwareSimulator`
  replica a mesma UX (item ATIVO, grid e lista com o mesmo tratamento).
- Documentação: `docs/04-protocolo-serial.md` (campo `enabled`),
  `docs/01-decisoes-arquiteturais.md` (Fase N completa, incluindo o
  esclarecimento de que isso não substitui resistor de sangramento em
  sensores conectados).
- Validado: `pio run` compila e linka com sucesso; `npm run typecheck` e
  `npm run build` no app desktop, ambos limpos. **Nada testado em
  hardware real.**

## 2026-08-22 — Fase M: tipo de sensor "Caixa 3 zonas" + bugfix crítico do `PAD_DUAL`

- **Novo tipo de sensor `PAD_SNARE_3ZONE` (8)**: caixa com 3 sons (centro
  da pele, borda da pele, aro/rimshot) — reusa a mesma sensing do prato 3
  zonas (`cymbal3zoneMUX()`), sem mudanças na lib vendorizada, só com
  zonas renomeadas (`head`/`edge`/`rim`). Cabeamento idêntico ao tipo 1
  (Aro/Dual): pele + aro, 2 piezos.
- **Bug corrigido (crítico)**: `handlePadResult()` nunca teve um `case
  PAD_DUAL:` desde a Fase G — qualquer pad configurado como tipo 1
  (Aro/Dual, o tipo mais comum pra caixa) **nunca enviava nota MIDI
  nenhuma** ao ser atingido, apesar da detecção de hit funcionar
  normalmente. Corrigido usando as zonas `head`/`rim` já documentadas em
  [04-protocolo-serial.md](04-protocolo-serial.md) e simuladas em
  `mockDevice.ts`.
- App desktop: `protocol.ts` (`PAD_TYPE_META[8]`), modo demo
  (`mockDevice.ts`) e simulador de hardware (`HardwareSimulator.tsx`,
  pad "Caixa" de exemplo agora usa o tipo 8) atualizados.
- Documentação: `docs/05-tipos-de-sensor.md` (novo tipo 8 detalhado, nota
  sobre o bugfix), `docs/04-protocolo-serial.md` (`pad_type` 0-7→0-8),
  `docs/01-decisoes-arquiteturais.md` (Fase M completa).
- Validado: `pio run` compila e linka com sucesso; `npm run typecheck` e
  `npm run build` no app desktop, ambos limpos. **Nada testado em
  hardware real** — threshold de borda/aro do tipo 8 nunca foi calibrado
  numa caixa física.

## 2026-08-21 — Fase L (refinamento): pinos fisicamente contíguos, não só "mesmo header"

- **Firmware** (`firmware/src/main.cpp`): MUX (S0-S3, SIG0/SIG1) passa a
  usar GPIO4,5,6,7,15,16 — a única sequência de 6 pinos fisicamente
  contígua no header esquerdo (antes: SIG0/SIG1 em GPIO8/9, no mesmo
  header mas distantes de S0-S3 na ordem física real da placa). TFT passa
  a usar GPIO17,18,8,9,10,11 (continuação imediata da sequência do MUX).
  Encoders sem mudança (já eram contíguos).
- **Trade-off aceito**: GPIO15/16 (SIG0/SIG1) são ADC2, não ADC1 — a
  restrição "só ADC1" das fases anteriores existia por precaução com o
  conflito clássico ADC2×Wi-Fi, que não se aplica aqui porque o projeto
  nunca inicializa Wi-Fi (só BLE-MIDI). Ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) (adendo na
  entrada da Fase L).
- Documentação (`docs/02-hardware.md`) e esquemático visual
  (`docs/assets/esquematico-hellodrum.html`) atualizados com os novos
  números de GPIO.
- Validado: `pio run` compila e linka com sucesso. **Nada testado em
  hardware real.**

## 2026-08-21 — Fase L: pinout reorganizado por ergonomia de montagem

- **Hardware**: pinout reatribuído a partir de uma foto real da placa
  comprada (dev board ESP32-S3, headers de 22 pinos de cada lado) — cada
  subsistema (2x CD4067, tela TFT, cada encoder) agora sai inteiro de um
  único header físico, sem fios cruzando a placa. Header esquerdo (único
  lado com `3V3`): MUX + tela. Header direito (só `GND`, suficiente pros
  encoders que usam pull-up interno): os 2 encoders.
- **Firmware** (`firmware/src/main.cpp`): `MUX0_Z`/`MUX1_Z` GPIO1/2→8/9;
  `TFT_DC` GPIO9→10; `TFT_CS` GPIO10→16; `ENC1_A/B/SW` GPIO15/16/17→
  42/41/40; `ENC2_A/B/SW` GPIO18/21/38→37/36/35.
- **Achado incidental**: GPIO38 (usado até então pro SW do encoder 2)
  aciona um LED embutido dessa placa específica — evitado. (Correção
  2026-08-31: o rótulo real, conferido na serigrafia, é `BUILTIN LED`, não
  `RGB_LED` — o LED RGB endereçável fica no GPIO48, já excluído por outro
  motivo. Ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).)

## 2026-08-31 — Ajuste de contiguidade física dos encoders

- **Firmware** (`firmware/src/main.cpp`): `ENC1_A/B/SW` GPIO42/41/40→
  **1/2/42**; `ENC2_A/B/SW` GPIO37/36/35→**41/40/39**. Corrige um vão de 2
  pinos (`GPIO39`, `GPIO38`) que sobrava entre os dois encoders na
  atribuição da Fase L — agora os 6 sinais saem contíguos na ordem física
  real do header direito (`GPIO1,2,42,41,40,39`), sem pular nenhum outro
  pino. Como efeito colateral, deixa de usar GPIO35-37 (risco de PSRAM
  octal) e não toca em GPIO43/44 (UART/USB-serial de debug). Ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).
- **Módulo confirmado como ESP32-S3-N16R8** (16MB flash + 8MB PSRAM octal,
  lido na serigrafia por Rodrigo) — corrige uma afirmação anterior errada
  deste assistente (que tinha confundido o perfil genérico de build com
  detecção de hardware real). `firmware/platformio.ini` ajustado pra
  refletir o módulo: `board_build.arduino.memory_type = qio_opi`,
  `board_build.partitions = default_16MB.csv`, `board_upload.flash_size =
  16MB`, `build_flags += -D BOARD_HAS_PSRAM`. `pio run` confirma
  `[SUCCESS]` com `16MB Flash`.
- **Tela TFT remapeada pra espelhar o próprio conector** (`GND VCC SCL
  SDA RES DC CS BLK`): passa da sequência logo após o MUX
  (`GPIO17,18,8,9,10,11`) para os 6 pinos da base do header esquerdo,
  logo acima do `GND` (`GPIO9,10,11,12,13,14`) — `TFT_SCLK` GPIO9→**14**,
  `TFT_MOSI` GPIO8→**13**, `TFT_RST` GPIO11→**12**, `TFT_DC` GPIO17→**11**,
  `TFT_CS` GPIO18→**10**, `TFT_BLK` GPIO10→**9**. Como o `GND` do header
  esquerdo fica na base (e o `3V3` no topo), subir a partir do `GND` casa
  cada sinal com a ordem física do conector da tela, sem cruzar fios — só
  o `VCC` precisa de um fio isolado até o `3V3` no topo. Deixa de formar
  um feixe único com o MUX (sobram GPIO17/18/8 livres) — trade-off aceito
  de propósito. Ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).
- **Risco anotado, não confirmado**: GPIO35-37 (usados pelos encoders)
  são internos em módulos ESP32-S3 com PSRAM octal — a placa expõe eles
  como header normal, sugerindo que não é essa variante, mas vale
  confirmar contra o código impresso no módulo antes de soldar. Ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) (Fase L).
- Documentação (`docs/02-hardware.md`, `01-decisoes-arquiteturais.md`) e
  esquemático visual (`docs/assets/esquematico-hellodrum.html`)
  atualizados pra mostrar de qual header cada fio sai.
- Validado: `pio run` compila e linka com sucesso. **Nada testado em
  hardware real.**

## 2026-08-31 — Primeiro teste em hardware real: tela funcionando

- **Marco**: primeira gravação e teste do firmware num ESP32-S3 físico
  (porta `COM5`/CH343, ver notas de porta USB/UART em
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)).
- Tela ficou em branco na primeira gravação (backlight ok, sem conteúdo).
  Investigado com um ambiente de teste isolado
  (`[env:display_test]`/`firmware/src/test_display.cpp`, novo, permanente
  no repo) que descartou variante de driver errada e interferência do
  resto do firmware como causas. **Causa raiz**: curto físico na solda de
  um dos pinos da tela — corrigido por Rodrigo. Depois da correção, a
  tela mostrou as cores do teste corretamente, e o firmware principal
  (`tft.initR(INITR_144GREENTAB)`) foi regravado com sucesso. Ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) pro
  diagnóstico completo passo a passo.

## 2026-08-21 — Fase K: multiplexação trocada pra 2x CD4067 (HW-178)

- **Hardware**: substituídas as 4x CD4051 (8 canais cada) por 2x módulos
  breakout HW-178 (chip CD4067, 16 canais cada) — mesmas 32 entradas, menos
  placas pra montar. O usuário já comprou as 2 unidades.
- **Firmware** (`firmware/src/main.cpp`): troca de `HelloDrumMUX_4051` por
  `HelloDrumMUX_4067` (2 instâncias em vez de 4). Adicionado `MUX_S3`
  (GPIO7, reaproveitando o antigo pino Z do 3º CD4051); os pinos `SIG` dos 2
  MUX continuam nos GPIOs 1 e 2. Nenhuma mudança em `pads[]`, EEPROM,
  protocolo serial ou telas — a indexação de pad (0-31) sempre foi
  independente de quantos chips físicos formam o espaço de canais.
- **Documentação**: `docs/02-hardware.md` (pinout/componentes),
  `docs/03-biblioteca-hellodrum.md` (fórmula de índice do MUX),
  `docs/01-decisoes-arquiteturais.md` (nova entrada "Fase K" com o racional
  completo, incluindo a fiação do pino EN do HW-178) e o esquemático visual
  (`docs/assets/esquematico-hellodrum.html`) atualizados.
- Validado: `pio run` compila e linka com sucesso. **Nada testado em
  hardware real.**

## 2026-08-21 — Fase J: rebranding + redesenho da UI do firmware

- **Renomeação do projeto**: "HelloDrum" → "DrumCore" (nome de exibição
  "DRUMCORE" em telas/branding, "DrumCore" em prosa). A biblioteca de
  terceiros vendorizada (`firmware/lib/HelloDrum-arduino-Library`, de Ryo
  Kosaka) mantém seu nome original — não faz parte do rebranding.
- **Redesenho completo da tela/navegação do firmware**
  (`firmware/src/main.cpp`), seguindo uma especificação de UI produzida com
  Claude Design (`design/SPEC.md`). Substitui o sistema de botões/tela das
  Fases C/I por 6 telas: BOOT, LIVE (grade 8x4 dos 32 pads, com flash ao
  bater), PADS (lista rolável dos 32 pads), PAD_EDIT (edição dos parâmetros
  do pad em foco, lista de campos dinâmica por tipo de sensor), SIGNAL
  (osciloscópio simplificado do envelope do sensor) e GLOBAL (canal MIDI,
  saída MIDI, brilho da tela via PWM, e ações SALVAR/RESTAURAR com toast —
  sem "KIT", ver abaixo).
- **Dois encoders com semântica nova**: ENC1 navega entre páginas/pad em
  foco (clique alterna PAD_EDIT↔SIGNAL, hold de 600ms volta pra LIVE); ENC2
  navega a lista/edita o valor em foco (clique confirma, hold de 600ms volta
  um nível). Ambos com aceleração de valor (>8 giros/s pula de passo 1 pra
  5).
- **Mudança de modelo de persistência**: editar um pad pelos
  encoders/tela agora só altera um buffer em RAM — só grava na EEPROM
  quando o usuário confirma GLOBAL > SALVAR (GLOBAL > RESTAURAR descarta as
  mudanças não salvas, recarregando da EEPROM). Diverge intencionalmente do
  caminho do protocolo serial (usado pelo app desktop), que continua
  salvando cada campo imediatamente ao mudar — o app desktop não tem um
  botão "salvar" equivalente.
- Como o hardware não tem circuito de MIDI DIN (5 pinos), a opção "SAIDA"
  da tela GLOBAL (que na especificação original previa USB/DIN/USB+DIN) foi
  adaptada pra USB/BLE/USB+BLE, os dois transportes que o projeto de fato
  tem (USB-MIDI da Fase B e BLE-MIDI da Fase H).
- O campo "KIT" do spec original **não foi implementado**, nem como
  placeholder — o usuário pediu explicitamente pra não implementar por
  enquanto. Não existe em nenhuma camada (firmware, protocolo serial, app
  desktop, simulador). Ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).
- **Correção de linkage na lib vendorizada**: o array `rawValue[]`
  (`hellodrum.h`/`hellodrum.cpp`) era `static` no header, causando uma cópia
  isolada por arquivo `.cpp` (linkage interno). Trocado para `extern` no
  header + definição única no `.cpp`, permitindo que `main.cpp` leia os
  valores brutos do ADC pra desenhar a tela SIGNAL.
- **Reskin visual completo do app desktop** (Electron/React), seguindo a
  mesma paleta e tipografia da tela do módulo (tokens de cor BG/SURFACE/
  LINE/TXT_DIM/TXT/ACCENT/EDIT/HIT/OK; fontes Silkscreen + Space Grotesk via
  Google Fonts). API exposta pelo preload do Electron renomeada de
  `window.helloDrum` para `window.drumCore`. Nova aba "Global" no app
  desktop pra configurar canal MIDI/saída/brilho. `HardwareSimulator.tsx`
  reescrito do zero pra espelhar a nova máquina de estados de 5 páginas e a
  nova semântica dos dois encoders, incluindo o gesto de "hold" de 600ms
  (simulado via mouse down/up no navegador).
- Validado: compilação do firmware via PlatformIO (`pio run`, sucesso) e
  `npm run typecheck` + `npm run build` no app desktop (ambos limpos).

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
- Nome anunciado via Bluetooth: `"DrumCore"`. Instância nomeada `BleMidi`
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
  ocupado") - removido do app desktop em 2026-09-04 (Fase Y, ver mais abaixo),
  quando o hardware passou a ter 1 encoder só.
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
