/*
  HelloDrum MIDI-USB - Firmware ESP32-S3

  Fase A: leitura dos 32 canais (4x CD4051) usando a HelloDrum-arduino-Library
  (vendorizada em firmware/lib/HelloDrum-arduino-Library).

  Objetivo desta fase: validar que a leitura dos 32 pads via 4 multiplexadores
  funciona corretamente, reportando os hits via Serial. Sem MIDI, sem
  OLED/botoes de configuracao ainda (proximas fases) - ver docs/00-visao-geral.md.

  Pinout usado aqui: ver docs/02-hardware.md (marcado como proposto/a validar
  no hardware real).
*/

#include <Arduino.h>
#include <hellodrum.h>

// Pinos de selecao dos CD4051, compartilhados entre os 4 chips (S0, S1, S2).
#define MUX_S0 4
#define MUX_S1 5
#define MUX_S2 6

// Um pino ADC dedicado por MUX (saida "Z" de cada CD4051) - nao pode ser
// compartilhado entre os MUXes.
#define MUX0_Z 1
#define MUX1_Z 2
#define MUX2_Z 7
#define MUX3_Z 8

#define NUM_MUX 4
#define PADS_PER_MUX 8
#define NUM_PADS (NUM_MUX * PADS_PER_MUX) // 32

// Cada HelloDrumMUX_4051 recebe um muxNum sequencial automatico (0..3, na
// ordem de instanciacao abaixo). Ver docs/01-decisoes-arquiteturais.md.
HelloDrumMUX_4051 mux[NUM_MUX] = {
    HelloDrumMUX_4051(MUX_S0, MUX_S1, MUX_S2, MUX0_Z),
    HelloDrumMUX_4051(MUX_S0, MUX_S1, MUX_S2, MUX1_Z),
    HelloDrumMUX_4051(MUX_S0, MUX_S1, MUX_S2, MUX2_Z),
    HelloDrumMUX_4051(MUX_S0, MUX_S1, MUX_S2, MUX3_Z),
};

// pads[i] usa i diretamente como indice em rawValue[], pois os 4 MUX acima
// sao instanciados em ordem (muxNum 0..3) e i == muxNum*PADS_PER_MUX + canal.
// pads[0..7] -> MUX 0, pads[8..15] -> MUX 1, pads[16..23] -> MUX 2,
// pads[24..31] -> MUX 3.
HelloDrum pads[NUM_PADS] = {
    HelloDrum(0),  HelloDrum(1),  HelloDrum(2),  HelloDrum(3),
    HelloDrum(4),  HelloDrum(5),  HelloDrum(6),  HelloDrum(7),
    HelloDrum(8),  HelloDrum(9),  HelloDrum(10), HelloDrum(11),
    HelloDrum(12), HelloDrum(13), HelloDrum(14), HelloDrum(15),
    HelloDrum(16), HelloDrum(17), HelloDrum(18), HelloDrum(19),
    HelloDrum(20), HelloDrum(21), HelloDrum(22), HelloDrum(23),
    HelloDrum(24), HelloDrum(25), HelloDrum(26), HelloDrum(27),
    HelloDrum(28), HelloDrum(29), HelloDrum(30), HelloDrum(31),
};

void setup()
{
    Serial.begin(115200);
    delay(500);
    Serial.println("HelloDrum - Fase A: leitura de 32 canais (4x CD4051)");
}

void loop()
{
    for (byte m = 0; m < NUM_MUX; m++)
    {
        mux[m].scan();
    }

    for (byte i = 0; i < NUM_PADS; i++)
    {
        // Sensing com os valores padrao definidos no construtor de HelloDrum
        // (sensibilidade/threshold/scan/mask). A configuracao por pad via
        // EEPROM/OLED/botoes entra numa fase posterior.
        pads[i].singlePiezoMUX();

        if (pads[i].hit)
        {
            Serial.print("Pad ");
            Serial.print(i);
            Serial.print(" (MUX ");
            Serial.print(i / PADS_PER_MUX);
            Serial.print(", canal ");
            Serial.print(i % PADS_PER_MUX);
            Serial.print(") - velocity: ");
            Serial.println(pads[i].velocity);
        }
    }
}
