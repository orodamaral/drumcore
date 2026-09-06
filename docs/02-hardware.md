# Hardware

**Esquemático visual**: [docs/assets/esquematico-hellodrum.html](assets/esquematico-hellodrum.html)
(abrir no navegador) reúne todo o pinout abaixo num diagrama único — ESP32-S3
↔ 2x CD4067 (HW-178) ↔ tela TFT ↔ 1 encoder, já mostrando de qual header
físico (esquerdo/direito) cada fio sai. Também publicado como
[artifact](https://claude.ai/code/artifact/7bcaa18b-a9b3-46e4-8ba0-90197b7ededc)
(link privado, pode estar desatualizado - o arquivo local é a fonte da
verdade). Gerado em 2026-08-20, redesenhado em 2026-08-21 para o CD4067
(Fase K), reorganizado por ergonomia de montagem em 2026-08-21 (Fase L),
refinado no mesmo dia pra usar pinos fisicamente **contíguos** dentro de
cada header, reduzido de 2 encoders pra 1 na Fase Y (2026-09-04) e
**reorganizado por função** (em vez de por alimentação) na Fase Z
(2026-09-05, ver seção "Divisão adotada" abaixo) — atualizar (ou marcar
como desatualizado) se o pinout abaixo mudar de novo.

## Componentes previstos

- 1x placa ESP32-S3 (dev board, 44 pinos em 2 headers de 22, USB-C nativo
  exposto). Pinout confirmado a partir de uma foto da placa real (vendedor
  "OceanLabz") em 2026-08-21 — ver seção "Pinout real da placa" abaixo.
  Módulo confirmado por Rodrigo na serigrafia em 2026-08-31: **ESP32-S3-N16R8**
  (16MB flash + 8MB PSRAM **octal**) — GPIO33-37 são internos (barramento
  da PSRAM) nessa variante, ver "Pinos evitados" abaixo.
  `firmware/platformio.ini` ajustado em 2026-08-31 (overrides de
  `board_build`/`board_upload` + `-D BOARD_HAS_PSRAM`) pra refletir o
  módulo real (16MB flash, PSRAM octal habilitada) — ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) pro
  detalhe. `pio run` confirmado com sucesso.
- 2x módulo multiplexador analógico CD4067 (breakout "HW-178", 16 canais
  cada → 32 canais totais). Comprado já montado em placa (resistores/
  desacoplamento inclusos) — substitui as 4x CD4051 previstas originalmente,
  ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) pro
  racional da troca (Fase K).
  **Realização física (2026-09-06, confirmado por Rodrigo)**: em vez do
  breakout HW-178 avulso, cada um dos 2 MUX vive numa placa própria — a
  **jackboard** (`hardware/jackboard/`, projeto KiCad): HC4067 onboard +
  8 jacks TRS 6.35mm (16 canais) + rede de proteção por canal. O sistema
  final usa **2 jackboards idênticas**, uma por MUX, pra fechar os 32
  canais. Ver [site/hardware.html](../site/hardware.html) e
  `docs/CHANGELOG.md` (entrada 2026-09-06) pro estado atual da placa.
- Pads piezo (simples e/ou duplos), pratos 2/3 zonas, hi-hat, conforme suportado
  pela lib (ver [03-biblioteca-hellodrum.md](03-biblioteca-hellodrum.md)).
- Tela TFT 1.8" 128x160 RGB (sticker do modelo real - a doc antiga dizia
  1.44"/128x128, era só suposição antes de conferir na placa física),
  driver ST7735S, interface SPI, rodando em paisagem (160x128 na tela,
  `setRotation(1)` - ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md),
  Fase R). Substitui o OLED SSD1306/I2C previsto inicialmente.
- 1x encoder rotativo com chave (push-button), para navegação/edição —
  substitui os 5 botões discretos originalmente previstos, e o par de 2
  encoders usado até a Fase Y (2026-09-04) — ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) (Fase Y e
  Fase Z).

## Pinout real da placa (Fase L, reorganizado na Fase Z)

A placa comprada expõe os 44 GPIOs do ESP32-S3 em 2 headers físicos de 22
pinos cada, um de cada lado do módulo WROOM. Isso importa pra ergonomia da
montagem: **cada subsistema (MUX, tela, encoder) deve sair inteiro de um
único header**, pra não precisar de fios cruzando de um lado ao outro da
placa.

Até a Fase Y, a divisão era guiada por **alimentação**: `3V3` só existia no
header esquerdo (o direito só tinha `GND`), então o MUX e a tela (que
precisam de VCC) ficavam à força no header esquerdo, sobrando o direito só
pros encoders (que usam apenas pull-up interno, sem VCC externo).

