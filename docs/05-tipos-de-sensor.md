# Tipos de sensor por pad (Fase G)

Baseado em [`docs/sensing.md`](https://github.com/RyoKosaka/HelloDrum-arduino-Library/blob/master/docs/sensing.md)
da lib base (cópia local em
`firmware/lib/HelloDrum-arduino-Library/docs/sensing.md`) e na leitura direta
do código-fonte (`hellodrum.cpp`) pra confirmar o que a documentação não deixa
100% explícito.

## Cada tipo usa no máximo 2 canais — nunca 3

O construtor de `HelloDrum` só aceita 1 ou 2 pinos (`HelloDrum(pin1)` ou
`HelloDrum(pin1, pin2)`) — é uma limitação estrutural da lib, não uma escolha
nossa. Isso vale até pro **prato de 3 zonas**: a 3ª zona (cup) não é um canal
separado — é o **mesmo** sinal analógico do switch de filme do prato (o mesmo
usado pra detectar a borda/edge), só que passado por um divisor de tensão no
prato (ex: Yamaha PCY135/155). A lib distingue "borda" de "cup" comparando
esse único valor contra dois limiares diferentes (`Edge Threshold` e
`Cup Threshold`, sendo o do cup mais alto). Confirmado lendo
`cymbal3zoneMUX()`/`cymbal3zoneSensing()` em `hellodrum.cpp` — só lê
`pin_1` (piezo do corpo) e `pin_2` (o switch).

## Os 9 tipos

| # | Tipo | Canais | Método da lib | Zonas/estados |
|---|---|---|---|---|
| 0 | Simples | 1 | `singlePiezoMUX()` | 1 (bow) |
| 1 | Aro / Dual | 2 | `dualPiezoMUX()` | head + rim |
| 2 | Chimbal simples | 1 | `HHMUX()` | 1 zona, nota varia com aberto/fechado |
| 3 | Prato 2 zonas | 2 | `cymbal2zoneMUX()` | bow + edge |
| 4 | Chimbal 2 zonas | 2 | `HH2zoneMUX()` | bow + edge, nota varia com aberto/fechado |
| 5 | Prato 3 zonas | 2 | `cymbal3zoneMUX()` | bow + edge + cup (mesmo canal do edge, por threshold) |
| 6 | Pedal de chimbal (FSR/VH-10/VH-11) | 1 | `hihatControlMUX()` | posição (CC) + "chick" ao fechar rápido |
| 7 | Pedal de chimbal óptico (TCRT5000) | 1 | `TCRT5000MUX()` | igual ao 6, sensor diferente |
| 8 | Caixa 3 zonas | 2 | `cymbal3zoneMUX()` | centro (head) + borda (edge) + aro (rim), mesma técnica do tipo 5 |

### Tipo 8 — Caixa 3 zonas (centro/borda/aro)

Pedido do usuário: uma caixa real costuma distinguir 3 sons (centro da
pele, perto da borda da pele, e o aro/rimshot), mas isso normalmente **não**
vem de 3 sensores — vem de 2 (um na pele, um no aro), com o segundo sensor
sendo lido contra 2 thresholds em sequência (fraco = vibração só bateu perto
da borda; forte = pancada de verdade no aro). É **exatamente** a mesma
técnica que o tipo 5 (prato 3 zonas) já usa pra separar "edge" de "cup" —
por isso o tipo 8 reusa `cymbal3zoneMUX()`/`cymbal3zoneSensing()` sem
nenhuma mudança na lib vendorizada, só relabelando as zonas:

| Zona da lib | Zona no protocolo | Campo de nota | Cabeamento |
|---|---|---|---|
| `hit` (bow) | `"head"` | `note` | Piezo da pele (`pin_1`, igual ao tipo 1) |
| `hitRim` (edge) | `"edge"` | `note_rim` (`noteEdge`) | Piezo do aro (`pin_2`), sinal fraco |
| `hitCup` (cup) | `"rim"` | `note_cup` (`noteCup`) | Piezo do aro (`pin_2`), sinal forte |

O cabeamento físico é **idêntico** ao do tipo 1 (Aro/Dual) — mesmo piezo na
pele, mesmo piezo no aro. A diferença é só de software: o tipo 1 decide
"pele ou aro" comparando as amplitudes dos dois sensores; o tipo 8 usa o
mesmo sensor de aro, mas com 2 limiares (`EDGETHR`/`RIMTHR` na tela,
`rim_sensitivity`/`rim_threshold` no protocolo) pra separar "vibrou pouco no
aro" de "vibrou muito no aro". Trocar entre os dois tipos não exige
recabear nada — é só mudar `pad_type` e ajustar os thresholds.

Canal físico: cada "canal" é uma entrada de um dos 2x CD4067/HW-178 (0-31). Um pad
de 2 canais consome o seu próprio canal **e o canal seguinte** (adjacente) —
ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) pra como
isso é modelado no firmware.

