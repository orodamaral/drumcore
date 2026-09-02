/*
  Teste minimo (2026-09-01): so' pisca o LED RGB embutido da placa (GPIO48,
  confirmado por Rodrigo na serigrafia - ver docs/02-hardware.md), sem
  tela/MUX/USB-MIDI/BLE/EEPROM. Objetivo: validar que o fluxo de
  compilar+gravar+rodar esta' saudavel antes de voltar pra tela.

  Usa neopixelWrite(), funcao nativa do core arduino-esp32 pra LED RGB
  enderecavel (WS2812) - nao precisa de biblioteca externa.

  Uso: `pio run -e test_rgbled -t upload --upload-port COM5`
*/

#include <Arduino.h>

#define RGB_LED_PIN 48

void setup()
{
    Serial.begin(115200);
    delay(200);
    Serial.println("DEBUG: entrou no setup() (test_rgbled)");
}

void loop()
{
    neopixelWrite(RGB_LED_PIN, 20, 0, 0); // vermelho (brilho baixo de proposito)
    Serial.println("vermelho");
    delay(500);

    neopixelWrite(RGB_LED_PIN, 0, 20, 0); // verde
    Serial.println("verde");
    delay(500);

    neopixelWrite(RGB_LED_PIN, 0, 0, 20); // azul
    Serial.println("azul");
    delay(500);
}