**Fase Z (2026-09-05)**: a placa física ganhou pads de `3V3`/`GND` extras
nos **dois** headers (adicionados por fora do dev board original,
independente do desenho de fábrica) — então essa restrição deixou de
existir, e a divisão passou a ser guiada por **função** em vez de
alimentação: interface do usuário (encoder + tela) de um lado, sensing
(2x CD4067) do outro. Cada lado continua usando um bloco único de pinos
**fisicamente contíguos** (sem nenhum outro sinal no meio) — só mudou o
critério de agrupamento, não a regra de contiguidade.

A ordem física real do header esquerdo (de cima a baixo) é `3V3,3V3,RST,
4,5,6,7,15,16,17,18,8,3,46,9,10,11,12,13,14,5V,GND` — descontando `3V3`,
`RST`, `5V`, `GND` (não são GPIO) e os 2 pinos de strapping (`3`, `46`,
avoid list abaixo), sobra um bloco contíguo de 9 GPIOs logo após o `3V3`:
`4,5,6,7,15,16,17,18,8`. É exatamente o tanto que encoder (3 sinais) + tela
(6 sinais) precisam juntos — cabem inteiros nesse bloco, sem pular nada.

A ordem física real do header direito inclui o trecho contíguo `...44,1,2,
42,41,40,39,38,...` (mesmo trecho que os 2 encoders usavam antes da
Fase Y/Z) — descontando o `GPIO38` (evitado, aciona o LED embutido), sobra
o bloco contíguo `1,2,42,41,40,39`, exatamente os 6 sinais que o MUX
precisa (S0-S3 + SIG0 + SIG1).

**Divisão adotada (Fase Z)**:

| Header | Subsistema | Sinais |
|---|---|---|
| **Esquerdo** | Encoder | A, B, SW |
| **Esquerdo** | Tela TFT ST7735 | DC, CS, MOSI, SCLK, BLK, RST |
| **Direito** | 2x CD4067 (HW-178) | S0, S1, S2, S3, SIG0, SIG1 |

> Os pads de `3V3`/`GND` extras nos dois headers (que tornam essa divisão
> possível) são uma modificação física da placa feita pelo Rodrigo, fora do
> escopo do que o firmware/software controla — ver
> [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) (Fase Z).

**Pinos evitados** (`firmware/src/main.cpp`, ver
[01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) Fase L pro
racional completo de cada um):

- `GPIO0`, `GPIO3`, `GPIO45`, `GPIO46` — pinos de strapping (afetam o modo
  de boot; nunca usar como sinal de periférico).
- `GPIO19`, `GPIO20` — USB nativo (D-/D+), usados internamente pelo
  USB-MIDI da Fase B.
- `GPIO38` — nessa placa, aciona um LED embutido (rótulo `BUILTIN LED` na
  serigrafia/datasheet do vendedor, confirmado por Rodrigo direto na placa
  física em 2026-08-31 — corrige uma leitura anterior que atribuía o LED
  RGB a este pino). Usar esse pino pra outra coisa entraria em conflito com
  o LED onboard. O LED RGB endereçável de fato fica no `GPIO48` (rótulo
  `RGB LED`), já excluído abaixo por outro motivo (sinal interno de
  flash/PSRAM nessa variante do módulo).
- `GPIO47`, `GPIO48` — rotulados `SPICLK_P`/`SPICLK_N` na placa, sinais
  internos de flash/PSRAM nessa variante do módulo — não expor.
- `GPIO35`, `GPIO36`, `GPIO37` — essa placa expõe eles como GPIO genérico,
  mas em módulos ESP32-S3 com PSRAM **octal** esses mesmos pinos são
  internos (ligados ao chip de PSRAM) e usá-los externamente trava a
  placa. A serigrafia expor esses pinos como header sugere que este
  módulo **não** é a variante octal — mas isso não foi confirmado contra o
  datasheet exato do módulo. Desde o ajuste de contiguidade de
  2026-08-31 (ver seção de encoders abaixo), nenhum pino do projeto atual
  depende disso — o risco fica registrado só como referência caso algum
  uso futuro volte a cogitar esses 3 GPIOs.

## Ligação CD4067 (HW-178) ↔ ESP32-S3 — header DIREITO

