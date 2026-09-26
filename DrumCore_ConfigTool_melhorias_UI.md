# DrumCore ConfigTool — Especificação de melhorias de interface

> **Para o Claude Code:** este documento descreve melhorias de UI/UX para a tela **ConfigTool → aba PADS** (e partes do cabeçalho e do log) do projeto DrumCore. Ele foi escrito a partir de um **print da tela**, sem acesso ao código. Por isso:
>
> - **Não presuma** framework, estrutura de pastas, nomes de componentes, faixas de valores ou protocolo. Descubra tudo isso no código (Passo 0) antes de alterar qualquer coisa.
> - Onde este documento diz **"verificar no código"**, a informação precisa vir do projeto e não pode ser inventada.
> - Se algo aqui contradisser o que o código faz, **o código manda**. Anote a divergência e pergunte ao usuário.
> - Trabalhe de forma **incremental**, na ordem das fases (seção 6), validando cada fase antes de seguir.
> - Idioma da interface: **português do Brasil**.

---

## 1. Contexto

O DrumCore é um módulo de bateria eletrônica / trigger MIDI (piezos → MIDI), com conexão **BLE-MIDI**. O ConfigTool é a interface web usada para configurar o módulo. Ele tem:

- Cabeçalho do site: logo DRUMCORE, navegação (Visão geral · Hardware · **ConfigTool** · GitHub ↗).
- Barra de conexão: checkbox **"Modo demo (sem hardware)"**, botão **Desconectar**, indicador verde e selo **"BLE"**.
- Abas: **PADS** · GLOBAL · MIDI MONITOR · FIRMWARE.
- Aba PADS, com duas colunas:
  - **Esquerda:** lista de pads (1, 2, 3… pelo menos 19; cada um com "Sem nome" e "nota 36", "nota 37"… em sequência). O pad 1 está selecionado (borda verde-água) e o pad 2 tem **borda vermelha**, com significado não explicado na tela.
  - **Direita:** editor do pad selecionado:
    - número do pad + campo "Nome do pad (ex: Caixa)";
    - checkbox "Canal ativo";
    - select "Tipo de sensor" (valor atual: `Simples (1 zona) (1 canal)`);
    - 10 sliders, cada um com o valor numérico à direita: Sensibilidade (100), Threshold (10), Scan time (10), Mask time (30), Curva (0), Retrigger (0), Gain (calibração) (100), Crosstalk (0), Grupo de crosstalk (0), Nota MIDI (36);
    - caixa de resultado de calibração ("Calibrado! Novos valores:", com lista e os botões **Aplicar** / **Descartar**).
- Rodapé: **console de log** em fonte monoespaçada, que no modo demo repete várias vezes "BLE-MIDI: dispositivo pareado/desconectado (simulado)".
- Tema escuro, com destaque em verde/verde-água.

---

## 2. Regras gerais e restrições

1. **Não alterar o protocolo** de comunicação com o módulo: mensagens BLE-MIDI, SysEx, formato de comandos, ordem e escala dos parâmetros. A mudança é **só de apresentação e interação**. Se alguma melhoria exigir dado que o firmware não fornece, ela deve degradar com elegância (seção 4.6).
2. **Não mudar a semântica dos valores.** Se o firmware recebe `mask = 30`, a UI continua enviando `30`. Unidades e rótulos são só para exibição.
3. **O modo demo precisa continuar funcionando**, e toda funcionalidade nova deve ter comportamento simulado nele.
4. **Manter a identidade visual atual** (tema escuro, cor de destaque, fontes). Reaproveitar os tokens/variáveis CSS existentes. Criar novos tokens só quando faltar algum e documentar no mesmo lugar dos atuais.
5. **Sem dependências novas pesadas.** Se precisar de alguma (ex.: para gráfico), justifique e prefira SVG/Canvas nativo.
6. **Acessibilidade:** todos os controles operáveis por teclado, com `label` associado, foco visível e contraste AA.
7. **Componentizar:** criar um componente reutilizável de parâmetro (seção 4.1) em vez de repetir marcação.
8. **Commits pequenos**, um por melhoria, com mensagem descritiva.
9. Não remover funcionalidades existentes sem perguntar.

