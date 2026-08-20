/*
  HelloDrum MIDI-USB - Firmware ESP32-S3

  Fase A: leitura dos 32 canais (4x CD4051) usando a HelloDrum-arduino-Library
  (vendorizada em firmware/lib/HelloDrum-arduino-Library).
  Fase B: envio dos hits via USB-MIDI nativo (classe MIDI USB, TinyUSB), usando
  Adafruit_TinyUSB como transporte da lib MIDI (FortySevenEffects).
  Fase C: tela TFT (ST7735, SPI) + 2 encoders rotativos com chave para navegar
  e editar os parametros de cada pad (sensibilidade, threshold, curva, nota...),
  usando o fluxo de configuracao ja existente na HelloDrum-lib
  (HelloDrumButton::readButton() + HelloDrum::settingEnable()).

  Pinout usado aqui: ver docs/02-hardware.md (marcado como proposto/a validar
  no hardware real).

  Build: ver firmware/platformio.ini - requer ARDUINO_USB_MODE=0 (modo
  TinyUSB/OTG), lib_deps para MIDI/TinyUSB/TFT/encoder. Ver
  docs/03-biblioteca-hellodrum.md e docs/01-decisoes-arquiteturais.md.
*/

#include <Arduino.h>
#include <Adafruit_TinyUSB.h>
#include <MIDI.h>
#include <hellodrum.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <RotaryEncoder.h>

// ---------------------------------------------------------------------------
// Pinout - CD4051 (4x, 32 canais)
// ---------------------------------------------------------------------------
#define MUX_S0 4
#define MUX_S1 5
#define MUX_S2 6

#define MUX0_Z 1
#define MUX1_Z 2
#define MUX2_Z 7
#define MUX3_Z 8

#define NUM_MUX 4
#define PADS_PER_MUX 8
#define NUM_PADS (NUM_MUX * PADS_PER_MUX) // 32

// ---------------------------------------------------------------------------
// Pinout - Tela TFT ST7735 (SPI)
// ---------------------------------------------------------------------------
#define TFT_SCLK 12
#define TFT_MOSI 11
#define TFT_CS 10
#define TFT_DC 9
#define TFT_RST 14
#define TFT_BLK 13

// ---------------------------------------------------------------------------
// Pinout - 2 encoders rotativos com chave
// Encoder 1 (PAD_ENC): seleciona o pad (fora de edicao) / ajusta o valor
// (dentro de edicao) - equivalente aos botoes UP/DOWN da lib. A chave desse
// encoder equivale ao botao EDIT/SET (entra/confirma a edicao do item atual).
// Encoder 2 (ITEM_ENC): seleciona o item/parametro do pad atual - equivalente
// aos botoes NEXT/BACK da lib. A chave desse encoder ainda nao tem funcao
// definida (reservada).
// ---------------------------------------------------------------------------
#define PAD_ENC_A 15
#define PAD_ENC_B 16
#define PAD_ENC_SW 17

#define ITEM_ENC_A 18
#define ITEM_ENC_B 21
#define ITEM_ENC_SW 38

// Canal MIDI de percussao (GM). Mesma convencao usada nos exemplos originais
// da HelloDrum-arduino-Library.
#define DRUM_MIDI_CHANNEL 10

// Primeira nota MIDI usada (pad 0) - so para identificar cada canal nos
// testes iniciais. O usuario pode reatribuir por pad via o menu na tela.
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
// esse objeto como transporte.
Adafruit_USBD_MIDI usb_midi;
MIDI_CREATE_INSTANCE(Adafruit_USBD_MIDI, usb_midi, MIDI);

// Tela TFT (driver ST7735S, variante 1.44" 128x128 - ver Modelo Tela.jpeg).
Adafruit_ST7735 tft(TFT_CS, TFT_DC, TFT_RST);

// button - pinos do construtor nao sao usados (255 = "sem pino"): nao
// chamamos HelloDrumButton::readButtonState() (que leria botoes fisicos
// diretamente), e sim readButton(set, up, down, next, back) manualmente, com
// os valores calculados a partir dos 2 encoders. Ver
// docs/01-decisoes-arquiteturais.md.
HelloDrumButton button(255, 255, 255, 255, 255);

RotaryEncoder padEncoder(PAD_ENC_A, PAD_ENC_B, RotaryEncoder::LatchMode::FOUR3);
RotaryEncoder itemEncoder(ITEM_ENC_A, ITEM_ENC_B, RotaryEncoder::LatchMode::FOUR3);

// settingName() guarda o ponteiro que recebe (nao copia a string), por isso
// precisa apontar para memoria que dura o programa todo - nao para um buffer
// temporario de escopo local. Preenchido em setup().
char padNames[NUM_PADS][8];

long padEncoderLastPos = 0;
long itemEncoderLastPos = 0;

bool padSwLastState = HIGH;
unsigned long padSwLastChangeMs = 0;

void IRAM_ATTR isrPadEncoder()
{
    padEncoder.tick();
}

void IRAM_ATTR isrItemEncoder()
{
    itemEncoder.tick();
}

// Envia um "pulso" de botao para a lib (um dos 5 sinais em LOW por essa unica
// chamada, os outros em HIGH) e deixa cada pad processar esse evento via
// settingEnable() - mesmo padrao dos exemplos originais da HelloDrum-lib, so
// que aqui os sinais vem dos encoders em vez de botoes fisicos.
void processConfigInput(bool set, bool up, bool down, bool next, bool back)
{
    button.readButton(set, up, down, next, back);

    for (byte i = 0; i < NUM_PADS; i++)
    {
        pads[i].settingEnable();
    }
}

