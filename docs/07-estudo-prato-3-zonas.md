# Estudo: como os módulos comerciais leem um prato ride de 3 zonas

> **Status: estudo (2026-09-27), sem mudança no firmware ou no hardware.**
> A prática vai começar com um **prato de 2 piezos** (sem chaves), para manter
> o DrumCore open source e acessível: chaves de membrana e sensores especiais
> encarecem e complicam a montagem para a maioria das pessoas.

## Como os comerciais fazem

Quase todos usam **1 piezo no corpo (bow) + 2 chaves de membrana (borda e
cúpula)**. A força da batida vem sempre do piezo; a chave diz *onde* foi. O
que muda é a fiação.

| Fabricante / modelo | Fiação | Como o módulo separa as zonas |
|---|---|---|
| **Roland** (CY-12R/C, CY-13R, CY-15R) | **2 cabos TRS**: jack BOW/EDGE (tip = piezo, ring = chave da borda) e jack BELL (tip = o mesmo piezo, ring = chave da cúpula) | chave fecha ring→sleeve (GND); o módulo mantém o ring em nível alto e vê a queda. Choke = chave da borda pressionada sem batida no piezo |
| **Yamaha** (PCY135/155) | **1 cabo TRS**: tip = piezo; ring = as 2 chaves juntas, a da borda com **~10k em série**, a da cúpula direto ao GND | divisor de tensão com 3 níveis no ring: repouso = alto, borda = intermediário, cúpula = zero. **2 limiares** no mesmo canal (o da cúpula abaixo do da borda) |
| **Roland digital** (CY-18DR) | cabo digital | 3 sensores no bow + cúpula + borda + sensor de toque e um **processador no próprio prato**: sensoriamento posicional do arco à cúpula. Só módulos de ponta |
| **DIY / interfaces** (MegaDrum, eDRUMin) | aceitam as duas fiações acima | pratos caseiros costumam usar **só piezos** (bow, borda, cúpula), às vezes com um adaptador "piezo→chave" (PP→PS) para módulos que esperam chave; a cúpula numa entrada separada. A eDRUMin tem um "Bell Sense" para 3 zonas numa entrada só em rides Roland (detalhes não verificados) |

## Como isso se relaciona com o DrumCore hoje

- **Firmware**: o tipo 5 "Prato 3 zonas" usa `cymbal3zoneSensing()` da lib
  HelloDrum, que é o **esquema Yamaha** (1 cabo, 2 limiares `EDGETHR`/`CUPTHR`
  no ring). A lib lê o canal **invertido** (`1024 − valor`), ou seja,
  **pressupõe um pull-up** no ring.
- **Jackboard atual**: cada canal tem **100k para o GND** (pull-down), 1k em
  série e o grampo duplo de 1N4148; o SIG comum do MUX tem **4,7k para o
  GND**. Isso é o certo para piezo, mas **um prato de chave (Roland ou
  Yamaha) não funciona** nela: a chave aterra o ring, que já está em 0 V em
  repouso.
- Se um dia quisermos suportar pratos comerciais de chave: pull-up opcional
  (ex: 10k para 3,3 V com jumper de solda) no ring dos jacks de prato e rever
  o valor do 4,7k no SIG (ele forma um divisor com o pull-up e reduz a
  diferença entre os níveis). O esquema Roland de 2 cabos exigiria juntar 3
  canais num pad — a lib hoje junta no máximo 2.

## Caminho escolhido: prato de 2 piezos

- **Piezo 1 (tip)**: corpo/bow. **Piezo 2 (ring)**: borda. É o tipo 3 "Prato
  2 zonas" do firmware, sem nenhum componente extra além dos piezos.
- A detecção de borda vem da relação entre os dois piezos, na mesma linha do
  que funcionou no estudo do pad dual (razão pico ring/tip numa janela logo
  após o disparo).
- Uma 3ª zona (cúpula) só com piezos fica para depois: por exemplo, um 3º
  piezo em outro jack, ou separar cúpula e borda pelo padrão de amplitudes.
  Decidir com dados de captura (`rawpad`), não antes.

## Fontes

- [Roland CY-15R](https://www.roland.com/us/products/cy-15r/)
- [2Z/3Z Choke Capable Cymbal (PFozz) — EDrums](https://edrums.github.io/en/diy/cymbal_piezo/)
- [Explain 3-Zone Ride? — VDrums Forum](https://www.vdrums.com/forum/advanced/diy/28215-explain-3-zone-ride)
- [It's no Lemon — digitalDrummer](https://digitaldrummermag.com/2021/06/15/its-no-lemon/)
- [Yamaha PCY155](https://usa.yamaha.com/products/musical_instruments/drums/el_drums/drum_pads/pcy155/)
- [wiring diagram for yamaha 3 zone cymbal? — VDrums Forum](https://www.vdrums.com/forum/advanced/diy/48045-wiring-diagram-for-yamaha-3-zone-cymbal)
- [diy 3-zone ride Roland compatible — MegaDrum forum](https://www.megadrum.info/forums/viewtopic.php?f=3&t=3185)
- [Setting MD's parameters for 3 zone Yamaha style cymbal — MegaDrum forum](http://wap.megadrum.info/forums/viewtopic.php?f=4&start=10&t=925)
- [Roland/ATV 3 Zone Ride Conversion Cable for Yamaha — Zourman Drums](https://zourman.com/product/roland-atv-3-zone-ride-conversion-cable-for-yamaha-3-zone-connection/)
- [Roland CY-18DR](https://www.roland.com/us/products/cy-18dr/)
- [eDRUMin User Manual — Audiofront](https://www.audiofront.net/eDRUMin.pdf)
