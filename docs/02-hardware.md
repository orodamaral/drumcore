# Hardware

## Componentes previstos

- 1x placa ESP32-S3 (dev board com USB nativo exposto — confirmar modelo exato
  quando a placa for definida/comprada, ex: ESP32-S3-DevKitC-1).
- 4x multiplexador analógico CD4051 (8 canais cada → 32 canais totais).
- Pads piezo (simples e/ou duplos), pratos 2/3 zonas, hi-hat, conforme suportado
  pela lib (ver [03-biblioteca-hellodrum.md](03-biblioteca-hellodrum.md)).
- Tela OLED (SSD1306, via I2C — mesmo modelo usado nos exemplos da lib com u8g2).
- Botões físicos de configuração (mínimo 5, conforme `HelloDrumButton`: EDIT, UP,
  DOWN, NEXT, BACK).

## Ligação CD4051 ↔ ESP32-S3

Cada CD4051 precisa de 3 pinos digitais de seleção de canal (S0, S1, S2,
compartilháveis entre os 4 chips) + 1 pino ADC dedicado (Z, saída analógica —
este **não** pode ser compartilhado, cada MUX precisa do seu próprio pino ADC).

```
CD4051 #n --------- ESP32-S3
S0     ------------ (compartilhado entre os 4 MUX)
S1     ------------ (compartilhado entre os 4 MUX)
S2     ------------ (compartilhado entre os 4 MUX)
Z      ------------ pino ADC dedicado ao MUX #n
```

> TBD: pinout definitivo (quais GPIOs do ESP32-S3 serão usados para S0/S1/S2 e
> para os 4 pinos ADC). Precisa considerar quais GPIOs do S3 são
> ADC-capable e quais estão reservados pelo USB nativo/strapping pins antes de
> fechar o pinout. Atualizar esta seção quando definido.

## Tela OLED

I2C (SDA/SCL) — pinout TBD, seguindo o padrão dos exemplos `muxSensing_u8g2` da
lib base (biblioteca u8g2).

## Botões de configuração

5 botões (EDIT, UP, DOWN, NEXT, BACK), conforme classe `HelloDrumButton` da lib —
pinout TBD.

## Notas

Esta seção deve ser atualizada com o pinout real assim que o hardware for
prototipado/testado, incluindo fotos ou diagramas se fizer sentido.