---

## 3. Passo 0 — Reconhecimento do código (obrigatório antes de editar)

Levantar e registrar (pode ser um comentário no PR ou um `NOTES.md` temporário):

1. **Stack:** framework (React/Vue/Svelte/vanilla…), bundler, sistema de estilos (CSS puro, Tailwind, CSS modules…), gerenciamento de estado.
2. **Onde está cada parte:** lista de pads, editor de pad, sliders, caixa de calibração, barra de conexão, console de log, abas.
3. **Fonte da verdade dos parâmetros.** Para cada um, descobrir:
   - nome interno / chave no protocolo;
   - **mínimo, máximo e passo**;
   - **unidade real** (ms? µs? %? valor bruto do ADC?). Se não houver indicação no código/firmware/README, **não inventar**: exibir sem unidade e listar na seção "Dúvidas" (seção 9);
   - valor padrão;
   - se é contínuo ou **enumerado** (ex.: Curva parece ser um índice, porque o slider mostra `0` e a calibração mostra "Exp 1");
   - se depende do tipo de sensor (parâmetros que só existem em sensor de 2 zonas, por exemplo).
4. **Lista de tipos de sensor** e o que muda em cada um.
5. **Lista de curvas** (nomes e índices).
6. **Fluxo de envio:** a alteração de um slider é enviada ao módulo **imediatamente**, com debounce, ou só com um botão "Salvar/Gravar"? Existe persistência (EEPROM/flash) separada do envio?
7. **Fluxo de calibração:** o que dispara a calibração, quais dados ela devolve, o que "Aplicar" e "Descartar" fazem.
8. **Significado da borda vermelha no pad 2** (erro? pad sendo tocado? alteração não salva? sem sensor?).
9. **O firmware envia algum dado ao vivo** (nível do sinal do piezo, velocity de cada batida, pico)? Ver a aba MIDI MONITOR, que provavelmente já consome Note On com velocity.
10. **Como o modo demo simula** o módulo (onde fica o mock).

Só depois disso seguir para as fases.

---

## 4. Melhorias

Cada item tem: **Problema → Solução → Detalhes → Critérios de aceite.**

### 4.1 Componente de parâmetro (slider + campo numérico)

**Problema.** Os sliders aparecem como barras cinzas quase uniformes, com um "vão" onde deveria estar o botão (thumb). Na prática não dá para ver a posição, não há trilha preenchida, não há unidade e não dá para digitar um valor exato. O estilo do `input[type=range]` provavelmente está quebrado ou incompleto (ex.: `-webkit-slider-thumb` sem estilo, ou `appearance: none` sem redefinir o thumb, ou falta de regras `-moz-range-*`).

**Solução.** Criar o componente `ParamSlider` (ou o nome que combinar com o projeto) com:

- **Rótulo** à esquerda, com um ícone "i" opcional que mostra uma **descrição curta** no hover/foco (textos sugeridos na seção 4.1.1).
- **Trilha** com a parte preenchida (do mínimo até o valor) na cor de destaque e o restante em cinza escuro.
- **Thumb** visível: círculo de 14–16 px, cor clara, borda na cor de destaque, estados hover/active/focus.
- **Campo numérico** à direita (`input type=number`, largura ~64 px, alinhado à direita), sincronizado nos dois sentidos com o slider, respeitando min/max/step e fazendo *clamp* ao sair do campo.
- **Unidade** ao lado do número (ex.: `ms`, `%`), **só se confirmada** no Passo 0.
- **Indicação de valor padrão:** uma marquinha discreta na trilha na posição do padrão e **duplo clique no rótulo** (ou um botão ↺ pequeno) para restaurar.
- **Indicação de "modificado"** (ponto ou cor no rótulo) quando o valor difere do que está gravado no módulo, caso esse conceito exista no fluxo (ver Passo 0, item 6).
- **Teclado:** setas ±1 passo, Shift+setas ±10 passos, Home/End para mín/máx (o comportamento nativo do range já cobre boa parte; garantir que o estilo não quebre o foco).
- **Envio ao módulo** com o mesmo mecanismo atual. Se hoje é imediato, aplicar **debounce (~100–150 ms)** durante o arraste e enviar o valor final no `change`, sem mudar o protocolo.
- Estado **desabilitado** (quando "Canal ativo" está desmarcado).