// Le os encoders/chave e injeta no maximo 1 evento por chamada (se o encoder
// girou mais de 1 passo entre chamadas, o restante e' processado na proxima
// iteracao do loop() - loop() roda rapido o suficiente pra isso ser
// imperceptivel).
void handleConfigInputs()
{
    long padPos = padEncoder.getPosition();
    if (padPos != padEncoderLastPos)
    {
        bool isUp = padPos > padEncoderLastPos;
        padEncoderLastPos += isUp ? 1 : -1;
        processConfigInput(HIGH, isUp ? LOW : HIGH, isUp ? HIGH : LOW, HIGH, HIGH);
        return;
    }

    long itemPos = itemEncoder.getPosition();
    if (itemPos != itemEncoderLastPos)
    {
        bool isNext = itemPos > itemEncoderLastPos;
        itemEncoderLastPos += isNext ? 1 : -1;
        processConfigInput(HIGH, HIGH, HIGH, isNext ? LOW : HIGH, isNext ? HIGH : LOW);
        return;
    }

    // Chave do encoder de pad/valor = EDIT/SET, com debounce simples.
    bool padSwState = digitalRead(PAD_ENC_SW);
    if (padSwState != padSwLastState && (millis() - padSwLastChangeMs) > 25)
    {
        padSwLastState = padSwState;
        padSwLastChangeMs = millis();

        if (padSwState == LOW)
        {
            processConfigInput(LOW, HIGH, HIGH, HIGH, HIGH);
        }
    }

    // Chave do encoder de item ainda nao tem funcao - so mantemos o estado
    // atualizado (sem debounce dedicado) para nao interferir em nada.
}

// Mostra pad atual / item / valor na tela, com uma mensagem transiente ao
// entrar/sair do modo de edicao (mesmo padrao dos exemplos originais da lib
// com OLED, so que redesenhando a tela toda a cada mudanca).
void renderScreen()
{
    static const char *lastPad = nullptr;
    static const char *lastItem = nullptr;
    static int lastValue = -1;

    if (button.GetEditState())
    {
        tft.fillScreen(ST77XX_BLACK);
        tft.setTextColor(ST77XX_YELLOW);
        tft.setTextSize(2);
        tft.setCursor(10, 55);
        tft.print("EDITAR");
        delay(400); // flash transiente - pausa curta a sensing/MIDI, igual aos exemplos originais da lib
        lastPad = nullptr; // forca redesenho completo depois do flash
    }

    if (button.GetEditdoneState())
    {
        tft.fillScreen(ST77XX_BLACK);
        tft.setTextColor(ST77XX_GREEN);
        tft.setTextSize(2);
        tft.setCursor(20, 55);
        tft.print("OK");
        delay(400);
        lastPad = nullptr;
    }

    const char *padName = button.GetPadName();
    const char *item = button.GetSettingItem();
    int value = button.GetSettingValue();

    if (padName == lastPad && item == lastItem && value == lastValue)
    {
        return; // nada mudou desde o ultimo desenho - evita redesenhar sem necessidade
    }
    lastPad = padName;
    lastItem = item;
    lastValue = value;

    tft.fillScreen(ST77XX_BLACK);

    tft.setTextColor(ST77XX_CYAN);
    tft.setTextSize(2);
    tft.setCursor(4, 8);
    tft.print(padName);

    tft.setTextColor(ST77XX_WHITE);
    tft.setTextSize(1);
    tft.setCursor(4, 40);
    tft.print(item);

    tft.setTextColor(ST77XX_WHITE);
    tft.setTextSize(3);
    tft.setCursor(4, 60);
    tft.print(value);
}

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

        // settingName() tambem incrementa nameIndexMax (global, dentro da
        // lib) - sem chamar isso pra cada pad, a navegacao via encoder fica
        // travada no pad 0 (nameIndexMax ficaria 0). Ver
        // docs/01-decisoes-arquiteturais.md.
        snprintf(padNames[i], sizeof(padNames[i]), "Pad %d", i + 1);
        pads[i].settingName(padNames[i]);
    }

    pinMode(PAD_ENC_SW, INPUT_PULLUP);
    pinMode(ITEM_ENC_SW, INPUT_PULLUP);

    attachInterrupt(digitalPinToInterrupt(PAD_ENC_A), isrPadEncoder, CHANGE);
    attachInterrupt(digitalPinToInterrupt(PAD_ENC_B), isrPadEncoder, CHANGE);
    attachInterrupt(digitalPinToInterrupt(ITEM_ENC_A), isrItemEncoder, CHANGE);
    attachInterrupt(digitalPinToInterrupt(ITEM_ENC_B), isrItemEncoder, CHANGE);

    pinMode(TFT_BLK, OUTPUT);
    digitalWrite(TFT_BLK, HIGH);

    SPI.begin(TFT_SCLK, -1 /* MISO nao usado */, TFT_MOSI, TFT_CS);
    tft.initR(INITR_144GREENTAB); // variante do driver para telas 1.44" 128x128 - validar no hardware real
    tft.setRotation(0);
    tft.fillScreen(ST77XX_BLACK);

    delay(500);
    Serial.println("HelloDrum - Fase C: tela TFT + 2 encoders (32 canais, 4x CD4051, USB-MIDI)");
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

    handleConfigInputs();
    renderScreen();
}
