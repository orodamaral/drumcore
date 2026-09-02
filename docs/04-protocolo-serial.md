# Protocolo Serial (módulo ↔ app desktop)

Contrato de comunicação entre o firmware (ESP32-S3, via USB-CDC — a mesma
porta serial já usada pra debug desde a Fase B) e a interface desktop.

## Formato

**NDJSON** (um objeto JSON por linha, terminado em `\n`). Todo o tráfego
Serial usa esse formato — inclusive os eventos de "pad atingido", que antes
eram texto livre (`Serial.print`) e passaram a ser JSON também, pra manter o
stream inteiro consistente e fácil de parsear do lado do app (sem precisar
filtrar linhas de debug misturadas com linhas de protocolo).

Baud rate: 115200 (definido em `firmware/platformio.ini`).

## Canais "primary" vs. canais consumidos

Desde a Fase G (tipos de sensor — ver
[05-tipos-de-sensor.md](05-tipos-de-sensor.md)), nem todo canal (0-31) é um
pad independente: tipos de 2 canais (aro, prato 2/3 zonas, chimbal 2 zonas)
consomem o canal seguinte. Um `pad_config` sempre tem um campo `primary`:

- `"primary": true` — pad independente, com todos os campos de configuração
  (ver tabela abaixo).
- `"primary": false` — canal consumido pelo pad anterior; só tem `pad` e
  `consumed_by` (índice do pad que o está usando). Não aceita `set_pad`
  (retorna `error` com `channel_consumed`).

## Comandos (app → módulo)

Cada linha enviada pelo app é um objeto com um campo `cmd`.

| `cmd` | Campos extras | Descrição |
|---|---|---|
| `ping` | — | Testa a conexão. Resposta: `pong`. |
| `get_device_info` | — | Informações gerais do módulo. Resposta: `device_info`. |
| `get_pad` | `pad` (0-31) | Configuração de um pad. Resposta: `pad_config`. |
| `get_all_pads` | — | Configuração de todos os 32 pads (32 respostas `pad_config` em sequência). |
| `set_pad` | `pad` (0-31), `field`, `value` | Altera um parâmetro de um pad, aplica imediatamente e persiste em EEPROM. Resposta varia por campo (ver tabela) ou `error`. |
| `set_global` | `field`, `value` | Altera uma configuração global (ver tabela abaixo), aplica imediatamente e persiste em EEPROM. Resposta: `ack` + `device_info`. |
| `save_all` | — | Grava toda a configuração atual (32 pads + globais) na EEPROM. Resposta: `log` + `device_info`. Esse comando existe principalmente pro caminho dos encoders/tela (Fase J — ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)), onde a edição só fica em RAM até `GLOBAL > SALVAR`; pelo protocolo serial ele é redundante na prática, já que `set_pad`/`set_global` já persistem a cada mudança. |
| `restore_all` | — | Descarta qualquer mudança em RAM e recarrega os 32 pads + globais da EEPROM. Resposta: `pad_config` × 32 + `log` + `device_info`. |
| `start_autotune` | `pad` (0-31) | Inicia o assistente de auto-calibração (Fase O) pra esse pad — ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md). `error` (`invalid_pad`) se o pad não existir/não for `primary`, ou (`channel_disabled`) se o canal estiver desligado (`enabled: false`, Fase N). Resposta: uma série de `autotune_status` conforme o assistente avança (não é só uma resposta única — ver abaixo). |
| `cancel_autotune` | — | Cancela o assistente em qualquer fase (mesmo no meio da coleta de golpes). Resposta: `autotune_status` com `"state": "idle"`. |
| `apply_autotune` | — | Aplica o resultado calculado (`sensitivity`/`threshold`/`scan_time`/`mask_time`) no pad e persiste em EEPROM. Só funciona depois de um `autotune_status` com `"state": "done"` — `error` (`not_ready`) caso contrário. Resposta: `autotune_status` (`idle`) + `pad_config` com os novos valores. |
| `enc_input` | `enc` (1 ou 2), `action` (`rotate`\|`click`\|`hold`), `delta` (só em `rotate`, padrão `1`) | Encoder virtual — Fase Q, criado pra navegar/testar a tela do módulo pelo app desktop antes dos encoders físicos estarem conectados. Chama exatamente o mesmo handler do encoder físico correspondente (`onEnc1Rotate`/`onEnc2Click`/etc, ver `firmware/src/main.cpp`), então tem efeito idêntico ao giro/clique/hold real. Sem resposta dedicada — o resultado aparece na tela física do módulo, que é a única fonte da verdade de navegação (o app não espelha `currentPage`/item selecionado/etc). `error` (`invalid_enc`, `invalid_action` ou `invalid_delta`) em caso de parâmetro inválido. |