CSS de referência para o range (adaptar aos tokens do projeto):

```css
.param-range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(
    to right,
    var(--accent) 0%,
    var(--accent) var(--fill, 0%),
    var(--track-bg) var(--fill, 0%),
    var(--track-bg) 100%
  );
  outline: none;
}
.param-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--thumb-bg);
  border: 2px solid var(--accent);
  cursor: pointer;
  margin-top: 0; /* ajustar se a trilha tiver altura diferente */
}
.param-range::-moz-range-thumb {
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--thumb-bg);
  border: 2px solid var(--accent);
  cursor: pointer;
}
.param-range::-moz-range-track { height: 6px; border-radius: 3px; background: var(--track-bg); }
.param-range::-moz-range-progress { height: 6px; border-radius: 3px; background: var(--accent); }
.param-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px var(--focus-ring); }
.param-range:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 3px var(--focus-ring); }
.param-range:disabled { opacity: .4; cursor: not-allowed; }
```

O `--fill` é atualizado por JS/estado: `((valor - min) / (max - min)) * 100 + '%'`.

**Critérios de aceite**
- [ ] A posição do valor é visível de imediato em todos os sliders, no Chrome, Edge e Firefox.
- [ ] Digitar no campo numérico move o slider, e mover o slider atualiza o campo.
- [ ] Valores fora da faixa são corrigidos para o limite mais próximo.
- [ ] Tudo funciona só com teclado, com foco visível.
- [ ] O valor enviado ao módulo é idêntico ao de antes para a mesma posição.

#### 4.1.1 Textos de ajuda sugeridos (tooltip)

Ajustar se o comportamento real do firmware for diferente. **Confirmar no código/README do firmware.**

| Parâmetro | Texto sugerido |
|---|---|
| Sensibilidade | Quão forte precisa ser a batida para atingir a velocity máxima. Valores maiores = velocity alta com menos força. |
| Threshold | Nível mínimo de sinal para contar como batida. Aumente se houver disparos falsos (ruído, vibração). |
| Scan time | Janela em que o módulo procura o pico da batida depois de detectá-la. Valores maiores leem melhor a velocity, mas aumentam a latência. |
| Mask time | Tempo após uma batida em que novas batidas no mesmo pad são ignoradas. Evita disparos duplos. |
| Curva | Como a força da batida é convertida em velocity (linear, exponencial, logarítmica…). |
| Retrigger | Supressão de redisparo enquanto o sinal ainda está decaindo. Aumente se um toque gerar duas notas. |
| Gain (calibração) | Ganho aplicado ao sinal do sensor, usado para equalizar pads diferentes. |
| Crosstalk | Quanto este pad ignora batidas causadas por vibração de outros pads do mesmo grupo. |
| Grupo de crosstalk | Pads no mesmo grupo têm crosstalk cancelado entre si. 0 = sem grupo (confirmar). |
| Nota MIDI | Nota enviada quando o pad é tocado. |

---

### 4.2 Agrupar os parâmetros em seções

**Problema.** São 10 sliders idênticos em sequência, sem hierarquia, e fica difícil achar o que se procura.

**Solução.** Dividir o editor em seções com título pequeno (caixa alta, espaçamento de letra, cor secundária) e um separador sutil:

1. **Identificação:** número do pad, nome, canal ativo, tipo de sensor.
2. **Detecção:** Threshold, Sensibilidade, Scan time, Mask time, Retrigger.
3. **Resposta:** Curva (com gráfico, seção 4.3.2) e Gain.
4. **Crosstalk:** Grupo e Nível.
5. **MIDI:** Nota MIDI (seção 4.3.1). Se existir canal MIDI por pad ou outras opções MIDI no código, entram aqui.

Em telas largas (≥ 1280 px), as seções podem ficar em **duas colunas** (Detecção | Resposta + Crosstalk + MIDI) para não esticar os sliders em ~1300 px como hoje. Sliders muito longos atrapalham a precisão; limitar a largura útil do slider a algo como **480–560 px**.

