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

### Pinout proposto (usado em `firmware/src/main.cpp`)

> **Status: proposto, ainda não validado em hardware real.** Escolhido evitando
> pinos de strapping (GPIO0, 3, 45, 46), os pinos do USB nativo (GPIO19/20 —
> reservados para o USB-MIDI da Fase B) e a faixa usada por PSRAM octal em
> algumas variantes do S3 (GPIO35-37). Todos os 4 pinos analógicos estão em
> ADC1 (GPIO1-10), evitando ADC2 (que tem conflitos conhecidos com Wi-Fi).

| Sinal | GPIO (ESP32-S3) |
|---|---|
| S0 (compartilhado) | 4 |
| S1 (compartilhado) | 5 |
| S2 (compartilhado) | 6 |
| Z — MUX 0 (pads 0-7) | 1 |
| Z — MUX 1 (pads 8-15) | 2 |
| Z — MUX 2 (pads 16-23) | 7 |
| Z — MUX 3 (pads 24-31) | 8 |

Atualizar esta tabela (e o `main.cpp`) quando o pinout for validado/ajustado no
hardware real.

## Tela OLED

I2C (SDA/SCL) — pinout TBD, seguindo o padrão dos exemplos `muxSensing_u8g2` da
lib base (biblioteca u8g2).

## Botões de configuração

5 botões (EDIT, UP, DOWN, NEXT, BACK), conforme classe `HelloDrumButton` da lib —
pinout TBD.

## Notas

Esta seção deve ser atualizada com o pinout real assim que o hardware for
prototipado/testado, incluindo fotos ou diagramas se fizer sentido.
