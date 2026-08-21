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

`field` aceito em `set_global`:

| `field` | Tipo de `value` | Faixa/limite |
|---|---|---|
| `midi_channel` | número | `1-16` |
| `midi_output` | número | `0` USB, `1` BLE, `2` USB+BLE — sem MIDI DIN, o hardware não tem esse circuito (ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)) |
| `brightness` | número | `10-100` (%, controla o brilho da tela via PWM) |

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
| `rim_sensitivity` | número | `0-100` | `ack` |
| `rim_threshold` | número | `0-100` | `ack` |
| `note` | número | `0-127` | `ack` |
| `note_rim` | número | `0-127` | `ack` |
| `note_cup` | número | `0-127` | `ack` |
| `label` | string | até 19 caracteres | `pad_config` |
| `pad_type` | número | `0-7` (ver tabela em [05-tipos-de-sensor.md](05-tipos-de-sensor.md)) | `pad_config` do próprio pad **e** do pad seguinte (pode ter mudado de status) |
| `hihat_pedal_channel` | número | índice de outro pad (`6`/`7`), ou `-1` pra remover o link | `pad_config` |

Todos os campos exigem que o pad seja `primary` (`error` com
`channel_consumed` caso contrário). `pad_type`/`hihat_pedal_channel` e
`label` respondem com o `pad_config` inteiro (mais direto o app já receber o
estado recalculado) em vez de `ack`.

## Eventos/respostas (módulo → app)

Cada linha enviada pelo módulo é um objeto com um campo `type`.

| `type` | Campos | Quando é enviado |
|---|---|---|
| `pong` | — | Resposta a `ping`. |
| `device_info` | `pads`, `muxes`, `midi_channel`, `midi_output`, `brightness`, `ble_connected`, `firmware_phase` | Resposta a `get_device_info`, `set_global`, `save_all` e `restore_all`. `ble_connected` indica se há um dispositivo pareado via BLE-MIDI naquele momento (ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)). `midi_output` controla se o MIDI sai por USB, BLE ou os dois — antes (Fase H) saía sempre pelos dois simultaneamente; agora é configurável via `set_global`. |
| `pad_config` | Ver abaixo | Resposta a `get_pad`/`get_all_pads`, e a `set_pad` bem-sucedido em `label`/`pad_type`/`hihat_pedal_channel`. |
| `hit` | `pad`, `zone`, `note`, `velocity` | Sempre que um pad é atingido (telemetria em tempo real). `zone` varia por tipo: `"bow"`, `"head"`, `"rim"`, `"edge"`, `"cup"`, `"open"`, `"closed"`, `"pedal"` ou `"choke"` — ver [05-tipos-de-sensor.md](05-tipos-de-sensor.md). |
| `ack` | `cmd`, `pad`, `field`, `value` | Confirmação de um `set_pad` com campo numérico simples. |
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
  "rim_sensitivity": 20,
  "rim_threshold": 3,
  "note": 39,
  "note_rim": 39,
  "note_cup": 40,
  "hihat_pedal_channel": -1
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

Evento de hit num prato 3 zonas (zona "cup"):
```json
{"type":"hit","pad":5,"zone":"cup","note":40,"velocity":112}
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