`field` aceito em `set_global`:

| `field` | Tipo de `value` | Faixa/limite |
|---|---|---|
| `midi_channel` | número | `1-16` |
| `midi_output` | número | `0` USB, `1` BLE, `2` USB+BLE — sem MIDI DIN, o hardware não tem esse circuito (ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)) |

`field` aceito em `set_pad` (nomes do protocolo, não os nomes internos da
lib — ver [05-tipos-de-sensor.md](05-tipos-de-sensor.md) pro que cada campo
significa em cada tipo de pad):

| `field` | Tipo de `value` | Faixa/limite | Resposta em caso de sucesso |
|---|---|---|---|
| `sensitivity` | número | `0-100` | `ack` |
| `threshold` | número | `0-100` | `ack` |
| `scan_time` | número | `0-100` | `ack` |
| `mask_time` | número | `0-100` | `ack` |
| `curve_type` | número | `0-4` | `ack` |
| `retrigger` | número | `0-100` (Fase P) | `ack` |
| `gain` | número | `10-200` (0.10x-2.00x, 100 = neutro) (Fase P) | `ack` |
| `xtalk` | número | `0-100` (Fase P) | `ack` |
| `xtalk_group` | número | `0-4` (`0` = nenhum grupo) (Fase P) | `ack` |
| `rim_sensitivity` | número | `0-100` | `ack` |
| `rim_threshold` | número | `0-100` | `ack` |
| `note` | número | `0-127` | `ack` |
| `note_rim` | número | `0-127` | `ack` |
| `note_cup` | número | `0-127` | `ack` |
| `label` | string | até 19 caracteres | `pad_config` |
| `pad_type` | número | `0-8` (ver tabela em [05-tipos-de-sensor.md](05-tipos-de-sensor.md)) | `pad_config` do próprio pad **e** do pad seguinte (pode ter mudado de status) |
| `hihat_pedal_channel` | número | índice de outro pad (`6`/`7`), ou `-1` pra remover o link | `pad_config` |
| `enabled` | número | `0` ou `1` | `pad_config` |
| `hihat_invert` | número | `0` ou `1` (só pad_type `6`/`7`, Fase X) | `pad_config` |

Todos os campos exigem que o pad seja `primary` (`error` com
`channel_consumed` caso contrário). `pad_type`/`hihat_pedal_channel`/
`enabled`/`hihat_invert` e `label` respondem com o `pad_config` inteiro
(mais direto o app já receber o estado recalculado) em vez de `ack`.

`retrigger`/`gain`/`xtalk`/`xtalk_group` (Fase P, ver
[01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md), inspirados no
microDRUM/nanoDRUM): `retrigger` afrouxa o `mask_time` pra pancadas bem mais
fortes que a anterior (rufos/rolls rápidos); `gain` recalibra a amplitude
lida do sensor antes do threshold (útil pra piezos com saída muito
forte/fraca); `xtalk`/`xtalk_group` suprimem um hit se outro pad do mesmo
grupo bateu bem mais forte no mesmo instante (vibração mecânica entre pads
montados juntos, ou crosstalk elétrico entre canais — inclusive os dois
CD4067 que compartilham o barramento S0-S3, ver
[02-hardware.md](02-hardware.md)). Nenhum dos 4 tem efeito quando no valor
neutro (`0` pros 3 primeiros, `100` pro `gain`).

