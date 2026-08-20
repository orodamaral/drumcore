# Simulador do módulo (LCD + encoders)

Aba dentro do app desktop (`desktop-app/src/renderer/src/components/HardwareSimulator.tsx`)
que recria visualmente a tela TFT (128x128, ST7735) e a navegação pelos 2
encoders rotativos — pra testar/validar a UX da tela física **antes** do
hardware (tela + encoders) estar montado. Aberta pela aba "Simulador do
módulo" no topo do app.

## Por que existe

O hardware (tela TFT, encoders) ainda não chegou. Em vez de esperar pra
poder ver/ajustar como a navegação e os textos ficam na tela pequena, esse
simulador reproduz a mesma lógica de estados que `handleConfigInputs()` +
`renderScreen()` implementam em `firmware/src/main.cpp`, só que em
TypeScript/React, rodando no navegador/Electron.

## Como usar

- **Girar os encoders**: passe o mouse sobre o círculo do encoder e use a
  roda do scroll (pra cima = giro "positivo", pra baixo = "negativo").
- **Clicar o encoder 1** (chave/EDIT): clique no círculo do encoder 1.
- **Teclado** (mais rápido pra testar): `↑`/`↓` = girar encoder 1, `←`/`→` =
  girar encoder 2, `Enter`/`Espaço` = clique do encoder 1.
- **"Reiniciar dados de exemplo"**: volta os 32 pads simulados pro dataset
  inicial (útil depois de bagunçar os valores testando).

## Comportamento replicado (fielmente) do firmware

- Fora do modo de edição: encoder 1 navega entre pads (0-31, cíclico),
  encoder 2 navega entre os parâmetros do pad atual.
- Clique no encoder 1 entra/sai do modo de edição (flash "EDITAR"/"OK",
  igual à tela real).
- Dentro do modo de edição: só o encoder 1 funciona (ajusta o valor do
  parâmetro atual, com wraparound no limite); o encoder 2 fica inerte —
  isso reproduz uma característica real da lib (`HelloDrumButton::readButton()`
  só processa NEXT/BACK quando **não** está em modo de edição).
- Canais consumidos por um pad de 2 canais mostram "Canal ocupado", sem
  item/valor — mesmo texto usado em `renderScreen()`.
- A lista de parâmetros por pad vem da mesma fonte usada no editor da aba
  "Configuração" (`PAD_TYPE_META` em `protocol.ts`) — os campos mostrados
  por tipo de sensor são consistentes entre as duas telas.

## O que é só aproximação (não pixel-perfeito com o hardware real)

- **Dataset local, independente**: os 32 pads do simulador são gerados
  localmente (`createPreviewPads()`), com uma mistura de tipos só pra dar um
  "tour" pelas telas possíveis (single, dual, prato 2/3 zonas, chimbal
  linkado a um pedal). **Não é sincronizado** com o modo demo da aba
  "Configuração" — são dois conjuntos de dados separados, de propósito
  (o simulador é uma ferramenta de preview de UI, não precisa compartilhar
  estado com o editor).
- **Fonte e proporções da tela**: a Adafruit GFX (lib usada no firmware pra
  desenhar na TFT) tem uma fonte pixelada própria com proporções específicas
  por "text size" (1/2/3). Aqui usamos uma fonte monoespaçada do sistema e
  tamanhos em `px` ajustados visualmente pra ficar parecido — não é uma
  réplica exata de pixel.
- **Sem debounce/tempo real de encoder mecânico**: no hardware real, girar
  rápido um encoder gera múltiplos passos que o firmware processa um por
  `loop()` (ver decisão em
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md)); aqui cada
  "tick" de scroll do mouse é um passo direto, sem essa nuance.
- **Chave do encoder 2**: no firmware ainda não tem função definida
  (reservada). Aqui também não faz nada.

## Quando isso deixa de ser necessário

Assim que o hardware (tela + encoders) estiver montado e o firmware
carregado na placa, o comportamento real deve ser comparado com esse
simulador — qualquer diferença encontrada é um bom sinal de onde ajustar o
firmware (ou o simulador, se a diferença for só cosmética/aceitável).