Cada módulo HW-178 precisa de 4 pinos digitais de seleção de canal (S0, S1,
S2, S3, compartilháveis entre as 2 placas) + 1 pino ADC dedicado (SIG, saída
analógica — este **não** pode ser compartilhado, cada MUX precisa do seu
próprio pino ADC) + alimentação (VCC 3.3V, GND) + o pino **EN** (enable,
ativo em LOW) **ligado direto em GND** em cada uma das 2 placas — não é
controlado pelo firmware (a lib não expõe esse pino; como cada MUX tem seu
próprio pino SIG, não há necessidade de desabilitar um deles em nenhum
momento, então fica sempre habilitado por fiação).

**Se aparecer crosstalk entre os 2 CD4067** (mesmo canal local em cada
placa — ex: canal 3 do MUX 0 e canal 3 do MUX 1 — lidos no mesmo instante
via o barramento S0-S3 compartilhado): existe uma mitigação por software
(`xtalk`/`xtalk_group` no protocolo, Fase P — ver
[01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)) que suprime
o hit mais fraco quando 2 pads do mesmo grupo batem "juntos". Não
substitui um bom desacoplamento elétrico (capacitores perto de cada
CD4067, fiação de sinal curta/blindada se possível) — é um plano B pra
quando o crosstalk aparecer na prática, não uma solução definitiva.

```
HW-178 (CD4067) #n --------- ESP32-S3 (header DIREITO)
S0     ------------ (compartilhado entre as 2 placas)
S1     ------------ (compartilhado entre as 2 placas)
S2     ------------ (compartilhado entre as 2 placas)
S3     ------------ (compartilhado entre as 2 placas)
SIG    ------------ pino ADC dedicado ao MUX #n
EN     ------------ GND (sempre habilitado, fixo por fiação)
VCC    ------------ 3.3V (pad extra adicionado no header direito, Fase Z)
GND    ------------ GND
```

### Pinout (usado em `firmware/src/main.cpp`)