`enabled` (Fase N, ver
[01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)): `false`
desliga o canal por completo — o firmware não roda sensing nem emite `hit`
pra ele, mesmo que o pino ADC correspondente esteja fisicamente flutuando
(sem sensor conectado) e captando ruído. Não afeta `primary`/
`consumed_by`, que continuam decididos só por `pad_type` — um canal
desabilitado ainda "existe" no espaço de 32 canais, só não é sensoreado.

`hihat_invert` (Fase X, controlador de pedal — `pad_type` `6`/`7` — ver
[01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)): alguns
sensores de posição mandam o sinal invertido (pedal fechado = CC baixo,
quando deveria ser alto, ou vice-versa). `true` inverte o CC final
(`127 - pedalCC`) — efeito imediato, não precisa recalibrar depois de
mudar (não mexe em `threshold`/`sensitivity`, só no valor que sai no MIDI
CC). Ignorado nos outros tipos de pad.

## Eventos/respostas (módulo → app)

Cada linha enviada pelo módulo é um objeto com um campo `type`.

| `type` | Campos | Quando é enviado |
|---|---|---|
| `pong` | — | Resposta a `ping`. |
| `device_info` | `pads`, `muxes`, `midi_channel`, `midi_output`, `ble_connected`, `firmware_phase` | Resposta a `get_device_info`, `set_global`, `save_all` e `restore_all`. `ble_connected` indica se há um dispositivo pareado via BLE-MIDI naquele momento (ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)). `midi_output` controla se o MIDI sai por USB, BLE ou os dois — antes (Fase H) saía sempre pelos dois simultaneamente; agora é configurável via `set_global`. |
| `pad_config` | Ver abaixo | Resposta a `get_pad`/`get_all_pads`, e a `set_pad` bem-sucedido em `label`/`pad_type`/`hihat_pedal_channel`/`enabled`/`hihat_invert`, e a `apply_autotune`. |
| `hit` | `pad`, `zone`, `note`, `velocity` | Sempre que um pad é atingido (telemetria em tempo real). `zone` varia por tipo: `"bow"`, `"head"`, `"rim"`, `"edge"`, `"cup"`, `"open"`, `"closed"`, `"pedal"` ou `"choke"` — ver [05-tipos-de-sensor.md](05-tipos-de-sensor.md). |
| `ack` | `cmd`, `pad`, `field`, `value` | Confirmação de um `set_pad` com campo numérico simples. |
| `autotune_status` | `pad`, `state`, `hit_count`, `hit_target`, e (`state == "collecting"`) `tier`/`tier_index`/`tier_count`/`zone`? **ou** `phase`/`hold_elapsed_ms`/`hold_target_ms` (pedal, ver abaixo), e (`state == "done"`) `sensitivity`/`threshold`/`scan_time`/`mask_time`/`rim_sensitivity`?/`rim_threshold`?/`mode`?, ou (`state == "aborted"`) `reason` | Progresso do assistente de auto-calibração (Fase O, 3 níveis de força desde a Fase T, 2ª/3ª zona pra pads de mais de 1 canal desde a Fase U/V, fluxo de posição contínua pro controlador de pedal desde a Fase X) — emitido a cada mudança de fase relevante, não só em resposta a comando (dá pra acompanhar em tempo real: contagem regressiva do ruído, golpes capturados, etc). `state`: `"idle"` (parado/cancelado/aplicado), `"noise"` (medindo ruído de fundo — não acontece pro pedal, ver abaixo), `"collecting"` (esperando/processando golpes, ou segurando o pedal numa posição), `"done"` (resultado calculado, esperando `apply_autotune`/`cancel_autotune`), `"aborted"` (timeout de 15s sem pancada, ou canal desligado — ver `reason`: `"timeout"` ou `"channel_disabled"`). Em `"collecting"`, `hit_count`/`hit_target` contam as batidas *da zona/nível atual* (0-8, não um total acumulado); `tier` indica qual nível está em coleta agora — `"weak"`, `"medium"` ou `"strong"` — e `tier_index`/`tier_count` (ex: `2`/`3`) dão o progresso entre níveis. Cada zona pede 8 golpes fracos, depois 8 médios, depois 8 fortes (24 no total por zona) — ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md). `zone` só aparece quando o pad calibrado tem mais de 1 canal, e reaproveita o MESMO vocabulário do evento `hit` (não é um nome genérico): `"head"`/`"rim"` pra `pad_type` 1 (`PAD_DUAL`, 1 rodada extra); `"bow"`/`"edge"`/`"cup"` pra `pad_type` 5 (`PAD_CYMBAL_3ZONE`, 2 rodadas extras); `"head"`/`"edge"`/`"rim"` pra `pad_type` 8 (`PAD_SNARE_3ZONE`, 2 rodadas extras) — a 1ª zona de cada lista já aparece na 1ª rodada (não só nas extras). O resultado final em `"done"` ganha `rim_sensitivity`/`rim_threshold` também nesses casos (mesmos campos do `pad_config`, reaproveitados com significado diferente por `pad_type` — ver tabela de campos por tipo em [05-tipos-de-sensor.md](05-tipos-de-sensor.md)). **Controlador de pedal** (`pad_type` 6/7, Fase X): fluxo totalmente diferente — sensor de posição contínua, sem "golpes"/níveis. Pula direto pra `"collecting"` com `phase` (`"hh_open"` = segure o pedal solto, `"hh_closed"` = pressione até o fim) e `hold_elapsed_ms`/`hold_target_ms` (progresso dentro dos 3s de cada posição — `hit_count`/`hit_target`/`tier`/`zone` não se aplicam). O resultado em `"done"` ganha `mode: "hihat_range"`, avisando que `sensitivity`/`threshold` são o teto/piso de posição (pedal fechado/aberto), não pico de pancada. |
| `error` | `cmd`, `message` | Comando inválido, campo desconhecido, valor fora da faixa, canal consumido, JSON malformado, etc. |
| `log` | `message` | Mensagens informativas de boot/diagnóstico (antes eram `Serial.println` livres), e também pareamento/desconexão do BLE-MIDI. |

