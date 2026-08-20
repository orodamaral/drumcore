# Hardware

## Componentes previstos

- 1x placa ESP32-S3 (dev board com USB nativo exposto — confirmar modelo exato
  quando a placa for definida/comprada, ex: ESP32-S3-DevKitC-1).
- 4x multiplexador analógico CD4051 (8 canais cada → 32 canais totais).
- Pads piezo (simples e/ou duplos), pratos 2/3 zonas, hi-hat, conforme suportado
  pela lib (ver [03-biblioteca-hellodrum.md](03-biblioteca-hellodrum.md)).
- Tela TFT 1.44" 128x128 RGB, driver ST7735S, interface SPI (modelo escolhido -
  ver foto `Modelo Tela.jpeg` na raiz do projeto). Substitui o OLED
  SSD1306/I2C previsto inicialmente — ver
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).
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

## Tela TFT (ST7735, SPI)

**Modelo**: 1.44" 128x128 RGB, driver IC ST7735S. 8 pinos: `GND VCC SCL SDA RES
DC CS BLK` (SPI, não I2C).

| Sinal na tela | Função | GPIO (ESP32-S3, proposto) |
|---|---|---|
| SCL | SPI Clock (SCK) | 12 |
| SDA | SPI Data (MOSI) | 11 |
| RES | Reset | 14 |
| DC | Data/Command | 9 |
| CS | Chip Select | 10 |
| BLK | Backlight | 13 (ou direto em 3.3V, se não precisar controlar brilho) |
| VCC | 3.3V | — |
| GND | GND | — |

> **Status: proposto, ainda não validado em hardware real.** Pinos escolhidos
> fora da faixa de strapping (0, 3, 45, 46), fora dos pinos do USB nativo
> (19/20) e sem conflito com os pinos já usados pelos 4x CD4051 (ver tabela
> acima). Não usam pinos ADC1 (1-10) já ocupados pelos MUX, exceto CS(10) e
> DC(9) que ficam nessa faixa mas são usados só digitalmente (sem conflito,
> já que não fazemos `analogRead` neles).

## Botões de configuração

## Botões de configuração

5 botões (EDIT, UP, DOWN, NEXT, BACK), conforme classe `HelloDrumButton` da lib —
pinout TBD.

## Notas

Esta seção deve ser atualizada com o pinout real assim que o hardware for
prototipado/testado, incluindo fotos ou diagramas se fizer sentido.