## Calibrando sensitivity/threshold/scan_time/mask_time sem tentativa e erro

Desde a Fase O, esses 4 campos (do sensor principal do pad) podem ser
calculados automaticamente pelo assistente de auto-calibração — bate no
pad algumas vezes e o firmware mede o comportamento real do sensor, em vez
de ajustar cada slider manualmente. Ver
[01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) (Fase O) pro
algoritmo completo e [04-protocolo-serial.md](04-protocolo-serial.md) pros
comandos (`start_autotune`/`cancel_autotune`/`apply_autotune`).

## Mais 3 parâmetros universais (Fase P): `retrigger`, `gain`, `xtalk`/`xtalk_group`

Também pesquisados no microDRUM/nanoDRUM, aparecem pra todos os 9 tipos
(logo depois de `mask_time` e no fim da lista, respectivamente):

- **`retrigger`** (0-100, `0` = desligado): afrouxa o `mask_time` — uma
  pancada bem mais forte que a anterior pode disparar de novo antes do
  tempo todo passar. Único parâmetro dessa fase que exigiu modificar a lib
  vendorizada (ver [03-biblioteca-hellodrum.md](03-biblioteca-hellodrum.md)).
- **`gain`** (10-200 = 0.10x-2.00x, 100 = neutro): recalibra a amplitude
  lida do sensor **antes** do threshold — útil pra compensar um piezo com
  saída muito forte/fraca sem reajustar sensibilidade e threshold juntos.
