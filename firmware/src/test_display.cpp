/*
  Teste isolado da tela TFT ST7735 - so' o logo de boot do DrumCore, sem
  nenhum outro subsistema do firmware principal (sem MUX, sem encoders,
  sem USB-MIDI, sem BLE, sem EEPROM). Primeiro passo da reconstrucao
  incremental do firmware (2026-09-01) - ver docs/01-decisoes-arquiteturais.md
  (Fase Q) pro contexto dos bugs que motivaram voltar a passos pequenos.

  Uso: `pio run -e display_test -t upload --upload-port COM5`
  (ver [env:display_test] em platformio.ini - so compila este arquivo,
  main.cpp fica de fora dessa build).

  Mesmos pinos do main.cpp (ver docs/02-hardware.md):
  SCL=14, SDA=13, RES=12, DC=11, CS=10, BLK=9.
*/

#include <Arduino.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>

#define TFT_BLK 9
#define TFT_CS 10
#define TFT_DC 11
#define TFT_RST 12
#define TFT_MOSI 13
#define TFT_SCLK 14

// Mesma paleta do main.cpp (design/SPEC.md) - RGB565.
#define COL_BG 0x10A3
#define COL_SURFACE 0x1925
#define COL_LINE 0x3A09
#define COL_TXT_DIM 0x7C52
#define COL_ACCENT 0x069F

Adafruit_ST7735 tft(TFT_CS, TFT_DC, TFT_RST);

void setup()
{
    Serial.begin(115200);

    pinMode(TFT_BLK, OUTPUT);
    digitalWrite(TFT_BLK, HIGH); // backlight sempre ligado, sem PWM (menos variavel)

    SPI.begin(TFT_SCLK, -1 /* MISO nao usado */, TFT_MOSI, TFT_CS);
    tft.initR(INITR_BLACKTAB); // confirmado em hardware real - ver docs/01-decisoes-arquiteturais.md
    tft.setRotation(0);

    // Mesmo layout do renderBoot() em main.cpp (design/SPEC.md SCR 0).
    tft.fillScreen(COL_BG);
    tft.setTextColor(COL_ACCENT);
    tft.setTextSize(2);
    tft.setCursor(4, 38);
    tft.print("DRUMCORE");

    tft.setTextSize(1);
    tft.setTextColor(COL_TXT_DIM);
    tft.setCursor(24, 58);
    tft.print("32 PAD TRIGGER");

    tft.fillRect(24, 82, 80, 4, COL_SURFACE);

    tft.setTextColor(COL_LINE);
    tft.setCursor(24, 110);
    tft.print("v0.1  ESP32-S3");

    Serial.println("DEBUG: logo desenhado");
}

void loop()
{
    // Nada aqui de proposito - o logo fica parado na tela, sem redesenhar
    // nada (facilita ver se ele fica estavel ou pisca/some sozinho).
    delay(1000);
}