**Critérios de aceite**
- [ ] Todos os parâmetros existentes continuam presentes.
- [ ] Nenhum parâmetro mudou de chave/ordem de envio no protocolo (a ordem visual pode mudar).
- [ ] Layout legível em 1280 px, 1920 px e ≤ 1024 px (seção 4.12).

---

### 4.3 Controles específicos no lugar do slider genérico

#### 4.3.1 Nota MIDI

- Trocar o slider por: **campo numérico (0–127)** + **nome da nota** + **nome do instrumento General MIDI (GM)**, quando existir.
  - Exemplo: `36 · C1 · Bass Drum 1`.
- Convenção de oitava: usar **C1 = 36 (C3 = 60)**, comum em DAWs e módulos de bateria. Se o projeto já usar outra convenção em algum lugar (ex.: MIDI MONITOR), **seguir a do projeto** para manter a consistência.
- Oferecer um **dropdown de atalhos GM** (Kick, Caixa, Chimbal fechado etc.) que preenche o número.
- Botões −/+ ao lado do campo.
- Opcional: botão **"Aprender"** (MIDI learn inverso). Ao clicar, a próxima batida em outro pad ou nota recebida define a nota. Só implementar se o código já recebe MIDI de entrada; caso contrário, deixar de fora.
- Aviso discreto se **outro pad já usa a mesma nota** ("Também usada pelo pad 7"), sem bloquear, porque pode ser intencional.

Mapa GM de percussão (canal 10), notas 35–81, para a tabela de nomes:

```
35 Acoustic Bass Drum   36 Bass Drum 1        37 Side Stick         38 Acoustic Snare
39 Hand Clap            40 Electric Snare     41 Low Floor Tom      42 Closed Hi-Hat
43 High Floor Tom       44 Pedal Hi-Hat       45 Low Tom            46 Open Hi-Hat
47 Low-Mid Tom          48 Hi-Mid Tom         49 Crash Cymbal 1     50 High Tom
51 Ride Cymbal 1        52 Chinese Cymbal     53 Ride Bell          54 Tambourine
55 Splash Cymbal        56 Cowbell            57 Crash Cymbal 2     58 Vibraslap
59 Ride Cymbal 2        60 Hi Bongo           61 Low Bongo          62 Mute Hi Conga
63 Open Hi Conga        64 Low Conga          65 High Timbale       66 Low Timbale
67 High Agogo           68 Low Agogo          69 Cabasa             70 Maracas
71 Short Whistle        72 Long Whistle       73 Short Guiro        74 Long Guiro
75 Claves               76 Hi Wood Block      77 Low Wood Block     78 Mute Cuica
79 Open Cuica           80 Mute Triangle      81 Open Triangle
```

Na UI, mostrar os nomes traduzidos para PT-BR nos mais comuns (Bumbo, Caixa, Aro, Chimbal fechado/aberto/pedal, Tom 1/2/3, Surdo, Ataque, Condução, Cúpula, Splash, China) e manter o nome GM original nos demais.

- A **lista de pads** (esquerda) deve refletir a nota em tempo real ("nota 36" → `36 · C1`).

#### 4.3.2 Curva

- Trocar o slider por um **select** (ou um grupo de botões segmentados, se forem poucas opções) com os **nomes reais das curvas** vindos do código (o print mostra que existe pelo menos "Exp 1").
- Ao lado, um **mini-gráfico SVG** (~120×80 px) com eixo X = força de entrada e eixo Y = velocity (0–127), desenhando a curva selecionada.
  - Se a fórmula de cada curva estiver no firmware/código, **usar a fórmula real**. Se não estiver disponível, **não inventar**: usar só o nome, sem gráfico, e registrar em "Dúvidas".
- Se existirem parâmetros de curva (ex.: fator), ficam aqui.

#### 4.3.3 Grupo de crosstalk

- Trocar o slider por **botões segmentados** (`Nenhum · 1 · 2 · 3 · …`) ou por um select, conforme a quantidade de grupos (ver no código).
- Mostrar abaixo: "Pads neste grupo: 3, 4, 5" (derivado da configuração dos outros pads).

