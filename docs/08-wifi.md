# Wi-Fi: ConfigTool direto da placa

O ESP32-S3 tem Wi-Fi. A ideia é usar isso para abrir o ConfigTool **sem cabo
e sem instalar nada**, em qualquer navegador, inclusive no celular. Pelo
USB, o ConfigTool só funciona no Chrome/Edge de computador (Web Serial).

## Fases

| Fase | O quê | Estado |
|---|---|---|
| 1 | Rede própria do módulo, ligada pelo menu ou pelo app; ConfigTool servido pela placa; conexão do app por WebSocket | **feito** (2026-10-03), falta testar com celular |
| 2 | Conectar o módulo no Wi-Fi de casa (configurado pelo app) + `drumcore.local`; se não achar a rede, volta pra rede própria | ideia |
| 3 | Atualizar o firmware pelo Wi-Fi (a tabela de partições `default_16MB.csv` já tem 2 slots de app) | ideia |
| — | MIDI pelo Wi-Fi (RTP-MIDI), pra tocar sem cabo | só depois de medir a latência |

## Como usar (fase 1)

1. No módulo: **GLOBAL > WI-FI**, clique. A linha passa para `LIGADO` e
   a tela mostra a **rede** (`DrumCore-XXXX`, os 4 últimos dígitos do
   endereço MAC) e a **senha** (8 dígitos).
   Também dá para ligar pelo ConfigTool no USB, na aba Global, seção Wi-Fi.
2. No celular ou computador: conecte nessa rede.
3. Abra **http://drumcore.local**. Se não abrir (comum no Android, que não
   resolve bem endereços `.local`), use **http://192.168.4.1**.
4. O app conecta sozinho. O chip do topo mostra `Conectado · Wi-Fi`.

O Wi-Fi **começa desligado a cada vez que o módulo liga**. Isso é de
propósito: o rádio divide o processador com a leitura dos pads, e o padrão
seguro para tocar é sem Wi-Fi.

A rede fica sem internet. Alguns celulares avisam isso e oferecem trocar de
rede: escolha continuar conectado.

## Como funciona

- **Firmware** (`firmware/src/wifi_portal.cpp`): ponto de acesso (canal 6,
  até 4 aparelhos), mDNS `drumcore`, servidor web assíncrono
  (`ESP32Async/ESPAsyncWebServer` + `AsyncTCP`, roda numa task própria, fora
  do `loop()` que lê os pads) e WebSocket em `/ws`.
- **Mesmo protocolo da serial** ([04-protocolo-serial.md](04-protocolo-serial.md)):
  - tudo que o módulo manda por `sendJsonLine()` vai para a serial e também
    para os clientes do WebSocket;
  - os comandos que chegam pelo WebSocket entram numa fila e são executados
    no `loop()`, pelo mesmo `handleSerialCommand()`, até 4 por volta.
  - Comando novo: `set_wifi`. O `device_info` ganhou o objeto `wifi`.
- **Senha**: 8 dígitos sorteados no primeiro uso e guardados na memória
  (NVS, namespace `wifi`). Cada placa tem a sua; ela não muda depois.
- **App embutido**: no build do firmware, `firmware/embed_webapp.py`
  compacta (gzip) o build do ConfigTool (`web-app/dist`) para dentro do
  firmware (`include/webapp_files.h`, gerado, fora do git). Entra hoje com
  ~120 kB. Ficam de fora os arquivos do gravador de firmware, que não
  serve pelo Wi-Fi. Se `web-app/dist` não existir, o firmware compila do
  mesmo jeito, com uma página que aponta para o site. Para embutir:
  `cd web-app && npm run build`, depois compilar o firmware. A CI de
  release faz os dois.
- **App aberto pela placa**: o `index.html` servido pela placa tem
  `<meta name="drumcore-hosted">` (`web-app/src/hosted.ts`). Com isso, o app:
  - usa o WebSocket (`wsDrumCore.ts`) em vez do Web Serial;
  - conecta sozinho e volta para a tela "Conectar" se a conexão cair;
  - esconde a aba Firmware e os links do site.
- **Por que o site no GitHub Pages não conecta pelo Wi-Fi**: ele é `https`,
  e o navegador bloqueia uma página `https` abrindo `ws://` para a rede
  local. Por isso o app do Wi-Fi é a cópia gravada na placa, que fica
  sempre na mesma versão do firmware.

## Cuidados

- **Latência** (medido 2026-10-03, 29 canais em uso, sem aparelho conectado):
  - Wi-Fi desligado: média 1,93 ms por volta do loop, pico 1,97 ms.
  - Wi-Fi ligado: média 1,98 ms, picos de 2,4 a 3,2 ms.
  - Falta medir **com um app conectado**, recebendo os eventos de golpe.
- **BLE-MIDI + Wi-Fi**: os dois dividem o mesmo rádio. O ESP32-S3 suporta
  os dois juntos, mas a latência do BLE-MIDI pode subir com o Wi-Fi ligado.
- **Pinos dos MUX** (GPIO1 e GPIO2) estão no ADC1, que funciona com o Wi-Fi
  ligado. O ADC2 não pode ser usado com Wi-Fi: nunca mover leitura de pad
  para ele.
- **Mais de um módulo** na mesma rede (fase 2): o nome `drumcore.local`
  vai precisar de sufixo.
- **Web MIDI** (aba MIDI Monitor) exige página segura (`https`). Pela
  placa (`http`), o monitor não funciona. O resto do app funciona.
