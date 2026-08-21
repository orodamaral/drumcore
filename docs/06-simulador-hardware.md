# Simulador do módulo (LCD + encoders)

Aba dentro do app desktop (`desktop-app/src/renderer/src/components/HardwareSimulator.tsx`)
que recria visualmente a tela TFT (128x128, ST7735) e a navegação pelos 2
encoders rotativos — pra testar/validar a UX da tela física **antes** do
hardware (tela + encoders) estar montado. Aberta pela aba "Simulador do
módulo" no topo do app.

Reescrito do zero na Fase J (2026-08-21) pra acompanhar o redesenho completo
da navegação do firmware — ver [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)
e `design/SPEC.md`. A versão anterior (Fase C/I: 1 encoder pra pad, 1 pra
item, tela única com idle-timeout pro grid) não existe mais nem no firmware
nem aqui.

## Por que existe

O hardware (tela TFT, encoders) ainda não chegou. Em vez de esperar pra
poder ver/ajustar como a navegação e os textos ficam na tela pequena, esse
simulador reproduz a mesma máquina de estados de `design/SPEC.md` (5 páginas
em runtime — BOOT não entra, já que só dura a inicialização), rodando em
TypeScript/React dentro do app desktop.

## Como usar

- **Girar os encoders**: passe o mouse sobre o círculo do encoder e use a
  roda do scroll (pra cima = giro "positivo", pra baixo = "negativo").
- **Clicar um encoder**: clique rápido (solta antes de 600ms) no círculo.
- **Manter pressionado (hold)**: clique e mantenha o botão do mouse
  pressionado por 600ms sobre o encoder — dispara o gesto de "hold" (mesmo
  limiar do firmware).
- **Teclado**: `↑`/`↓` = girar ENC1, `←`/`→` = girar ENC2, `Enter` = clique
  ENC1, `Espaço` = clique ENC2. (O teclado não simula hold, só clique.)
- **"Reiniciar dados de exemplo"**: volta os 32 pads simulados e as
  configurações globais pro estado inicial.

## Páginas e controles replicados do firmware

- **LIVE**: grade 8x4 com os 32 pads, flash ao "bater" (simulado
  aleatoriamente a cada 1.2s, só pra exercitar a animação).
- **PADS**: lista rolável dos 32 pads (janela de 8 linhas), com o tipo de
  sensor abreviado e a nota MIDI de cada um.
- **PAD_EDIT**: lista de campos do pad em foco, igual à fonte usada no
  editor da aba "Pads" (`PAD_TYPE_META` em `protocol.ts`) — os campos
  mostrados por tipo de sensor são consistentes entre as duas telas. O tipo
  de sensor em si é só exibido (não editável nesse simulador simplificado —
  trocar o tipo tem efeitos colaterais no consumo de canais que não valia a
  pena replicar aqui).
- **SIGNAL**: mostra um envelope **ilustrativo** (o navegador não tem ADC
  real pra ler) — só pra validar o layout da tela (eixos, VEL/PEAK,
  SCAN/MASK/THR), não os valores em si.
- **GLOBAL**: canal MIDI, saída (USB/BLE/USB+BLE), brilho, e as ações
  SALVAR/RESTAURAR (mostram o mesmo toast "SALVO"/"RESTAURADO" da tela real,
  900ms). Sem "KIT" — não implementado, ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).
- **ENC1** (página/pad em foco): girar troca de página (LIVE↔PADS↔GLOBAL,
  circular) ou de pad em foco (dentro de PAD_EDIT/SIGNAL); clique alterna
  PAD_EDIT↔SIGNAL; hold volta pra LIVE de qualquer lugar.
- **ENC2** (navegação/valor): girar navega a lista ou edita o valor
  selecionado; clique entra no item / alterna nav↔edição; hold volta um
  nível (PAD_EDIT→PADS, SIGNAL→PAD_EDIT).
- **Aceleração**: girar rápido (menos de 125ms entre passos) usa passo 5 em
  vez de 1, em campos com faixa grande — mesma regra do firmware
  (`>8 detents/s`).
- **Persistência RAM-only**: editar em PAD_EDIT ou GLOBAL só muda o estado
  local do simulador — "SALVAR"/"RESTAURAR" são só cosméticos aqui (não há
  EEPROM de verdade no navegador), mas servem pra validar o fluxo/toast.
- Canais consumidos por um pad de 2 canais mostram "Canal ocupado" em
  PAD_EDIT, sem lista de campos — mesmo texto usado no firmware.

## O que é só aproximação (não pixel-perfeito com o hardware real)

- **Dataset local, independente**: os 32 pads do simulador são gerados
  localmente (`createPreviewPads()`), com uma mistura de tipos só pra dar um
  "tour" pelas telas possíveis. **Não é sincronizado** com o modo demo da
  aba "Pads" — são dois conjuntos de dados separados, de propósito (o
  simulador é uma ferramenta de preview de UI, não precisa compartilhar
  estado com o editor).
- **Fonte e proporções da tela**: a Adafruit GFX (lib usada no firmware pra
  desenhar na TFT) tem uma fonte pixelada própria com proporções específicas
  por "text size". Aqui usamos a fonte Silkscreen (Google Fonts, pixelada,
  mas não é a mesma fonte 5x7 da Adafruit GFX) — visualmente parecido, não
  é uma réplica exata de pixel.
- **Sem debounce/tempo real de encoder mecânico**: no hardware real, girar
  rápido um encoder gera múltiplos passos que o firmware processa um por
  `loop()`; aqui cada "tick" de scroll do mouse é um passo direto.
- **Envelope da tela SIGNAL é sintético**: gerado por uma função local
  (`fakeEnvelope()`), não vem de nenhuma leitura real — o navegador não tem
  acesso a um ADC. Serve só pra validar o layout, não os valores.
- **Hits simulados na tela LIVE**: o simulador dispara um hit aleatório num
  pad primário a cada 1.2s só pra exercitar o flash — no firmware real isso
  vem de sensing de verdade, sem intervalo fixo.
- **Troca de tipo de sensor**: não é editável neste simulador (ver acima) —
  é editável de verdade na aba "Pads" (fala com o firmware real ou o modo
  demo via protocolo serial).

## Quando isso deixa de ser necessário

Assim que o hardware (tela + encoders) estiver montado e o firmware
carregado na placa, o comportamento real deve ser comparado com esse
simulador — qualquer diferença encontrada é um bom sinal de onde ajustar o
firmware (ou o simulador, se a diferença for só cosmética/aceitável).