#### 4.3.4 Tipo de sensor

- O texto atual `Simples (1 zona) (1 canal)` tem parênteses duplicados. Padronizar para `Simples · 1 zona · 1 canal` (e equivalentes nos outros tipos).
- Se o tipo tiver 2 zonas (pele + aro, por exemplo), exibir os parâmetros extras **somente** nesse caso e deixar claro que pad/canal é usado para a segunda zona. Verificar no código como isso funciona hoje.

#### 4.3.5 Canal ativo

- Trocar o checkbox por um **toggle/switch** com o texto "Ativo" / "Inativo".
- Quando inativo: os parâmetros ficam desabilitados (opacidade reduzida, mas legíveis) e o pad aparece esmaecido na lista.

---

### 4.4 Calibração: mostrar a diferença (antes → depois)

**Problema.** A caixa "Calibrado! Novos valores" lista apenas os valores novos, sem os atuais, e o usuário não sabe o que vai mudar. A caixa também ocupa bastante espaço e empurra o conteúdo.

**Solução.**
- Mostrar uma **tabela de diferenças**:

  | Parâmetro | Atual | Proposto |
  |---|---|---|
  | Mask time | 30 | **33** ↑ |
  | Curva | Linear (0) | **Exp 1** |
  | Retrigger | 0 | **23** ↑ |
  | Sensibilidade | 100 | 100 (sem mudança, em cinza) |

  - Linhas sem mudança ficam em cinza ou escondidas atrás de "mostrar todos".
  - Mudanças com seta ↑/↓ e cor neutra de destaque. **Não** usar verde/vermelho como se fosse "bom/ruim".
- Enquanto a proposta está pendente, os **sliders afetados** mostram uma "marca fantasma" na posição proposta (tracinho na cor de destaque) e um selo "proposto: 33".
- Botões:
  - **Aplicar** (primário). Se hoje aplica tudo, manter.
  - Opcional: **checkbox por linha** para aplicar só alguns valores, **se** o fluxo atual permitir aplicar parcialmente sem alterar o protocolo (normalmente sim, porque é só enviar os parâmetros escolhidos).
  - **Descartar** (secundário, estilo neutro). Hoje ele está em vermelho, cor que deve ficar para ações destrutivas. Descartar uma sugestão não é destrutivo.
- Mostrar **quando e em qual pad** a calibração foi feita ("Calibração do pad 1 · agora há pouco").
- Posição: logo abaixo do título do pad, recolhível, **ou** um painel/toast fixo no canto inferior. Escolher o que for mais simples no layout atual, desde que não esconda os sliders.
- Após Aplicar: feedback curto ("Valores aplicados ao pad 1"), e a caixa some.

**Critérios de aceite**
- [ ] Cada valor proposto aparece junto do valor atual.
- [ ] Parâmetros enumerados (Curva) aparecem pelo nome, não só pelo índice.
- [ ] Aplicar/Descartar mantêm o comportamento atual em relação ao módulo.

---

### 4.5 Lista de pads (coluna esquerda)

**Problemas.**
- "Sem nome" em itálico repetido em todos os itens vira ruído.
- A borda vermelha do pad 2 não tem explicação.
- Não há nenhuma indicação de atividade (batida) nem de estado (ativo/inativo, modificado).
- A lista rola, e não há busca nem navegação rápida.

**Solução.** Cada item da lista passa a ter:

```
[●] 1  Caixa              38 · D1
        ▁▃▆█▅▂ (flash de batida)
```