### `pad_config` — canal consumido (`primary: false`)

```json
{"type":"pad_config","pad":4,"primary":false,"consumed_by":3}
```

### `pad_config` — pad independente (`primary: true`)

```json
{
  "type": "pad_config",
  "pad": 3,
  "primary": true,
  "pad_type": 0,
  "uses_second_channel": false,
  "name": "4 - Caixa",
  "label": "Caixa",
  "sensitivity": 100,
  "threshold": 10,
  "scan_time": 10,
  "mask_time": 30,
  "curve_type": 0,
  "retrigger": 0,
  "gain": 100,
  "xtalk": 0,
  "xtalk_group": 0,
  "rim_sensitivity": 20,
  "rim_threshold": 3,
  "note": 39,
  "note_rim": 39,
  "note_cup": 40,
  "hihat_pedal_channel": -1,
  "enabled": true,
  "hihat_invert": false
}
```

`name` é o nome pronto pra exibir (`"N - label"` ou `"Pad N"` sem label);
`label` é o texto livre "crú", útil pra preencher um campo de edição sem o
prefixo do número (ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)).

## Exemplos

Alterar a sensibilidade do pad 3:
```json
{"cmd":"set_pad","pad":3,"field":"sensitivity","value":80}
```
Resposta:
```json
{"type":"ack","cmd":"set_pad","pad":3,"field":"sensitivity","value":80}
```

Renomear o pad 3 (índice 0-based → exibido como pad 4):
```json
{"cmd":"set_pad","pad":3,"field":"label","value":"Caixa"}
```

Transformar o pad 5 num prato de 2 zonas (consome também o pad 6):
```json
{"cmd":"set_pad","pad":5,"field":"pad_type","value":3}
```
Respostas (2 linhas — o próprio pad e o seguinte, que passa a `primary:false`):
```json
{"type":"pad_config","pad":5,"primary":true,"pad_type":3, ...}
{"type":"pad_config","pad":6,"primary":false,"consumed_by":5}
```