> **Status: proposto, ainda não validado em hardware real** (o MUX físico
> ainda não foi conectado nesse pinout novo — encoder e tela já foram,
> ver seções abaixo). Reorganizado na Fase Z (2026-09-05) pro header
> DIREITO, no bloco contíguo
> `GPIO1,2,42,41,40,39` (mesma faixa física que os 2 encoders usavam antes
> da Fase Y/Z). SIG0/SIG1 (leitura analógica) precisam de pino com ADC —
> só `GPIO1`/`GPIO2` desse bloco têm (**ADC1_CH0**/**ADC1_CH1**), então
> ficam com eles; S0-S3 (linhas digitais de seleção, sem precisar de ADC)
> ficam nos 4 restantes (`42,41,40,39`). Isso troca o MUX de ADC2 (Fase L)
> pra ADC1 — mais simples que antes: ADC1 nunca conflita com Wi-Fi (nem
> precisa do racional "tá seguro pq não tem Wi-Fi" que a Fase L precisou).

| Sinal | GPIO (ESP32-S3) |
|---|---|
| S0 (compartilhado) | 42 |
| S1 (compartilhado) | 41 |
| S2 (compartilhado) | 40 |
| S3 (compartilhado) | 39 |
| SIG — MUX 0 (pads 0-15) | 1 |
| SIG — MUX 1 (pads 16-31) | 2 |

Atualizar esta tabela (e o `main.cpp`) quando o pinout for validado/ajustado no
hardware real.

## Tela TFT (ST7735, SPI) — header ESQUERDO

**Modelo**: 1.8" 128x160 RGB (confirmado pelo sticker na placa física -
`INITR_BLACKTAB`, não `INITR_144GREENTAB`), driver IC ST7735S. 8 pinos:
`GND VCC SCL SDA RES DC CS BLK` (SPI, não I2C). Rodando em paisagem
(`setRotation(1)`, 160x128) - ver
[01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) Fase R.

| Sinal na tela | Função | GPIO (ESP32-S3) |
|---|---|---|
| SCL | SPI Clock (SCK) | 7 |
| SDA | SPI Data (MOSI) | 15 |
| RES | Reset | 16 |
| DC | Data/Command | 17 |
| CS | Chip Select | 18 |
| BLK | Backlight | 8 (ou direto em 3.3V, se não precisar controlar brilho) |
| VDD | 3.3V | — (pad extra ao lado do bloco, ver ajuste abaixo) |
| GND | GND | — (pad extra ao lado do bloco, ver ajuste abaixo) |

> **Status: validado em hardware real (2026-09-06)** — Rodrigo conectou a
> tela nesse pinout novo e confirmou funcionando.
>
> **Fase Z (2026-09-05)**: a tela forma um feixe único e contíguo com o
> encoder (`GPIO4,5,6,7,15,16,17,18,8` — encoder nos 3 primeiros, tela nos
> 6 seguintes), já que ambos saem do header ESQUERDO agora (interface do
> usuário de um lado, MUX do outro — ver "Divisão adotada" mais acima).
>
> **Ajuste (2026-09-06)**: a pedido do Rodrigo, os 6 GPIOs da tela foram
> reordenados dentro desse mesmo bloco pra casar com a ordem física real
> do conector dela (`GND VDD SCL SDA RES DC CS BLK`) — descontando
> `GND`/`VDD` (não são GPIO), os 6 sinais restantes saem na sequência
> `SCL(7) → SDA(15) → RES(16) → DC(17) → CS(18) → BLK(8)`, batendo 1:1 com
> a ordem física do bloco `7,15,16,17,18,8`. `GND`/`VDD` da tela vão nos
> pads extras que o Rodrigo está adicionando fisicamente perto desse
> bloco (não existe `GND`/`3V3` de fábrica logo ali — ver "Divisão
> adotada" mais acima sobre os pads extras).

## Navegação/configuração: 1 encoder rotativo com chave — header ESQUERDO

Substitui os 5 botões discretos (EDIT/UP/DOWN/NEXT/BACK) que a classe
`HelloDrumButton` da lib pressupõe originalmente. Até a Fase X eram 2
encoders (rotação + chave cada); a Fase Y (2026-09-04) reduziu pra 1 só,
que sozinho cobre toda a navegação (girar = navega/ajusta valor, clicar =
desce um nível/confirma, segurar = volta um nível) — ver
[01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) Fase Y pro
mapeamento completo e o racional, e Fase Z pro pinout atual.

| Sinal | Função | GPIO (ESP32-S3) |
|---|---|---|
| A | Quadratura | 4 |
| B | Quadratura | 5 |
| SW | Click/hold | 6 |

> **Fase Z (2026-09-05)**: migrado do header direito (`GPIO41,40,39`) pro
> header esquerdo, no bloco contíguo que também tem a tela
> (`GPIO4,5,6,7,15,16,17,18,8` — ver "Divisão adotada" mais acima). Os
> `GPIO41,40,39` (ex-encoder) agora fazem parte do bloco do MUX no header
> direito; `GPIO1,2,42` (livres desde a Fase Y) também entraram no bloco
> do MUX.
>
> **VCC do encoder (2026-09-02, ainda válido)**: o módulo físico que
> chegou é um breakout pronto (5 pinos: `GND S1 S2 KEY VCC`) com
> componentes SMD visíveis (resistor + capacitor) — quase certamente
> pull-ups de `S1`/`S2`/`KEY` pra `VCC` (+ talvez um capacitor de
> debounce), não um encoder cru. `VCC` vai no `3V3` (o ESP32-S3 também
> mantém `INPUT_PULLUP` interno ativo em `S1`/`S2`/`KEY` — os dois
> pull-ups ao mesmo tempo não causam problema elétrico).
>
> **Status: validado em hardware real (2026-09-06)** — Rodrigo religou o
> encoder nesse pinout novo (GPIO4/5/6) e confirmou a navegação
> funcionando (giro/clique/hold).

## Notas

- Pinos livres/sobressalentes: `GPIO10,11,12,13,14` (header esquerdo, onde
  a tela ficava antes da Fase Z) e `GPIO21` (header direito) — nenhum uso
  previsto por ora. `GPIO9` (mesmo grupo) está em uso temporário, ver
  abaixo.
- `GPIO43`/`GPIO44` (header direito) **não estão livres**, apesar de
  aparecerem como GPIO genérico na serigrafia: são o UART físico
  (TXD0/RXD0) que o firmware usa pra `Serial` (protocolo NDJSON com o app)
  quando compilado com `ARDUINO_USB_CDC_ON_BOOT=0` — ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) (Fase R).
  Corrige uma nota anterior que os listava como "sem uso previsto".
- **GPIO9 em uso temporário** (teste do sensor hall, ver
  `TEST_DIRECT_HEAD_PIN` em `firmware/src/main.cpp`) — antes era GPIO17,
  migrado na Fase Z porque GPIO17 virou permanente (agora `TFT_DC`, ver
  ajuste de 2026-09-06 na seção da tela). Volta a ficar livre quando o
  MUX físico for conectado e esse bloco de teste for removido.
- Esta seção deve ser atualizada com o pinout real assim que o hardware for
  prototipado/testado, incluindo fotos ou diagramas se fizer sentido.
