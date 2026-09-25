/*
  Teste isolado do MUX0 (CD4067/HW-178) - 2026-09-25. Varre os 16 canais e
  imprime a leitura bruta de todos numa linha (~10x por segundo), pra
  confirmar que o endereçamento S0-S3 e o SIG estão certos: com um sensor
  ligado num canal, so' aquele canal deve reagir.

  Pinos (mesmos de main.cpp): S0=42, S1=41, S2=40, S3=39, SIG=GPIO1 (ADC1_CH0).
  Sem tela/encoder/USB-MIDI/BLE/EEPROM.

  Formato no Serial:
    MUX c0=<v> c1=<v> ... c15=<v>

  Uso: pio run -e mux_test -t upload --upload-port COM5
*/

#include <Arduino.h>

#define MUX_S0 42
#define MUX_S1 41
#define MUX_S2 40
#define MUX_S3 39
#define MUX_SIG 1

#define SETTLE_US 50 // tempo pro SIG estabilizar depois de trocar o endereco

static void selectChannel(uint8_t ch)
{
    digitalWrite(MUX_S0, ch & 1);
    digitalWrite(MUX_S1, (ch >> 1) & 1);
    digitalWrite(MUX_S2, (ch >> 2) & 1);
    digitalWrite(MUX_S3, (ch >> 3) & 1);
}

void setup()
{
    Serial.begin(115200);
    pinMode(MUX_S0, OUTPUT);
    pinMode(MUX_S1, OUTPUT);
    pinMode(MUX_S2, OUTPUT);
    pinMode(MUX_S3, OUTPUT);
    analogReadResolution(12);
    analogSetAttenuation(ADC_11db);
    delay(300);
    Serial.println("# mux_test: MUX0 S0=42 S1=41 S2=40 S3=39 SIG=GPIO1");
}

void loop()
{
    Serial.print("MUX");
    for (uint8_t ch = 0; ch < 16; ch++)
    {
        selectChannel(ch);
        delayMicroseconds(SETTLE_US);
        analogRead(MUX_SIG); // descarta a 1a leitura (residuo do canal anterior)
        Serial.printf(" c%u=%u", ch, analogRead(MUX_SIG));
    }
    Serial.println();
    delay(100);
}
