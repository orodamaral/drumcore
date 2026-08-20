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

## Os 8 tipos

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

Canal físico: cada "canal" é uma entrada de um dos 4x CD4051 (0-31). Um pad
de 2 canais consome o seu próprio canal **e o canal seguinte** (adjacente) —
ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md) pra como
isso é modelado no firmware.

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
| `rim_sensitivity` | `rimSensitivity` | Aro (1): sensibilidade do aro. Prato 2/3 zonas (3/5), chimbal 2 zonas (4): threshold da borda (edge). Pedal (6/7): sensibilidade do pedal. |
| `rim_threshold` | `rimThreshold` | Aro (1): threshold do aro. Prato 3 zonas (5): threshold do cup. Não usado nos outros tipos. |
| `note` | `note` (+ alias `noteOpen`) | Nota principal: bow/head, ou "aberto" nos tipos de chimbal, ou a nota do "pedal chick". |
| `note_rim` | `noteRim` (+ alias `noteEdge`, `noteClose`, `noteOpenEdge`) | Aro (1): nota do rim. Prato 2/3 zonas (3/5): nota da borda. Chimbal (2/4): nota de "fechado" (cobre bow fechado **e** borda, em qualquer estado — ver limitação abaixo). |
| `note_cup` | `noteCup` (+ alias `noteCloseEdge`, `noteCross`) | Só usado no prato 3 zonas (5): nota do cup. |

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

## O que ainda não foi testado

Tudo isso foi implementado com base na leitura do código-fonte da lib, sem
hardware pra validar. Pontos de maior risco de precisar de ajuste quando
houver bancada:
- Faixa real de `pad.pedalCC` (assumimos 0-127 direto, sem escala adicional,
  baseado na leitura do código de bucketing em `FSRSensing()`).
- Threshold de edge/cup em pratos 3 zonas reais (a doc da lib já avisa que
  os valores variam por modelo/circuito).
- Se `HH2zoneMUX()` se comporta exatamente como esperado num chimbal físico
  2 zonas real (a lib documenta isso mais pra prato do que pra chimbal).
