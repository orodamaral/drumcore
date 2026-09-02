# Hardware

**Esquemático visual**: [docs/assets/esquematico-hellodrum.html](assets/esquematico-hellodrum.html)
(abrir no navegador) reúne todo o pinout abaixo num diagrama único — ESP32-S3
↔ 2x CD4067 (HW-178) ↔ tela TFT ↔ 2 encoders, já mostrando de qual header
físico (esquerdo/direito) cada fio sai. Também publicado como
[artifact](https://claude.ai/code/artifact/7bcaa18b-a9b3-46e4-8ba0-90197b7ededc)
(link privado). Gerado em 2026-08-20, redesenhado em 2026-08-21 para o
CD4067 (Fase K), reorganizado por ergonomia de montagem em 2026-08-21
(Fase L) e refinado no mesmo dia pra usar pinos fisicamente **contíguos**
dentro de cada header (não só "do mesmo lado") — atualizar (ou marcar como
desatualizado) se o pinout abaixo mudar de novo.

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
- Pads piezo (simples e/ou duplos), pratos 2/3 zonas, hi-hat, conforme suportado
  pela lib (ver [03-biblioteca-hellodrum.md](03-biblioteca-hellodrum.md)).
- Tela TFT 1.8" 128x160 RGB (sticker do modelo real - a doc antiga dizia
  1.44"/128x128, era só suposição antes de conferir na placa física),
  driver ST7735S, interface SPI, rodando em paisagem (160x128 na tela,
  `setRotation(1)` - ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md),
  Fase R). Substitui o OLED SSD1306/I2C previsto inicialmente.
- 2x encoder rotativo com chave (push-button), para navegação/edição —
  substitui os 5 botões discretos originalmente previstos. Ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).

## Pinout real da placa (Fase L)

A placa comprada expõe os 44 GPIOs do ESP32-S3 em 2 headers físicos de 22
pinos cada, um de cada lado do módulo WROOM. Isso importa pra ergonomia da
montagem: **cada subsistema (MUX, tela, cada encoder) deve sair inteiro de
um único header**, pra não precisar de fios cruzando de um lado ao outro da
placa. Dois fatos do pinout real guiaram a divisão:

- **`3V3` só existe no header ESQUERDO** (2 pinos, topo). O header direito só
  tem `GND` (topo e base) — sem alimentação. Então qualquer coisa que
  precise de VCC (os 2x CD4067, a tela TFT) **tem** que sair do header
  esquerdo, ou precisaria de um fio de 3.3V cruzando a placa de qualquer
  jeito.
- Os **2 encoders usam só pull-up interno do ESP32-S3** (sem resistor/VCC
  externo, ver seção de encoders abaixo) — só precisam de `GND` comum, que
  existe nos dois headers. Por isso podem ficar inteiramente no header
  direito sem custo elétrico nenhum.

Além de sair do mesmo header, cada subsistema usa pinos **fisicamente
adjacentes** entre si (sem nenhum outro sinal "no meio", na ordem real de
pinagem da placa) — a fiação de cada componente sai como um feixe único,
sem entrelaçar com a de outro componente. A ordem física real do header
esquerdo (de cima a baixo) é `3V3,3V3,RST,4,5,6,7,15,16,17,18,8,3,46,9,10,
11,12,13,14,5V,GND` — os 2 CD4067 usam os primeiros 6 logo após o `3V3`
(`4,5,6,7,15,16`). A tela **não** continua essa sequência (ver ajuste de
2026-08-31 na seção da tela abaixo): em vez disso usa os 6 pinos da
**base** do header, logo acima do `GND` (`9,10,11,12,13,14`), pra a ordem
física dos fios bater com a ordem do próprio conector da tela — sobram
`17,18,8` livres entre os dois grupos.

**Divisão adotada**:

| Header | Subsistema | Sinais |
|---|---|---|
| **Esquerdo** (tem `3V3`) | 2x CD4067 (HW-178) | S0, S1, S2, S3, SIG0, SIG1 |
| **Esquerdo** (tem `3V3`) | Tela TFT ST7735 | DC, CS, MOSI, SCLK, BLK, RST |
| **Direito** (só `GND`) | Encoder 1 | A, B, SW |
| **Direito** (só `GND`) | Encoder 2 | A, B, SW |

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

