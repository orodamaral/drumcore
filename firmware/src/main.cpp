/*
  HelloDrum MIDI-USB - Firmware ESP32-S3

  Fase A: leitura dos 32 canais (4x CD4051) usando a HelloDrum-arduino-Library
  (vendorizada em firmware/lib/HelloDrum-arduino-Library).
  Fase B: envio dos hits via USB-MIDI nativo (classe MIDI USB, TinyUSB), usando
  Adafruit_TinyUSB como transporte da lib MIDI (FortySevenEffects). Ainda sem
  OLED/botoes de configuracao (proxima fase) - ver docs/00-visao-geral.md.

  Pinout usado aqui: ver docs/02-hardware.md (marcado como proposto/a validar
  no hardware real).

  Build: ver firmware/platformio.ini - requer ARDUINO_USB_MODE=0 (modo
  TinyUSB/OTG) e as libs Adafruit TinyUSB Library + FortySevenEffects MIDI
  Library. Ver docs/03-biblioteca-hellodrum.md.
*/

#include <Arduino.h>
#include <Adafruit_TinyUSB.h>
#include <MIDI.h>
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

// Canal MIDI de percussao (GM). Mesma convencao usada nos exemplos originais
// da HelloDrum-arduino-Library.
#define DRUM_MIDI_CHANNEL 10

// Primeira nota MIDI usada (pad 0). Os pads seguintes recebem notas
// consecutivas (36, 37, 38, ...) so para facilitar a identificacao de cada
// canal durante os testes - o mapeamento de notas "de verdade" por
// instrumento entra na fase de configuracao (EEPROM/OLED/app desktop).
#define FIRST_TEST_NOTE 36

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

// Objeto USB-MIDI (TinyUSB) + instancia da lib MIDI (FortySevenEffects) usando
// esse objeto como transporte. A partir daqui usamos a API MIDI.sendNoteOn/Off
// normalmente - o transporte USB fica transparente.
Adafruit_USBD_MIDI usb_midi;
MIDI_CREATE_INSTANCE(Adafruit_USBD_MIDI, usb_midi, MIDI);

void setup()
{
    // Necessario em cores sem begin() automatico do dispositivo USB.
    if (!TinyUSBDevice.isInitialized())
    {
        TinyUSBDevice.begin(0);
    }

    Serial.begin(115200);

    usb_midi.setStringDescriptor("HelloDrum MIDI");

    // MIDI.begin() tambem chama usb_midi.begin() internamente.
    MIDI.begin(MIDI_CHANNEL_OMNI);

    // Se o dispositivo USB ja tinha enumerado antes desse begin() (ex: reset
    // por software), forca reenumeracao para o host reconhecer a classe MIDI.
    if (TinyUSBDevice.mounted())
    {
        TinyUSBDevice.detach();
        delay(10);
        TinyUSBDevice.attach();
    }

    for (byte i = 0; i < NUM_PADS; i++)
    {
        pads[i].note = FIRST_TEST_NOTE + i;
    }

    delay(500);
    Serial.println("HelloDrum - Fase B: USB-MIDI nativo (32 canais, 4x CD4051)");
}

void loop()
{
#ifdef TINYUSB_NEED_POLLING_TASK
    TinyUSBDevice.task();
#endif

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
            Serial.print(") - nota ");
            Serial.print(pads[i].note);
            Serial.print(", velocity: ");
            Serial.println(pads[i].velocity);

            if (TinyUSBDevice.mounted())
            {
                MIDI.sendNoteOn(pads[i].note, pads[i].velocity, DRUM_MIDI_CHANNEL);
                MIDI.sendNoteOff(pads[i].note, 0, DRUM_MIDI_CHANNEL);
            }
        }
    }
}