- **Número** do pad (fixo, largura tabular).
- **Nome**: se vazio, mostrar o nome GM da nota em cinza (ex.: "Bass Drum 1") em vez de "Sem nome".
- **Nota** no formato `36 · C1`.
- **Indicador de batida:** ao receber uma nota do pad (via MIDI já recebido na aba MIDI MONITOR, ou via mensagem do firmware), o item pisca por ~150 ms com intensidade proporcional à velocity. No modo demo, simular batidas aleatórias ou ao clicar.
- **Estado inativo:** item esmaecido, com ícone de "desligado".
- **Estado com erro/alerta** (se for isso que a borda vermelha significa): ícone ⚠ com tooltip explicando, no lugar de apenas uma borda vermelha. Descobrir no Passo 0 o que a borda significa e escolher o ícone/cor adequado.
- **Selecionado:** fundo levemente destacado + barra de 3 px na cor de destaque à esquerda (mais claro que a borda completa atual).
- **Modificado e não salvo** (se o conceito existir): ponto pequeno ao lado do número.
- Navegação por teclado: ↑/↓ troca de pad quando a lista tem foco.
- **Clicar/tocar no pad físico seleciona o pad na lista** (opção "Seguir pad tocado", com toggle no topo da lista). É o recurso que mais economiza tempo nesse tipo de ferramenta.
- Opcional no topo da lista: campo de filtro e ações em lote ("Copiar configurações deste pad para…").

**Critérios de aceite**
- [ ] O significado de toda cor/borda na lista é explicado (tooltip ou legenda).
- [ ] O nome e a nota refletem as edições em tempo real.
- [ ] O indicador de batida funciona no modo demo.

---

### 4.6 Monitor de sinal ao vivo (para ajustar Threshold/Sensibilidade)

**Objetivo.** Hoje o usuário ajusta Threshold e Sensibilidade "no escuro". Um medidor visual resolve isso.

**Solução** (depende do que o firmware envia; ver Passo 0, item 9):

- **Nível A (sempre possível):** usar os **Note On recebidos** do pad selecionado. Mostrar a velocity da última batida (barra 0–127 + número), um histórico das últimas ~20 batidas em mini-gráfico de barras e as velocity **mín/máx/média**. Com isso já dá para calibrar a Sensibilidade ("bati forte e chegou a 127?").
- **Nível B (se o firmware enviar nível/pico do sinal):** gráfico em tempo real do sinal do piezo com uma **linha horizontal do Threshold** desenhada por cima (arrastável, sincronizada com o slider) e marcadores de pico detectado e de janela de scan/mask.
- Se o nível B não for suportado, **não criar comandos novos no protocolo**. Apenas implementar o nível A e deixar registrado em "Dúvidas" que o nível B precisa de suporte no firmware.
- No modo demo: gerar batidas simuladas com velocity aleatória e/ou um botão "Simular batida".

Posição: um card fixo no topo da seção **Detecção** ou uma faixa entre o cabeçalho do pad e as seções.

---

### 4.7 Cabeçalho e estado de conexão

**Problemas.**
- Existem duas faixas de cabeçalho (navegação do site + barra de conexão), e a segunda tem muito espaço vazio.
- No **modo demo** aparecem "Desconectar", um ponto verde e o selo "BLE", e isso dá a impressão de haver hardware real conectado.
- O selo "BLE o" tem um caractere estranho após "BLE". Verificar se é um ícone quebrado.

**Solução.**
- Juntar em **uma única barra de status** do ConfigTool, alinhada com as abas:
  - À esquerda: abas (PADS · GLOBAL · MIDI MONITOR · FIRMWARE).
  - À direita: **chip de conexão** com estados bem distintos:
    - `Desconectado` (cinza) + botão **Conectar**;
    - `Conectando…` (âmbar, com animação);
    - `Conectado · <nome do dispositivo> · BLE` (verde) + menu com Desconectar e informações (firmware, bateria/RSSI, se disponíveis);
    - `DEMO · sem hardware` (roxo ou outra cor que não seja o verde de "conectado") + botão "Sair do demo".
  - O checkbox "Modo demo" vira uma opção dentro do chip ou no estado desconectado ("Experimentar sem hardware").
- Durante o modo demo, uma **faixa fina** no topo da área de trabalho: "Você está no modo demo: nenhuma alteração é enviada a um módulo real."

**Critérios de aceite**
- [ ] É impossível confundir o modo demo com uma conexão real.
- [ ] Cada estado de conexão tem cor, texto e ação próprios.

---

### 4.8 Console de log

**Problemas.** Ocupa altura fixa (~120 px) o tempo todo, repete mensagens idênticas e não tem filtro.