- **`xtalk`**/**`xtalk_group`** (0-100 / 0-4, `0` = desligado/sem grupo):
  suprime o hit se outro pad do mesmo grupo bateu bem mais forte no mesmo
  instante — vibração mecânica entre pads montados juntos, ou crosstalk
  elétrico entre canais (ex: mesmo índice local nos 2 CD4067, que
  compartilham o barramento S0-S3 — ver [02-hardware.md](02-hardware.md)).

Os 3 são resolvidos fora da lib (em `main.cpp`, entre o `scan()`/
`dispatchSensing()` e o `handlePadResult()`) — ver
[01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) (Fase P) pro
racional completo de cada um.

## Campos de configuração — e por que só 6, não mais

A lib expõe só 3 "slots" de nota realmente independentes por pad
(`note`/`noteRim`/`noteCup` internamente — que no nosso protocolo são `note`,
`note_rim`, `note_cup`) e um par sensibilidade/threshold extra
(`rimSensitivity`/`rimThreshold`, expostos como `rim_sensitivity`/
`rim_threshold`). Esses campos são **reaproveitados com sentidos diferentes
dependendo do tipo do pad** — é assim que a própria lib já funciona (mesmo
padrão usado por `HelloDrum::settingEnable()`, o fluxo de edição pelos
encoders), não uma limitação que criamos:

| Campo do protocolo | Campo interno da lib | Sentido pro tipo... |
|---|---|---|
| `rim_sensitivity` | `rimSensitivity` | Aro (1): sensibilidade do aro. Prato 2/3 zonas (3/5), chimbal 2 zonas (4), caixa 3 zonas (8): threshold da borda (edge). Pedal (6/7): sensibilidade do pedal. |
| `rim_threshold` | `rimThreshold` | Aro (1): threshold do aro. Prato 3 zonas (5) e caixa 3 zonas (8): threshold do cup/aro. Não usado nos outros tipos. |
| `note` | `note` (+ alias `noteOpen`) | Nota principal: bow/head/centro, ou "aberto" nos tipos de chimbal, ou a nota do "pedal chick". |
| `note_rim` | `noteRim` (+ alias `noteEdge`, `noteClose`, `noteOpenEdge`) | Aro (1): nota do rim. Prato 2/3 zonas (3/5), caixa 3 zonas (8): nota da borda. Chimbal (2/4): nota de "fechado" (cobre bow fechado **e** borda, em qualquer estado — ver limitação abaixo). |
| `note_cup` | `noteCup` (+ alias `noteCloseEdge`, `noteCross`) | Prato 3 zonas (5): nota do cup. Caixa 3 zonas (8): nota do aro (rim). |
| `hihat_invert` | `padHihatInvert[]` (fora da lib - array próprio em `main.cpp`, Fase X) | Pedal (6/7) só: inverte o CC final (`127 - pedalCC`) pra sensores que mandam a posição invertida. Não usado nos outros tipos. Ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md). |

**Limitação real da lib (não é bug nosso)**: como `note_rim` seta
`noteRim`/`noteEdge`/`noteClose`/`noteOpenEdge` **todos pro mesmo valor** de
uma vez (mesmo aliasing que `settingEnable()` já faz nos encoders), não tem
como configurar "borda com o chimbal aberto" com um som diferente de
"fechado" — os dois usam o mesmo valor de `note_rim`. Por isso, pro chimbal
2 zonas, só distinguimos aberto/fechado na zona do corpo (bow); a borda usa
sempre `note_rim`, em qualquer estado. Ver `handlePadResult()` em
`firmware/src/main.cpp` pro código exato.

## Chimbal: o pedal e o prato/chimbal são pads separados, linkados

Um "chimbal" completo, em termos de sensor, é sempre **dois pads físicos
diferentes**: o **pedal** (posição aberto/fechado, tipos 6/7) e o
**prato/chimbal** em si (tipos 2/4, que detecta as pancadas). A lib não faz
essa ligação automaticamente — o pedal só atualiza seus próprios campos
`openHH`/`closeHH` (confirmado lendo `FSRSensing()`/`TCRT5000Sensing()`
em `hellodrum.cpp` — nenhum outro método da lib olha esses campos).

Por isso, os tipos 2 e 4 (chimbal simples/2 zonas) têm um campo extra,
**`hihat_pedal_channel`**: o índice do pad configurado como tipo 6 ou 7 que
serve de referência pro estado aberto/fechado. Sem link (`-1`), o firmware
assume "sempre aberto" (`note`/nota de aberto sempre usada).

## Canais consumidos ("2º canal")

Quando um pad tem tipo de 2 canais, o canal seguinte (índice+1) fica
reservado — sem configuração própria, sem nome, sem sensing. O protocolo
representa isso com `"primary": false` (ver
[04-protocolo-serial.md](04-protocolo-serial.md)). Mudar o tipo do pad de
volta pra um tipo de 1 canal libera o canal seguinte automaticamente.

## Bug corrigido (2026-08-22): `PAD_DUAL` nunca enviava hit/nota

Pesquisando o tipo 8 (caixa 3 zonas), percebemos que `handlePadResult()`
nunca tinha um `case PAD_DUAL:` — desde a Fase G, um pad configurado como
tipo 1 (Aro/Dual, o caso mais comum pra uma caixa) simplesmente não emitia
`hit` nem MIDI nenhum quando batido, apesar do protocolo
([04-protocolo-serial.md](04-protocolo-serial.md)) e o modo demo do app
(`mockDevice.ts`) já preverem as zonas `"head"`/`"rim"` pra esse
tipo. Corrigido em `firmware/src/main.cpp` — ver
[01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).

## O que ainda não foi testado

Tudo isso foi implementado com base na leitura do código-fonte da lib, sem
hardware pra validar. Pontos de maior risco de precisar de ajuste quando
houver bancada:
- Faixa real de `pad.pedalCC` (assumimos 0-127 direto, sem escala adicional,
  baseado na leitura do código de bucketing em `FSRSensing()`).
- Threshold de edge/cup em pratos 3 zonas reais (a doc da lib já avisa que
  os valores variam por modelo/circuito) — o mesmo vale pro threshold de
  borda/aro do tipo 8 (caixa 3 zonas), que nunca foi calibrado numa caixa
  física de verdade.
- Se `HH2zoneMUX()` se comporta exatamente como esperado num chimbal físico
  2 zonas real (a lib documenta isso mais pra prato do que pra chimbal).
- O assistente de captura de range do pedal (Fase X, `AT_HH_OPEN`/
  `AT_HH_CLOSED` em `main.cpp`) e o campo `hihat_invert` nunca foram
  testados com um pedal FSR/óptico físico de verdade.