Linkar o chimbal (pad 10, tipo 2 ou 4) ao pedal (pad 12, tipo 6 ou 7):
```json
{"cmd":"set_pad","pad":10,"field":"hihat_pedal_channel","value":12}
```

Girar o ENC2 um passo pra frente (ex: navegar a lista de pads):
```json
{"cmd":"enc_input","enc":2,"action":"rotate","delta":1}
```
Clicar o ENC1 (ex: entrar em SIGNAL a partir de PAD_EDIT):
```json
{"cmd":"enc_input","enc":1,"action":"click"}
```

Evento de hit num prato 3 zonas (zona "cup"):
```json
{"type":"hit","pad":5,"zone":"cup","note":40,"velocity":112}
```

Progresso do auto-tune no meio do nível médio (5º golpe de 8):
```json
{"type":"autotune_status","pad":3,"state":"collecting","tier":"medium","tier_index":2,"tier_count":3,"hit_count":5,"hit_target":8}
```

Auto-tune de um pad `PAD_DUAL` (`pad_type` 1) na rodada extra do aro, nível fraco (2º golpe):
```json
{"type":"autotune_status","pad":0,"state":"collecting","tier":"weak","tier_index":1,"tier_count":3,"zone":"rim","hit_count":2,"hit_target":8}
```
Resultado final desse mesmo pad (`rim_sensitivity`/`rim_threshold` só aparecem pra pads de mais de 1 canal):
```json
{"type":"autotune_status","pad":0,"state":"done","hit_count":8,"hit_target":8,"sensitivity":72,"threshold":8,"scan_time":12,"mask_time":38,"rim_sensitivity":45,"rim_threshold":6}
```

Auto-tune de um prato 3 zonas (`pad_type` 5) na rodada extra do cup, nível forte (6º golpe) — note que já foram 2 rodadas extras antes dessa (`edge`, depois `cup`):
```json
{"type":"autotune_status","pad":7,"state":"collecting","tier":"strong","tier_index":3,"tier_count":3,"zone":"cup","hit_count":6,"hit_target":8}
```

Auto-tune de um controlador de pedal (`pad_type` 6/7) segurando a posição fechada, 1.4s dos 3s:
```json
{"type":"autotune_status","pad":12,"state":"collecting","phase":"hh_closed","hold_elapsed_ms":1400,"hold_target_ms":3000,"hit_count":0,"hit_target":8}
```
Resultado final desse mesmo pedal (`mode: "hihat_range"` avisa que `sensitivity`/`threshold` são o teto/piso de posição, não pico de pancada):
```json
{"type":"autotune_status","pad":12,"state":"done","hit_count":0,"hit_target":8,"sensitivity":92,"threshold":8,"scan_time":10,"mask_time":30,"mode":"hihat_range"}
```

Invertendo o CC de um controlador de pedal (`pad_type` 6/7):
```json
{"cmd":"set_pad","pad":12,"field":"hihat_invert","value":1}
```

## Implementação

- **Firmware**: `firmware/src/main.cpp`, usando a lib `ArduinoJson`
  (`bblanchon/ArduinoJson`) pra serializar/parsear. Leitura de linha não-
  bloqueante (acumula caracteres até `\n`, sem travar o `loop()` — não
  podíamos usar algo como `Serial.readStringUntil()` com timeout, que
  pausaria o sensing/MIDI).
- **App desktop**: `desktop-app/`, processo principal Electron abre a porta
  serial (pacote `serialport`) e repassa as linhas pro renderer via IPC.

## Em aberto / não coberto ainda

- Sem SysEx/MIDI — a config é só via essa porta serial, não pelo cabo MIDI.
- Sem comando de "reset pad pros defaults" (só dá pra fazer isso apagando a
  flag de EEPROM, o que reseta *todos* os pads).
- Sem autenticação/validação de origem — qualquer software que abra a porta
  serial correta pode configurar o módulo. Aceitável pra um dispositivo
  local via USB, sem exposição de rede.
- Nada disso foi testado com hardware real ainda (ver
  [05-tipos-de-sensor.md](05-tipos-de-sensor.md), seção final).