**Solução.**
- Transformar em um **painel recolhível** ("Log ▾") no rodapé, **recolhido por padrão**, mostrando só a última linha, com contador de novas mensagens.
- Altura ajustável por arraste quando aberto (opcional).
- Cada linha com **horário** (`HH:MM:SS`) e **nível** (info/aviso/erro) com cor.
- **Agrupar repetições consecutivas** idênticas: `BLE-MIDI: dispositivo pareado. (simulado) ×4`.
- Filtro por nível + botões **Limpar** e **Copiar**.
- Erros abrem o painel automaticamente (ou mostram um toast).
- No modo demo, avaliar **por que o simulador fica alternando pareado/desconectado**. Se for bug do mock, corrigir; se for intencional, reduzir a frequência.

---

### 4.9 Salvar, enviar e estados de alteração

Depende do Passo 0, item 6.

- Se os valores são enviados **imediatamente**: mostrar um feedback sutil de envio (um "✓ enviado" breve perto do campo, ou um indicador global "Sincronizado").
- Se existe **gravar na memória do módulo** separado do envio: criar um botão **"Gravar no módulo"** fixo (rodapé do editor ou barra de status), habilitado só quando houver alterações, com um contador ("3 alterações não gravadas"). Avisar antes de sair da página/desconectar se houver alterações não gravadas.
- **Desfazer/Refazer** (Ctrl+Z / Ctrl+Shift+Z) das alterações da sessão: desejável, mas pode ficar para uma fase posterior.
- Ações por pad (menu "⋯" ao lado do nome): **Copiar configuração**, **Colar configuração**, **Restaurar padrões**, **Copiar para outros pads…**.

---

### 4.10 Cabeçalho do editor de pad

- Mostrar o título grande: **"Pad 1 · Caixa"** (ou "Pad 1 · Bass Drum 1", se sem nome), com o campo de nome editável inline (clique no nome ou ícone ✎).
- Ao lado: nota MIDI, estado ativo/inativo e tipo de sensor em chips.
- Navegação ◀ ▶ para ir ao pad anterior/próximo.

---

### 4.11 Acessibilidade e teclado

- Todos os inputs com `<label for>` ou `aria-label`.
- Tooltips acessíveis por foco (não só hover), com `aria-describedby`.
- Contraste mínimo AA (4.5:1 para texto normal). Hoje o texto cinza dos rótulos e das "notas" na lista pode estar abaixo disso; conferir.
- Foco visível em tudo (`:focus-visible`).
- Atalhos (documentar num "?" no canto):
  - `↑/↓` na lista: trocar de pad;
  - `Alt+↑/↓` em qualquer lugar: trocar de pad;
  - `Ctrl+S`: gravar no módulo (se existir);
  - `Esc`: fechar a caixa de calibração/diálogos.
- Respeitar `prefers-reduced-motion` nas animações de flash de batida.

---

### 4.12 Responsividade

- **≥ 1280 px:** lista de pads (≈260 px) + editor em 2 colunas de seções.
- **1024–1279 px:** lista + editor em 1 coluna.
- **< 1024 px** (tablet, uso comum ao lado da bateria): a lista de pads vira um **seletor horizontal rolável** ou um dropdown no topo, e o editor ocupa a largura total. Alvos de toque ≥ 40 px.
- Sem rolagem horizontal da página em nenhuma largura.

---

## 5. Diretrizes visuais

Reaproveitar as variáveis existentes. Se não houver um sistema de tokens, criar um conjunto mínimo em `:root`:

