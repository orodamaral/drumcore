/*
  Teste isolado do sensor hall (SS49E) no GPIO9 - mostra a leitura bruta do
  ADC (0-4095) na tela TFT e no Serial, ao vivo. Sem MUX/encoders/USB-MIDI/
  BLE/EEPROM do firmware principal - so' pra confirmar que o sensor esta'
  ligado certo e respondendo (valor sobe/desce ao aproximar um ima).

  Uso: `pio run -e test_hall -t upload --upload-port COM5`
  (ver [env:test_hall] em platformio.ini - so compila este arquivo, main.cpp
  fica de fora dessa build).

  Mesmos pinos de tela do main.cpp (Fase Z + ajuste 2026-09-06, ver
  docs/02-hardware.md): SCL=7, SDA=15, RES=16, DC=17, CS=18, BLK=8.
  Sensor hall: sinal no GPIO9 (era GPIO17 antes da Fase Z - migrou porque
  GPIO17 virou sinal permanente da tela), alimentado em 3V3 (nao 5V) e GND.
*/

#include <Arduino.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>

#define TFT_SCLK 7
#define TFT_MOSI 15
#define TFT_RST 16
#define TFT_DC 17
#define TFT_CS 18
#define TFT_BLK 8

#define HALL_PIN 9

// Mesma paleta do main.cpp (design/SPEC.md) - RGB565.
#define COL_BG 0x10A3
#define COL_TXT 0xE77E
#define COL_TXT_DIM 0x7C52
#define COL_ACCENT 0x069F

Adafruit_ST7735 tft(TFT_CS, TFT_DC, TFT_RST);

void setup()
{
    Serial.begin(115200);

    pinMode(TFT_BLK, OUTPUT);
    digitalWrite(TFT_BLK, HIGH); // backlight sempre ligado, sem PWM

    SPI.begin(TFT_SCLK, -1 /* MISO nao usado */, TFT_MOSI, TFT_CS);
    tft.initR(INITR_BLACKTAB); // confirmado em hardware real
    tft.setRotation(0);

    tft.fillScreen(COL_BG);
    tft.setTextColor(COL_ACCENT);
    tft.setTextSize(1);
    tft.setCursor(14, 20);
    tft.print("TESTE SENSOR HALL");
    tft.setCursor(30, 34);
    tft.print("GPIO9 - raw ADC");
}

void loop()
{
    int raw = analogRead(HALL_PIN); // 0-4095 (ADC de 12 bits)

    // Redesenha so' a area do numero, pra nao piscar a tela toda.
    tft.fillRect(0, 55, 160, 40, COL_BG);
    tft.setTextColor(COL_TXT);
    tft.setTextSize(4);
    tft.setCursor(raw < 1000 ? (raw < 100 ? (raw < 10 ? 60 : 40) : 20) : 0, 60);
    tft.print(raw);

    tft.setTextSize(1);
    tft.setTextColor(COL_TXT_DIM);
    tft.setCursor(14, 105);
    tft.print("faixa: 0 (min) - 4095 (max)");

    Serial.println(raw);

    delay(100);
}
