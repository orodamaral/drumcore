# Wi-Fi: ConfigTool direto da placa

O ESP32-S3 tem Wi-Fi. A ideia é usar isso para abrir o ConfigTool **sem cabo
e sem instalar nada**, em qualquer navegador, inclusive no celular. Pelo
USB, o ConfigTool só funciona no Chrome/Edge de computador (Web Serial).

## Fases

| Fase | O quê | Estado |
|---|---|---|
| 1 | Rede própria do módulo, ligada pelo menu ou pelo app; ConfigTool servido pela placa; conexão do app por WebSocket | **feito** (2026-10-03), falta testar com celular |
| 2 | Conectar o módulo no Wi-Fi de casa (configurado pelo app) + `drumcore.local`; se não achar a rede, volta pra rede própria; "ligar ao iniciar" | **feito** (2026-10-03), falta testar com a rede de casa |
| 3 | Atualizar o firmware pelo Wi-Fi, com confirmação no módulo | **feito** (2026-10-03), testado de ponta a ponta pela rede de casa |
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

## Rede de casa (fase 2)

No ConfigTool, aba **Global > Wi-Fi > Rede de casa**:

1. Com o Wi-Fi ligado, clique em **Procurar redes** e escolha a sua, ou
   digite o nome.
2. Digite a senha e clique em **Salvar e conectar**.
3. A rede própria do módulo continua no ar enquanto ele tenta. Quando
   conecta, o app mostra o endereço na rede de casa, e a rede própria
   desliga 30 s depois. Volte o celular para a rede de casa e abra
   **http://drumcore.local** (ou o IP que o app e a tela mostram).

Daí em diante, ligar o Wi-Fi já entra na rede de casa. Marque **Ligar o
Wi-Fi sempre que o módulo ligar** para não precisar ligar pelo menu.

Se a rede de casa não conectar em 15 s (senha errada, roteador desligado,
fora de alcance), o módulo **para de tentar** e põe a rede própria no ar
para você corrigir. Ele para porque cada tentativa troca o canal do rádio e
derruba quem está na rede própria. Para tentar de novo: **Tentar de novo**
no app, ou desligar e ligar o Wi-Fi.

A tela **GLOBAL** mostra o estado na linha WI-FI:

| Linha WI-FI | Significa | Linhas de baixo |
|---|---|---|
| `DESLIG.` | Wi-Fi desligado | — |
| `LIGADO` | só a rede própria | rede, senha, endereço |
| `CONECT...` | tentando a rede de casa | rede de casa / "CONECTANDO..." |
| `CASA` | na rede de casa | rede de casa, IP, `drumcore.local` |
| `FALHOU` | a rede de casa não conectou, rede própria no ar | rede, senha, endereço |

A senha da rede de casa fica só no módulo (NVS); nunca volta para o app.
O ESP32-S3 só conecta em redes de **2,4 GHz**. Se o roteador tiver as
duas faixas com nomes diferentes, escolha a de 2,4 GHz.

## Atualizar o firmware pelo Wi-Fi (fase 3)

Com o ConfigTool aberto pela placa, a aba **Firmware** atualiza pela rede:

- **Atualizar para fw-v…**: baixa a versão mais recente do GitHub. Precisa
  de internet no aparelho, o que na prática significa o módulo na rede de
  casa.
- **Escolher arquivo .bin…**: funciona também na rede própria, sem
  internet. Serve o `drumcore-firmware-….bin` das releases (o mesmo da
  gravação por USB) ou o `firmware.bin` de um build do PlatformIO.

Por segurança, **o módulo pede confirmação**: a tela pergunta e só um clique
no encoder libera o envio. Segurar cancela. Sem clique em 1 min, o pedido
expira. Depois do clique, o envio tem que começar em 2 min. Assim, ninguém na
mesma rede troca o firmware sem alguém mexer no módulo.

O envio leva ~10 s na rede de casa (1,6 MB). O módulo grava, confere o
arquivo inteiro, reinicia sozinho e volta com o Wi-Fi ligado. O app
reconecta sozinho e mostra a versão nova. Se algo der errado no meio, o
firmware atual continua.

Como funciona por dentro:

- **Partições** (`default_16MB.csv`): `app0` (0x10000) e `app1`
  (0x650000), mais o seletor `otadata` (0xe000). A atualização grava na
  partição que não está em uso e troca o seletor no fim (`Update` do core,
  que confere o hash do app antes de trocar).
- **Binário**: a release publica um binário completo (bootloader, tabela,
  seletor e app). O navegador recorta o app a partir de `app_offset`
  (0x10000, gravado no `manifest.json` pela CI) e manda só ele
  (`web-app/src/otaUpdate.ts`). Antes de gravar, o firmware confere o
  começo do arquivo (`0xE9`) e o modelo do chip (ESP32-S3).
- **Gravação por USB depois de uma atualização pelo Wi-Fi**: o binário
  completo inclui o seletor em 0xe000 (`boot_app0.bin`), então a gravação
  por USB sempre volta para `app0`. Conferido na placa.
- `POST /update` sem o clique no módulo é recusado (`not_armed`) sem
  mudar nada na tela.
- **Releases antigas**: as anteriores ao Wi-Fi (até fw-v0.0.10-test) não têm
  `app_offset`. O app avisa que, instaladas pelo Wi-Fi, deixam o módulo sem
  Wi-Fi (volta pelo USB).
- **Sem retorno automático**: se um firmware novo não iniciar, a placa não
  volta sozinha para o anterior. A saída é gravar pelo USB, que sempre
  funciona.

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
- **Mais de um módulo** na mesma rede de casa: os dois respondem como
  `drumcore.local`. Ainda não tratado: use o IP de cada um.
- **Economia de energia na rede de casa**: o modo de economia do rádio fica
  ligado, porque o ESP32 exige isso com o Bluetooth (BLE-MIDI) ativo. O app
  pode responder um pouco mais devagar na rede de casa do que na rede
  própria; a leitura dos pads e o MIDI não são afetados.
- **Web MIDI** (aba MIDI Monitor) exige página segura (`https`). Pela
  placa (`http`), o monitor não funciona. O resto do app funciona.