## Ligação CD4067 (HW-178) ↔ ESP32-S3 — header ESQUERDO

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
HW-178 (CD4067) #n --------- ESP32-S3 (header ESQUERDO)
S0     ------------ (compartilhado entre as 2 placas)
S1     ------------ (compartilhado entre as 2 placas)
S2     ------------ (compartilhado entre as 2 placas)
S3     ------------ (compartilhado entre as 2 placas)
SIG    ------------ pino ADC dedicado ao MUX #n
EN     ------------ GND (sempre habilitado, fixo por fiação)
VCC    ------------ 3.3V (só existe no header esquerdo)
GND    ------------ GND
```

### Pinout (usado em `firmware/src/main.cpp`)

> **Status: proposto, ainda não validado em hardware real.** SIG0/SIG1
> usam GPIO15/16 — que são **ADC2**, não ADC1 (as fases anteriores
> preferiam ADC1 pra evitar o conflito clássico de ADC2 com o driver
> Wi-Fi). Escolhidos aqui de propósito: são os únicos 2 pinos que
> continuam a sequência física `4,5,6,7,...` sem pular nenhum outro sinal,
> e este projeto **nunca inicializa Wi-Fi** (só BLE-MIDI, que usa um
> caminho de rádio separado e não disputa o ADC2) — o conflito não se
> aplica aqui. Se o projeto um dia ganhar Wi-Fi, reavaliar.

| Sinal | GPIO (ESP32-S3) |
|---|---|
| S0 (compartilhado) | 4 |
| S1 (compartilhado) | 5 |
| S2 (compartilhado) | 6 |
| S3 (compartilhado) | 7 |
| SIG — MUX 0 (pads 0-15) | 15 |
| SIG — MUX 1 (pads 16-31) | 16 |

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
| SCL | SPI Clock (SCK) | 14 |
| SDA | SPI Data (MOSI) | 13 |
| RES | Reset | 12 |
| DC | Data/Command | 11 |
| CS | Chip Select | 10 |
| BLK | Backlight | 9 (ou direto em 3.3V, se não precisar controlar brilho) |
| VCC | 3.3V | — (só existe no header esquerdo, no topo) |
| GND | GND | — (base do header esquerdo) |

> **Status: proposto, ainda não validado em hardware real.**
>
> **Ajuste de espelhamento (2026-08-31)**: pinos remapeados pra casar com
> a ordem física do próprio conector da tela (`GND VCC SCL SDA RES DC CS
> BLK`). No header esquerdo da placa, `GND` fica na base (último pino) e
> `3V3` no topo (primeiro pino) — então, subindo a partir do `GND` da
> base (pulando só o `5V` fixo, que não é GPIO), os 6 sinais da tela saem
> na exata ordem do conector dela: `SCL`(14) mais perto do `GND`, depois
> `SDA`(13), `RES`(12), `DC`(11), `CS`(10), `BLK`(9) — o fio de cada sinal
> sai reto, sem cruzar o vizinho. Só o `VCC` foge dessa sequência (o `3V3`
> só existe no topo do header) e precisa de um fio isolado até lá — aceito
> de propósito, é a única exceção. Como efeito colateral, a tela deixa de
> formar um único feixe contíguo com o MUX (que fica em GPIO4-7/15/16,
> perto do topo) — sobram `GPIO17`, `GPIO18`, `GPIO8` livres entre os dois
> grupos (ver "Notas" abaixo).

## Navegação/configuração: 2x encoder rotativo com chave — header DIREITO

Substitui os 5 botões discretos (EDIT/UP/DOWN/NEXT/BACK) que a classe
`HelloDrumButton` da lib pressupõe originalmente — em vez de ligar 5 botões
físicos, lemos 2 encoders (rotação + chave) e alimentamos manualmente
`HelloDrumButton::readButton(set, up, down, next, back)` com os sinais
equivalentes. Ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)
para o mapeamento completo e o racional.

| Encoder | Sinal | Função | GPIO (ESP32-S3) |
|---|---|---|---|
| 1 (pad/valor) | A | Quadratura | 1 |
| 1 (pad/valor) | B | Quadratura | 2 |
| 1 (pad/valor) | SW (chave) | EDIT/SET | 42 |
| 2 (item/parâmetro) | A | Quadratura | 41 |
| 2 (item/parâmetro) | B | Quadratura | 40 |
| 2 (item/parâmetro) | SW (chave) | Reservada (sem função ainda) | 39 |

> **Status: proposto, ainda não validado em hardware real.** Trocados na
> Fase L (antes: 15/16/17/18/21/38) pra sair inteiramente do header
> direito da placa real — os dois encoders usam só `GND` comum (pull-up
> interno do ESP32-S3, sem resistor/VCC externo), então não precisam do
> `3V3` que só existe no header esquerdo. GPIO38 (fora da faixa usada) é
> evitado por acionar o LED embutido (`BUILTIN LED`) dessa placa.
>
> **Ajuste de contiguidade (2026-08-31)**: a atribuição anterior
> (42/41/40 e 37/36/35) deixava um vão de 2 pinos (`GPIO39`, `GPIO38`)
> entre os dois encoders na ordem física real do header (`...44,1,2,
> 42,41,40,39,38,37,36,35,0...`). Reatribuído para `GPIO1,2,42,41,40,39`
> — os 6 pinos realmente contíguos e livres de qualquer pino evitado,
> logo após o `GND`/UART do topo do header direito. Como bônus, deixa de depender
> do `GPIO35-37` (risco de PSRAM octal, ver
> [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)) e não
> toca no `GPIO43/44` (TXD0/RXD0, usados pela porta UART/USB-serial de
> debug).

## Notas

- Pinos livres/sobressalentes: GPIO8 (header esquerdo, entre o fim do MUX
  e o início da tela) e GPIO21, GPIO43, GPIO44 (header direito) — nenhum
  uso previsto por ora. (GPIO1, GPIO2 e GPIO39 passaram a ser usados
  pelos encoders, e GPIO12/13/14 passaram a ser usados pela tela, nos
  ajustes de 2026-08-31 acima.)
- **GPIO17/GPIO18 em uso temporário** (2026-09-01, Fase S) — teste de pad
  dual-zone lido direto (sem MUX, que ainda não chegou): `TEST_DIRECT_HEAD_PIN`/
  `TEST_DIRECT_RIM_PIN` em `firmware/src/main.cpp`. Voltam a ficar livres
  quando o MUX físico for conectado e esse bloco de teste for removido.
- Esta seção deve ser atualizada com o pinout real assim que o hardware for
  prototipado/testado, incluindo fotos ou diagramas se fizer sentido.