| Token | Uso | Sugestão (ajustar ao atual) |
|---|---|---|
| `--bg` | fundo da página | o atual (~#15171a) |
| `--surface` | cards/painéis | um degrau mais claro que `--bg` |
| `--surface-2` | hover, item selecionado | mais um degrau |
| `--border` | divisores | cinza com baixo contraste |
| `--text` | texto principal | ~#e6e8eb |
| `--text-muted` | rótulos, ajuda | cinza com contraste ≥ 4.5:1 sobre `--surface` |
| `--accent` | destaque / trilha preenchida | o verde-água atual |
| `--track-bg` | trilha vazia do slider | cinza escuro |
| `--thumb-bg` | thumb | quase branco |
| `--warn` | alertas | âmbar |
| `--danger` | só para ações destrutivas/erros | vermelho |
| `--demo` | estado demo | roxo/azul (≠ verde de conectado) |
| `--focus-ring` | foco | `--accent` com ~40% de opacidade |

- Espaçamento em escala de 4 px (4/8/12/16/24/32).
- Números sempre com `font-variant-numeric: tabular-nums` para não "pularem" ao mudar.
- Rótulos de seção: 11–12 px, caixa alta, `letter-spacing: .08em`, `--text-muted`.
- Evitar itálico para placeholders; usar cor esmaecida.

---

## 6. Ordem de implementação (fases)

Validar cada fase (seção 7) antes de passar à próxima.

1. **Fase 1: correções de base (maior impacto, menor risco)**
   - 4.1 Componente de parâmetro (conserta os sliders + campo numérico).
   - Correção do texto do tipo de sensor (4.3.4).
   - Botão Descartar em estilo neutro (4.4).
2. **Fase 2: organização**
   - 4.2 Seções.
   - 4.3 Controles específicos (Nota MIDI, Curva, Grupo de crosstalk, Canal ativo).
   - 4.10 Cabeçalho do editor.
3. **Fase 3: calibração e lista**
   - 4.4 Diff da calibração.
   - 4.5 Lista de pads (sem o indicador de batida, se ele depender da fase 4).
4. **Fase 4: ao vivo**
   - Indicador de batida na lista (4.5).
   - 4.6 Monitor de sinal (nível A; nível B só se o firmware suportar).
   - "Seguir pad tocado".
5. **Fase 5: moldura**
   - 4.7 Status de conexão/demo.
   - 4.8 Console de log.
   - 4.9 Salvar/enviar e ações por pad.
6. **Fase 6: acabamento**
   - 4.11 Acessibilidade e atalhos.
   - 4.12 Responsividade.
   - Desfazer/refazer (opcional).

---

## 7. Verificação (a cada fase)

- [ ] O projeto compila sem erros/avisos novos; lint e testes existentes passam.
- [ ] **Modo demo:** percorrer a aba PADS inteira: trocar de pad, editar cada parâmetro por slider e por teclado, rodar calibração, Aplicar e Descartar.
- [ ] **Com hardware** (se o usuário tiver disponível; senão, pedir para ele testar): conferir, pelo log ou pela aba MIDI MONITOR, que os valores enviados são os mesmos de antes para as mesmas posições.
- [ ] Chrome, Edge e Firefox (o range tem estilos diferentes por engine).
- [ ] Larguras de 1920, 1280, 1024 e 768 px.
- [ ] Navegação só por teclado.
- [ ] Tirar prints antes/depois de cada fase para o usuário comparar.

---

## 8. Fora de escopo (não fazer sem pedir)

- Mudar o firmware ou o protocolo BLE-MIDI/SysEx.
- Redesenhar as abas GLOBAL, MIDI MONITOR e FIRMWARE (só reaproveitar componentes se ficar natural; perguntar antes).
- Trocar framework, biblioteca de UI ou sistema de estilos.
- Alterar o site ao redor (Visão geral, Hardware, GitHub), exceto o necessário para unificar a barra de status.

---

## 9. Dúvidas para confirmar com o usuário

Responder a partir do código quando possível; perguntar ao usuário o que não der para descobrir:

1. Unidades reais de Sensibilidade, Threshold, Scan time, Mask time, Retrigger, Gain e Crosstalk.
2. Faixas (mín/máx/passo) de cada parâmetro, se não estiverem explícitas no código.
3. O que significa a borda vermelha no pad 2.
4. As alterações vão para o módulo na hora ou existe um "gravar"? Existe persistência em flash/EEPROM?
5. O firmware envia nível do sinal ao vivo (para o monitor nível B)?
6. Lista de curvas e as fórmulas correspondentes (para o gráfico).
7. Quantos grupos de crosstalk existem e se 0 significa "sem grupo".
8. Convenção de oitava preferida para nome de nota (C1 = 36 ou C2 = 36).
9. O simulador do modo demo deveria mesmo alternar "pareado/desconectado" repetidamente?
10. Quantidade máxima de pads e se os tipos de sensor de 2 zonas usam 2 canais/pads.
