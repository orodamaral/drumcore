# Protocolo Serial (módulo ↔ app desktop)

Contrato de comunicação entre o firmware (ESP32-S3, via USB-CDC — a mesma
porta serial já usada pra debug desde a Fase B) e a interface desktop
(Fase E do projeto).

## Formato

**NDJSON** (um objeto JSON por linha, terminado em `\n`). Todo o tráfego
Serial usa esse formato — inclusive os eventos de "pad atingido", que antes
eram texto livre (`Serial.print`) e passaram a ser JSON também, pra manter o
stream inteiro consistente e fácil de parsear do lado do app (sem precisar
filtrar linhas de debug misturadas com linhas de protocolo).

Baud rate: 115200 (definido em `firmware/platformio.ini`).

## Comandos (app → módulo)

Cada linha enviada pelo app é um objeto com um campo `cmd`.

| `cmd` | Campos extras | Descrição |
|---|---|---|
| `ping` | — | Testa a conexão. Resposta: `pong`. |
| `get_device_info` | — | Informações gerais do módulo. Resposta: `device_info`. |
| `get_pad` | `pad` (0-31) | Configuração de um pad. Resposta: `pad_config`. |
| `get_all_pads` | — | Configuração de todos os 32 pads (32 respostas `pad_config` em sequência). |
| `set_pad` | `pad` (0-31), `field`, `value` | Altera um parâmetro de um pad, aplica imediatamente e persiste em EEPROM. Resposta: `ack` (campos numéricos) ou `pad_config` (campo `label`) — ou `error`. |

`field` aceito em `set_pad` (nomes do protocolo, não os nomes internos da
lib):

| `field` | Tipo de `value` | Faixa/limite | Resposta em caso de sucesso |
|---|---|---|---|
| `sensitivity` | número | `0-100` | `ack` |
| `threshold` | número | `0-100` | `ack` |
| `scan_time` | número | `0-100` | `ack` |
| `mask_time` | número | `0-100` | `ack` |
| `curve_type` | número | `0-4` | `ack` |
| `note` | número | `0-127` | `ack` |
| `label` | string | até 19 caracteres | `pad_config` |

As faixas dos campos numéricos são as mesmas que a lib já aplica no fluxo de
edição pelos encoders. **`label`** é o nome livre do pad (ex: `"Caixa"`) —
**só pode ser alterado via essa porta serial**, nunca pelos encoders/tela
física (ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)). O
número do pad nunca é editável: o nome exibido (campo `name` em
`pad_config`, e também o que aparece na tela TFT) é sempre `"N - label"`
(1-based) ou só `"Pad N"` enquanto nenhum `label` tiver sido definido.
`set_pad` com `field: "label"` responde com o `pad_config` já atualizado (em
vez de `ack`) porque é mais direto o app já receber o `name` recalculado.

## Eventos/respostas (módulo → app)

Cada linha enviada pelo módulo é um objeto com um campo `type`.

| `type` | Campos | Quando é enviado |
|---|---|---|
| `pong` | — | Resposta a `ping`. |
| `device_info` | `pads`, `muxes`, `midi_channel`, `firmware_phase` | Resposta a `get_device_info`. |
| `pad_config` | `pad`, `name`, `label`, `sensitivity`, `threshold`, `scan_time`, `mask_time`, `curve_type`, `note` | Resposta a `get_pad`/`get_all_pads`, e a um `set_pad` com `field: "label"` bem-sucedido. `name` é o nome pronto pra exibir (`"N - label"` ou `"Pad N"`); `label` é o texto livre "crú", útil pra preencher um campo de edição sem o prefixo do número. |
| `hit` | `pad`, `note`, `velocity` | Sempre que um pad é atingido (telemetria em tempo real — o app pode usar isso pra um "VU meter" por pad, por exemplo). |
| `ack` | `cmd`, `pad`, `field`, `value` | Confirmação de um `set_pad` aplicado com sucesso. |
| `error` | `cmd`, `message` | Comando inválido, campo desconhecido, valor fora da faixa, JSON malformado, etc. |
| `log` | `message` | Mensagens informativas de boot/diagnóstico (antes eram `Serial.println` livres). |

## Exemplos

Requisitar config do pad 3:
```json
{"cmd":"get_pad","pad":3}
```
Resposta (pad ainda sem nome customizado):
```json
{"type":"pad_config","pad":3,"name":"Pad 4","label":"","sensitivity":100,"threshold":10,"scan_time":10,"mask_time":30,"curve_type":0,"note":39}
```

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
Resposta:
```json
{"type":"pad_config","pad":3,"name":"4 - Caixa","label":"Caixa","sensitivity":100,"threshold":10,"scan_time":10,"mask_time":30,"curve_type":0,"note":39}
```

Evento de hit (não solicitado, chega sempre que o pad é tocado):
```json
{"type":"hit","pad":3,"note":39,"velocity":112}
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
