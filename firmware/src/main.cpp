/*
  DrumCore - Firmware ESP32-S3 (módulo MIDI-USB/BLE para bateria eletrônica)

  Projeto renomeado de "HelloDrum" para "DrumCore" em 2026-08-21 - ver
  docs/01-decisoes-arquiteturais.md. A biblioteca de sensing de terceiros
  (vendorizada em firmware/lib/HelloDrum-arduino-Library) mantém o nome
  original do autor (RyoKosaka) - não é nosso projeto, não renomeamos.

  Fases A-H (leitura de 32 canais, USB-MIDI, EEPROM, protocolo serial, nome
  livre por pad, tipos de sensor, BLE-MIDI): ver histórico em
  docs/CHANGELOG.md e docs/01-decisoes-arquiteturais.md - a base de sensing,
  persistência e protocolo dessas fases continua igual.

  Fase J: navegação/tela redesenhada seguindo o spec de UI em design/SPEC.md
  (produzido com Claude Design) - substitui inteiramente a Fase C/I. Agora
  são 6 telas (BOOT, LIVE, PADS, PAD_EDIT, SIGNAL, GLOBAL) com semântica de
  encoder diferente (ENC1 = página/pad em foco, ENC2 = navegação/valor,
  ambos com gesto de hold 600ms) e persistência explícita (GLOBAL > SALVAR)
  em vez de auto-save a cada edição pelos encoders. Ver
  docs/01-decisoes-arquiteturais.md pro racional completo e as adaptações
  feitas (não tínhamos DIN MIDI, o app desktop continua com auto-save).

  Pinout: ver docs/02-hardware.md. Build: ver firmware/platformio.ini.
*/

#include <Arduino.h>
#include <Adafruit_TinyUSB.h>
#include <MIDI.h>
#include <hellodrum.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <RotaryEncoder.h>
#include <ArduinoJson.h>
#include <BLEMIDI_Transport.h>
#include <hardware/BLEMIDI_ESP32.h>
#include <math.h>

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
// Pinout - 2 encoders rotativos com chave (ENC1 = pagina/pad em foco,
// ENC2 = navegacao/valor - ver design/SPEC.md secao 1).
// ---------------------------------------------------------------------------
#define ENC1_A 15
#define ENC1_B 16
#define ENC1_SW 17

#define ENC2_A 18
#define ENC2_B 21
#define ENC2_SW 38

#define HOLD_MS 600     // duracao de "hold" nos dois encoders (design/SPEC.md)
#define SW_DEBOUNCE_MS 25

// ---------------------------------------------------------------------------
// Paleta (RGB565) - tokens do design/SPEC.md secao 4.
// ---------------------------------------------------------------------------
#define COL_BG 0x10A3
#define COL_SURFACE 0x1925
#define COL_LINE 0x3A09
#define COL_TXT_DIM 0x7C52
#define COL_TXT 0xE77E
#define COL_ACCENT 0x069F
#define COL_EDIT 0xFD84
#define COL_HIT 0xFBC3
#define COL_OK 0x368F

// Canal MIDI de percussao (GM), agora configuravel via GLOBAL > MIDI CH
// (persistido em midiChannel - ver globals mais abaixo). DRUM_MIDI_CHANNEL
// so' e' usado como valor padrao no primeiro boot.
#define DEFAULT_MIDI_CHANNEL 10

// CC usado para a posicao do pedal de chimbal (pad.pedalCC, ja vem 0-127 da
// lib). 4 = "Foot Controller" no GM - ajustar se o software do outro lado
// esperar outro numero de CC.
#define HIHAT_PEDAL_CC 4

// Primeira nota MIDI usada (pad 0) - so para identificar cada canal nos
// testes iniciais. O usuario pode reatribuir por pad via a tela ou o app
// desktop.
#define FIRST_TEST_NOTE 36

// Nome livre por pad (ex: "Caixa"), editavel so pelo app desktop (nao entra
// no fluxo dos encoders/TFT) - ver docs/01-decisoes-arquiteturais.md. O
// numero do pad nunca e' editavel: o nome exibido e' sempre "N - Label", ou
// "Pad N" enquanto nao houver label definido.
#define PAD_LABEL_MAX_LEN 20                     // "Chimbal Aberto" etc + '\0'
#define PAD_NAME_MAX_LEN (PAD_LABEL_MAX_LEN + 8) // "32 - " + label + margem

// ---------------------------------------------------------------------------
// Tipos de sensor por pad (Fase G) - ver docs/05-tipos-de-sensor.md pro
// detalhamento de cada tipo (campos usados, canais consumidos, etc). Nenhum
// tipo dessa lib usa mais de 2 canais - o construtor de HelloDrum so aceita
// 1 ou 2 pinos.
// ---------------------------------------------------------------------------
#define PAD_SINGLE 0        // 1 canal - pad/prato simples
#define PAD_DUAL 1          // 2 canais - pad com aro (head + rim)
#define PAD_HIHAT_SINGLE 2  // 1 canal - chimbal simples (nota muda com open/close do pedal linkado)
#define PAD_CYMBAL_2ZONE 3  // 2 canais - prato 2 zonas (bow + edge)
#define PAD_HIHAT_2ZONE 4   // 2 canais - chimbal 2 zonas (bow + edge, nota muda com open/close)
#define PAD_CYMBAL_3ZONE 5  // 2 canais - prato 3 zonas (bow + edge/cup por threshold, ex: PCY135/155)
#define PAD_HIHAT_PEDAL 6   // 1 canal - controlador de pedal FSR/VH-10/VH-11
#define PAD_HIHAT_OPTICAL 7 // 1 canal - controlador de pedal optico (TCRT5000)
#define PAD_TYPE_COUNT 8

#define PAD_NO_LINK 255 // valor "nenhum" para hihatPedalChannel[]

bool padTypeUsesSecondChannel(byte type)
{
    return type == PAD_DUAL || type == PAD_CYMBAL_2ZONE || type == PAD_HIHAT_2ZONE || type == PAD_CYMBAL_3ZONE;
}

bool padTypeIsHihatCymbal(byte type)
{
    return type == PAD_HIHAT_SINGLE || type == PAD_HIHAT_2ZONE;
}

bool padTypeIsHihatPedal(byte type)
{
    return type == PAD_HIHAT_PEDAL || type == PAD_HIHAT_OPTICAL;
}

const char *padTypeShortName(byte type)
{
    switch (type)
    {
    case PAD_SINGLE:
        return "PIEZO";
    case PAD_DUAL:
        return "DUAL";
    case PAD_HIHAT_SINGLE:
        return "HH-1Z";
    case PAD_CYMBAL_2ZONE:
        return "CY-2Z";
    case PAD_HIHAT_2ZONE:
        return "HH-2Z";
    case PAD_CYMBAL_3ZONE:
        return "CY-3Z";
    case PAD_HIHAT_PEDAL:
        return "HH-CTL";
    case PAD_HIHAT_OPTICAL:
        return "HH-OPT";
    default:
        return "?";
    }
}

// ---------------------------------------------------------------------------
// Saida MIDI - GLOBAL > SAIDA. O design original (design/SPEC.md) previa
// USB/DIN/USB+DIN, mas nao temos circuito de MIDI DIN (5 pinos) no
// hardware - adaptamos pra USB/BLE/USB+BLE, os dois transportes que
// realmente existem (Fase B e H). Ver docs/01-decisoes-arquiteturais.md.
// ---------------------------------------------------------------------------
#define OUTPUT_USB 0
#define OUTPUT_BLE 1
#define OUTPUT_USB_BLE 2

// ---------------------------------------------------------------------------
// EEPROM (persistencia)
// Layout: 10 bytes/pad (campos da lib) + 1 byte flag primeiro-boot +
// PAD_LABEL_MAX_LEN bytes/pad (nome) + 1 byte/pad (tipo) + 1 byte/pad
// (link do pedal de chimbal) + 3 bytes de config global (midi_channel,
// midi_output, brightness).
// ---------------------------------------------------------------------------
#define EEPROM_BYTES_PER_PAD 10
#define EEPROM_INIT_FLAG_ADDR (NUM_PADS * EEPROM_BYTES_PER_PAD)
#define EEPROM_NAMES_ADDR (EEPROM_INIT_FLAG_ADDR + 1)
#define EEPROM_TYPES_ADDR (EEPROM_NAMES_ADDR + NUM_PADS * PAD_LABEL_MAX_LEN)
#define EEPROM_HIHAT_LINK_ADDR (EEPROM_TYPES_ADDR + NUM_PADS)
#define EEPROM_GLOBAL_ADDR (EEPROM_HIHAT_LINK_ADDR + NUM_PADS)
#define EEPROM_SIZE (EEPROM_GLOBAL_ADDR + 3)
#define EEPROM_INIT_MAGIC 0xA5

#define padLabelEepromAddr(i) (EEPROM_NAMES_ADDR + (i) * PAD_LABEL_MAX_LEN)

// Cada HelloDrumMUX_4051 recebe um muxNum sequencial automatico (0..3, na
// ordem de instanciacao abaixo). Ver docs/01-decisoes-arquiteturais.md.
HelloDrumMUX_4051 mux[NUM_MUX] = {
    HelloDrumMUX_4051(MUX_S0, MUX_S1, MUX_S2, MUX0_Z),
    HelloDrumMUX_4051(MUX_S0, MUX_S1, MUX_S2, MUX1_Z),
    HelloDrumMUX_4051(MUX_S0, MUX_S1, MUX_S2, MUX2_Z),
    HelloDrumMUX_4051(MUX_S0, MUX_S1, MUX_S2, MUX3_Z),
};

// pads[i] usa i diretamente como indice em rawValue[] (pin_1), pois os 4 MUX
// acima sao instanciados em ordem (muxNum 0..3) e i == muxNum*PADS_PER_MUX +
// canal. Cada pad e' construido com 2 pinos (i, i+1) quando i+1 existe -
// assim um mesmo objeto ja suporta ser usado como single-channel (metodos
// que so leem pin_1) OU dual-channel (metodos que tambem leem pin_2), sem
// precisar reconstruir nada quando o tipo do pad muda em runtime.
HelloDrum pads[NUM_PADS] = {
    HelloDrum(0, 1),   HelloDrum(1, 2),   HelloDrum(2, 3),   HelloDrum(3, 4),
    HelloDrum(4, 5),   HelloDrum(5, 6),   HelloDrum(6, 7),   HelloDrum(7, 8),
    HelloDrum(8, 9),   HelloDrum(9, 10),  HelloDrum(10, 11), HelloDrum(11, 12),
    HelloDrum(12, 13), HelloDrum(13, 14), HelloDrum(14, 15), HelloDrum(15, 16),
    HelloDrum(16, 17), HelloDrum(17, 18), HelloDrum(18, 19), HelloDrum(19, 20),
    HelloDrum(20, 21), HelloDrum(21, 22), HelloDrum(22, 23), HelloDrum(23, 24),
    HelloDrum(24, 25), HelloDrum(25, 26), HelloDrum(26, 27), HelloDrum(27, 28),
    HelloDrum(28, 29), HelloDrum(29, 30), HelloDrum(30, 31), HelloDrum(31),
};

// Objeto USB-MIDI (TinyUSB) + instancia da lib MIDI (FortySevenEffects) usando
// esse objeto como transporte.
Adafruit_USBD_MIDI usb_midi;
MIDI_CREATE_INSTANCE(Adafruit_USBD_MIDI, usb_midi, MIDI);

// Instancia BLE-MIDI (Fase H) - transporte adicional, em paralelo ao
// USB-MIDI acima. "BleMidi" e' a interface MIDI (usada pra enviar
// notas/CC); a macro tambem gera "BLEBleMidi" (o transporte, usado so pra
// registrar os callbacks de conexao). "DrumCore" e' o nome anunciado via
// Bluetooth.
BLEMIDI_CREATE_INSTANCE("DrumCore", BleMidi)

volatile bool bleMidiConnected = false;

// Tela TFT (driver ST7735S, variante 1.44" 128x128 - ver Modelo Tela.jpeg).
Adafruit_ST7735 tft(TFT_CS, TFT_DC, TFT_RST);

RotaryEncoder enc1(ENC1_A, ENC1_B, RotaryEncoder::LatchMode::FOUR3);
RotaryEncoder enc2(ENC2_A, ENC2_B, RotaryEncoder::LatchMode::FOUR3);

void IRAM_ATTR isrEnc1()
{
    enc1.tick();
}

void IRAM_ATTR isrEnc2()
{
    enc2.tick();
}

// padLabels[i]: texto livre editavel (ex: "Caixa"), vazio por padrao.
// padNames[i]: nome exibido de fato ("N - Label" ou "Pad N" sem label).
char padLabels[NUM_PADS][PAD_LABEL_MAX_LEN];
char padNames[NUM_PADS][PAD_NAME_MAX_LEN];

// padTypes[i]: tipo de sensor desse canal. hihatPedalChannel[i]: canal do
// pedal de chimbal linkado (so' relevante pra tipos hihat cymbal).
// channelPrimary[i]: false se esse canal e' o "segundo canal" de um pad de
// 2 canais no slot anterior - nesse caso nao e' sensoreado nem aparece como
// pad independente. Ver docs/01-decisoes-arquiteturais.md.
byte padTypes[NUM_PADS];
byte hihatPedalChannel[NUM_PADS];
bool channelPrimary[NUM_PADS];

// Configuracao global (GLOBAL) - persistida como um bloco pequeno em EEPROM.
byte midiChannel = DEFAULT_MIDI_CHANNEL;
byte midiOutput = OUTPUT_USB_BLE;
byte brightness = 80; // %

// true se ha mudancas em RAM ainda nao gravadas via GLOBAL > SALVAR (o
// design pede persistencia so explicita pelos encoders - ver
// docs/01-decisoes-arquiteturais.md). O protocolo serial (app desktop)
// continua salvando a cada set_pad, sem depender dessa flag.
bool unsavedChanges = false;

void recomputeChannelPrimary()
{
    for (byte i = 0; i < NUM_PADS; i++)
    {
        if (i == 0)
        {
            channelPrimary[i] = true;
        }
        else
        {
            channelPrimary[i] = !(channelPrimary[i - 1] && padTypeUsesSecondChannel(padTypes[i - 1]));
        }
    }
}

void rebuildPadName(byte i)
{
    if (padLabels[i][0] == '\0')
    {
        snprintf(padNames[i], PAD_NAME_MAX_LEN, "Pad %d", i + 1);
    }
    else
    {
        snprintf(padNames[i], PAD_NAME_MAX_LEN, "%d - %s", i + 1, padLabels[i]);
    }
}

#define TFT_BLK_PWM_CHANNEL 0

void applyBrightness()
{
    ledcWrite(TFT_BLK_PWM_CHANNEL, map(brightness, 0, 100, 0, 255));
}

// ---------------------------------------------------------------------------
// Sistema de campos por pad (Fase J) - equivalente ao PAD_TYPE_META do app
// desktop (desktop-app/src/renderer/src/protocol.ts), so' que descrevendo
// como ler/escrever cada campo diretamente nos membros publicos de
// HelloDrum (sem passar por HelloDrumButton::readButton()/settingEnable() -
// aquele fluxo nao dava pra mapear pra essa navegacao nova, ver
// docs/01-decisoes-arquiteturais.md). O numero de campos varia por tipo -
// por isso a tela PAD_EDIT rola quando passa de 7 linhas (o design previu
// 7 fixos, mas prato 3 zonas por exemplo tem mais que isso).
// ---------------------------------------------------------------------------
enum FieldId
{
    FIELD_SENSOR,
    FIELD_SENSITIVITY,
    FIELD_THRESHOLD,
    FIELD_SCAN,
    FIELD_MASK,
    FIELD_RIM_SENS,
    FIELD_RIM_THRESH,
    FIELD_CURVE,
    FIELD_NOTE,
    FIELD_NOTE_RIM,
    FIELD_NOTE_CUP,
    FIELD_PEDAL_LINK,
};

struct FieldDef
{
    FieldId id;
    const char *label;
    int minVal;
    int maxVal;
    bool accelerates; // true pros campos 1-127 (design/SPEC.md: acelera >8 detents/s)
};

#define MAX_FIELDS_PER_PAD 12

byte getFieldsForType(byte padType, FieldDef *out)
{
    byte n = 0;
    out[n++] = {FIELD_SENSOR, "SENSOR", 0, PAD_TYPE_COUNT - 1, false};
    out[n++] = {FIELD_SENSITIVITY, "SENSIB", 1, 100, true};
    out[n++] = {FIELD_THRESHOLD, "THRESH", 1, 100, true};
    out[n++] = {FIELD_SCAN, "SCAN", 1, 100, true};
    out[n++] = {FIELD_MASK, "MASK", 1, 100, true};

    if (padType == PAD_DUAL)
    {
        out[n++] = {FIELD_RIM_SENS, "R.SENS", 1, 100, true};
        out[n++] = {FIELD_RIM_THRESH, "R.THRE", 1, 100, true};
    }
    else if (padType == PAD_CYMBAL_2ZONE || padType == PAD_HIHAT_2ZONE)
    {
        out[n++] = {FIELD_RIM_SENS, "EDGETHR", 1, 100, true};
    }
    else if (padType == PAD_CYMBAL_3ZONE)
    {
        out[n++] = {FIELD_RIM_SENS, "EDGETHR", 1, 100, true};
        out[n++] = {FIELD_RIM_THRESH, "CUPTHR", 1, 100, true};
    }
    else if (padTypeIsHihatPedal(padType))
    {
        out[n++] = {FIELD_RIM_SENS, "PEDSENS", 1, 100, true};
    }

    out[n++] = {FIELD_CURVE, "CURVA", 0, 4, false};
    out[n++] = {FIELD_NOTE, "NOTA", 0, 127, true};

    if (padType == PAD_DUAL)
    {
        out[n++] = {FIELD_NOTE_RIM, "N.RIM", 0, 127, true};
    }
    else if (padType == PAD_CYMBAL_2ZONE)
    {
        out[n++] = {FIELD_NOTE_RIM, "N.EDGE", 0, 127, true};
    }
    else if (padType == PAD_HIHAT_SINGLE || padType == PAD_HIHAT_2ZONE)
    {
        out[n++] = {FIELD_NOTE_RIM, "N.FECH", 0, 127, true};
    }
    else if (padType == PAD_CYMBAL_3ZONE)
    {
        out[n++] = {FIELD_NOTE_RIM, "N.EDGE", 0, 127, true};
        out[n++] = {FIELD_NOTE_CUP, "N.CUP", 0, 127, true};
    }

    if (padTypeIsHihatCymbal(padType))
    {
        out[n++] = {FIELD_PEDAL_LINK, "PEDAL", -1, NUM_PADS - 1, false};
    }

    return n;
}

int getFieldValue(byte padIndex, FieldId id)
{
    HelloDrum &p = pads[padIndex];
    switch (id)
    {
    case FIELD_SENSOR:
        return padTypes[padIndex];
    case FIELD_SENSITIVITY:
        return p.sensitivity;
    case FIELD_THRESHOLD:
        return p.threshold1;
    case FIELD_SCAN:
        return p.scantime;
    case FIELD_MASK:
        return p.masktime;
    case FIELD_RIM_SENS:
        return p.rimSensitivity;
    case FIELD_RIM_THRESH:
        return p.rimThreshold;
    case FIELD_CURVE:
        return p.curvetype;
    case FIELD_NOTE:
        return p.note;
    case FIELD_NOTE_RIM:
        return p.noteRim;
    case FIELD_NOTE_CUP:
        return p.noteCup;
    case FIELD_PEDAL_LINK:
        return hihatPedalChannel[padIndex] == PAD_NO_LINK ? -1 : hihatPedalChannel[padIndex];
    }
    return 0;
}

// Aplica so' em RAM (o design pede persistencia explicita via GLOBAL >
// SALVAR pros encoders/tela - ver docs/01-decisoes-arquiteturais.md). O
// protocolo serial tem seu proprio caminho de escrita (handleSetPad) que
// continua salvando na hora, pro app desktop.
void setFieldValue(byte padIndex, FieldId id, int value)
{
    HelloDrum &p = pads[padIndex];
    switch (id)
    {
    case FIELD_SENSOR:
        if (padTypeUsesSecondChannel((byte)value) && padIndex >= NUM_PADS - 1)
        {
            return; // sem 2o canal disponivel pro ultimo pad
        }
        padTypes[padIndex] = (byte)value;
        recomputeChannelPrimary();
        break;
    case FIELD_SENSITIVITY:
        p.sensitivity = value;
        break;
    case FIELD_THRESHOLD:
        p.threshold1 = value;
        break;
    case FIELD_SCAN:
        p.scantime = value;
        break;
    case FIELD_MASK:
        p.masktime = value;
        break;
    case FIELD_RIM_SENS:
        p.rimSensitivity = value;
        break;
    case FIELD_RIM_THRESH:
        p.rimThreshold = value;
        break;
    case FIELD_CURVE:
        p.curvetype = value;
        break;
    case FIELD_NOTE:
        p.note = value;
        p.noteOpen = value;
        break;
    case FIELD_NOTE_RIM:
        p.noteRim = value;
        p.noteEdge = value;
        p.noteClose = value;
        p.noteOpenEdge = value;
        break;
    case FIELD_NOTE_CUP:
        p.noteCup = value;
        p.noteCloseEdge = value;
        p.noteCross = value;
        break;
    case FIELD_PEDAL_LINK:
        hihatPedalChannel[padIndex] = value < 0 ? PAD_NO_LINK : (byte)value;
        break;
    }
    unsavedChanges = true;
}

// ---------------------------------------------------------------------------
// Maquina de estados de tela (Fase J) - ver design/SPEC.md secao 2.
// ---------------------------------------------------------------------------
enum ScreenPage
{
    PAGE_BOOT,
    PAGE_LIVE,
    PAGE_PADS,
    PAGE_PAD_EDIT,
    PAGE_SIGNAL,
    PAGE_GLOBAL,
};

ScreenPage currentPage = PAGE_BOOT;
bool forceScreenRedraw = true;

byte padsListSelection = 0; // 0-31, pad selecionado na lista PADS
byte padsListTop = 0;       // primeira linha visivel (janela de 8)

byte editPadIndex = 0;  // pad em foco em PAD_EDIT/SIGNAL
byte editItemIndex = 0; // item selecionado dentro de PAD_EDIT
bool editingValue = false;

byte globalSelection = 0; // 0..4 (MIDI CH, SAIDA, BRILHO, SALVAR, RESTAURAR)
bool globalEditing = false;

#define GLOBAL_ROW_MIDI_CH 0
#define GLOBAL_ROW_OUTPUT 1
#define GLOBAL_ROW_BRIGHTNESS 2
#define GLOBAL_ROW_SAVE 3
#define GLOBAL_ROW_RESTORE 4
#define GLOBAL_ROW_COUNT 5

char toastLine1[16] = "";
char toastLine2[24] = "";
unsigned long toastUntilMs = 0;

// Buffer do envelope mostrado em SIGNAL - ver renderSignal(). Simplificacao
// deliberada: e' uma janela deslizante continua do rawValue do pad em foco
// (nao um recorte alinhado exatamente ao scan/mask de um hit especifico) -
// ver docs/01-decisoes-arquiteturais.md.
#define SIGNAL_BUFFER_LEN 120
int signalBuffer[SIGNAL_BUFFER_LEN] = {0};
byte signalBufferPos = 0;
int signalPeak = 0;
bool signalNeedsRedraw = true;

// ---------------------------------------------------------------------------
// Protocolo serial (NDJSON) com o app desktop - Fase E-H. Ver
// docs/04-protocolo-serial.md pro contrato completo (comandos/eventos).
// ---------------------------------------------------------------------------

void sendJsonLine(JsonDocument &doc)
{
    serializeJson(doc, Serial);
    Serial.println();
}

void sendLog(const char *message)
{
    JsonDocument doc;
    doc["type"] = "log";
    doc["message"] = message;
    sendJsonLine(doc);
}

void sendError(const char *cmd, const char *message)
{
    JsonDocument doc;
    doc["type"] = "error";
    doc["cmd"] = cmd;
    doc["message"] = message;
    sendJsonLine(doc);
}

void sendAck(const char *cmd, int pad, const char *field, long value)
{
    JsonDocument doc;
    doc["type"] = "ack";
    doc["cmd"] = cmd;
    doc["pad"] = pad;
    doc["field"] = field;
    doc["value"] = value;
    sendJsonLine(doc);
}

// zone: "bow" (padrao/unico zone), "rim", "edge", "cup", "pedal" ou "choke".
void sendHitEvent(byte padIndex, const char *zone, byte note, byte velocity)
{
    JsonDocument doc;
    doc["type"] = "hit";
    doc["pad"] = padIndex;
    doc["zone"] = zone;
    doc["note"] = note;
    doc["velocity"] = velocity;
    sendJsonLine(doc);
}

void sendDeviceInfo()
{
    JsonDocument doc;
    doc["type"] = "device_info";
    doc["pads"] = NUM_PADS;
    doc["muxes"] = NUM_MUX;
    doc["midi_channel"] = midiChannel;
    doc["midi_output"] = midiOutput;
    doc["brightness"] = brightness;
    doc["ble_connected"] = bleMidiConnected;
    doc["firmware_phase"] = "J";
    sendJsonLine(doc);
}

// Callbacks do BLE-MIDI - chamados pela stack BLE (Bluedroid, roda numa
// task propria) quando um central conecta/desconecta. Reenviam device_info
// pra o app saber do novo estado sem precisar dar poll.
void onBleMidiConnected()
{
    bleMidiConnected = true;
    sendLog("BLE-MIDI: dispositivo pareado.");
    sendDeviceInfo();
}

void onBleMidiDisconnected()
{
    bleMidiConnected = false;
    sendLog("BLE-MIDI: dispositivo desconectado.");
    sendDeviceInfo();
}

void sendPadConfig(byte padIndex)
{
    JsonDocument doc;
    doc["type"] = "pad_config";
    doc["pad"] = padIndex;
    doc["primary"] = channelPrimary[padIndex];

    if (!channelPrimary[padIndex])
    {
        doc["consumed_by"] = padIndex - 1;
        sendJsonLine(doc);
        return;
    }

    doc["pad_type"] = padTypes[padIndex];
    doc["uses_second_channel"] = padTypeUsesSecondChannel(padTypes[padIndex]);
    doc["name"] = padNames[padIndex];
    doc["label"] = padLabels[padIndex];
    doc["sensitivity"] = pads[padIndex].sensitivity;
    doc["threshold"] = pads[padIndex].threshold1;
    doc["scan_time"] = pads[padIndex].scantime;
    doc["mask_time"] = pads[padIndex].masktime;
    doc["curve_type"] = pads[padIndex].curvetype;
    doc["rim_sensitivity"] = pads[padIndex].rimSensitivity;
    doc["rim_threshold"] = pads[padIndex].rimThreshold;
    doc["note"] = pads[padIndex].note;
    doc["note_rim"] = pads[padIndex].noteRim;
    doc["note_cup"] = pads[padIndex].noteCup;
    doc["hihat_pedal_channel"] = hihatPedalChannel[padIndex] == PAD_NO_LINK ? -1 : hihatPedalChannel[padIndex];
    sendJsonLine(doc);
}

void persistPadType(byte i)
{
    EEPROM_ESP.write(EEPROM_TYPES_ADDR + i, padTypes[i]);
    EEPROM_ESP.commit();
}

void persistHihatLink(byte i)
{
    EEPROM_ESP.write(EEPROM_HIHAT_LINK_ADDR + i, hihatPedalChannel[i]);
    EEPROM_ESP.commit();
}

void saveAllToEeprom()
{
    for (byte i = 0; i < NUM_PADS; i++)
    {
        pads[i].initMemory();
        EEPROM_ESP.writeBytes(padLabelEepromAddr(i), padLabels[i], PAD_LABEL_MAX_LEN);
        EEPROM_ESP.write(EEPROM_TYPES_ADDR + i, padTypes[i]);
        EEPROM_ESP.write(EEPROM_HIHAT_LINK_ADDR + i, hihatPedalChannel[i]);
    }
    EEPROM_ESP.write(EEPROM_GLOBAL_ADDR, midiChannel);
    EEPROM_ESP.write(EEPROM_GLOBAL_ADDR + 1, midiOutput);
    EEPROM_ESP.write(EEPROM_GLOBAL_ADDR + 2, brightness);
    EEPROM_ESP.commit();
    unsavedChanges = false;
}

void loadAllFromEeprom()
{
    for (byte i = 0; i < NUM_PADS; i++)
    {
        pads[i].loadMemory();
        EEPROM_ESP.readBytes(padLabelEepromAddr(i), padLabels[i], PAD_LABEL_MAX_LEN);
        padLabels[i][PAD_LABEL_MAX_LEN - 1] = '\0';
        padTypes[i] = EEPROM_ESP.read(EEPROM_TYPES_ADDR + i);
        if (padTypes[i] >= PAD_TYPE_COUNT)
        {
            padTypes[i] = PAD_SINGLE;
        }
        hihatPedalChannel[i] = EEPROM_ESP.read(EEPROM_HIHAT_LINK_ADDR + i);
        rebuildPadName(i);
    }
    recomputeChannelPrimary();

    midiChannel = EEPROM_ESP.read(EEPROM_GLOBAL_ADDR);
    if (midiChannel < 1 || midiChannel > 16)
    {
        midiChannel = DEFAULT_MIDI_CHANNEL;
    }
    midiOutput = EEPROM_ESP.read(EEPROM_GLOBAL_ADDR + 1);
    if (midiOutput > OUTPUT_USB_BLE)
    {
        midiOutput = OUTPUT_USB_BLE;
    }
    brightness = EEPROM_ESP.read(EEPROM_GLOBAL_ADDR + 2);
    if (brightness < 10 || brightness > 100)
    {
        brightness = 80;
    }
    applyBrightness();
    unsavedChanges = false;
}

// Aplica um campo de configuracao a um pad via o PROTOCOLO SERIAL. Esse
// caminho e' independente de setFieldValue() (usado pelos encoders/tela) e
// continua salvando a cada mudanca - o app desktop nao tem um botao
// "salvar" equivalente ao GLOBAL do hardware, ver
// docs/01-decisoes-arquiteturais.md.
void handleSetPad(JsonDocument &doc)
{
    int pad = doc["pad"] | -1;
    const char *field = doc["field"] | "";

    if (pad < 0 || pad >= NUM_PADS)
    {
        sendError("set_pad", "invalid_pad");
        return;
    }

    if (!channelPrimary[pad])
    {
        sendError("set_pad", "channel_consumed");
        return;
    }

    if (strcmp(field, "label") == 0)
    {
        const char *label = doc["value"] | "";
        if (strlen(label) >= PAD_LABEL_MAX_LEN)
        {
            sendError("set_pad", "value_too_long");
            return;
        }

        strncpy(padLabels[pad], label, PAD_LABEL_MAX_LEN - 1);
        padLabels[pad][PAD_LABEL_MAX_LEN - 1] = '\0';
        rebuildPadName(pad);

        EEPROM_ESP.writeBytes(padLabelEepromAddr(pad), padLabels[pad], PAD_LABEL_MAX_LEN);
        EEPROM_ESP.commit();

        sendPadConfig(pad);
        return;
    }

    if (strcmp(field, "pad_type") == 0)
    {
        long newType = doc["value"] | -1;
        if (newType < 0 || newType >= PAD_TYPE_COUNT)
        {
            sendError("set_pad", "value_out_of_range");
            return;
        }
        if (padTypeUsesSecondChannel((byte)newType) && pad >= NUM_PADS - 1)
        {
            sendError("set_pad", "no_second_channel");
            return;
        }

        padTypes[pad] = (byte)newType;
        recomputeChannelPrimary();
        persistPadType(pad);

        sendPadConfig(pad);
        if (pad + 1 < NUM_PADS)
        {
            sendPadConfig(pad + 1);
        }
        return;
    }

    if (strcmp(field, "hihat_pedal_channel") == 0)
    {
        long linkTo = doc["value"] | -1;

        if (linkTo < 0)
        {
            hihatPedalChannel[pad] = PAD_NO_LINK;
        }
        else if (linkTo >= NUM_PADS || !padTypeIsHihatPedal(padTypes[(byte)linkTo]))
        {
            sendError("set_pad", "invalid_pedal_channel");
            return;
        }
        else
        {
            hihatPedalChannel[pad] = (byte)linkTo;
        }

        persistHihatLink(pad);
        sendPadConfig(pad);
        return;
    }

    long value = doc["value"] | -1;

    if (strcmp(field, "sensitivity") == 0)
    {
        if (value < 0 || value > 100) { sendError("set_pad", "value_out_of_range"); return; }
        pads[pad].sensitivity = value;
    }
    else if (strcmp(field, "threshold") == 0)
    {
        if (value < 0 || value > 100) { sendError("set_pad", "value_out_of_range"); return; }
        pads[pad].threshold1 = value;
    }
    else if (strcmp(field, "scan_time") == 0)
    {
        if (value < 0 || value > 100) { sendError("set_pad", "value_out_of_range"); return; }
        pads[pad].scantime = value;
    }
    else if (strcmp(field, "mask_time") == 0)
    {
        if (value < 0 || value > 100) { sendError("set_pad", "value_out_of_range"); return; }
        pads[pad].masktime = value;
    }
    else if (strcmp(field, "curve_type") == 0)
    {
        if (value < 0 || value > 4) { sendError("set_pad", "value_out_of_range"); return; }
        pads[pad].curvetype = value;
    }
    else if (strcmp(field, "rim_sensitivity") == 0)
    {
        if (value < 0 || value > 100) { sendError("set_pad", "value_out_of_range"); return; }
        pads[pad].rimSensitivity = value;
    }
    else if (strcmp(field, "rim_threshold") == 0)
    {
        if (value < 0 || value > 100) { sendError("set_pad", "value_out_of_range"); return; }
        pads[pad].rimThreshold = value;
    }
    else if (strcmp(field, "note") == 0)
    {
        if (value < 0 || value > 127) { sendError("set_pad", "value_out_of_range"); return; }
        pads[pad].note = value;
        pads[pad].noteOpen = value;
    }
    else if (strcmp(field, "note_rim") == 0)
    {
        if (value < 0 || value > 127) { sendError("set_pad", "value_out_of_range"); return; }
        pads[pad].noteRim = value;
        pads[pad].noteEdge = value;
        pads[pad].noteClose = value;
        pads[pad].noteOpenEdge = value;
    }
    else if (strcmp(field, "note_cup") == 0)
    {
        if (value < 0 || value > 127) { sendError("set_pad", "value_out_of_range"); return; }
        pads[pad].noteCup = value;
        pads[pad].noteCloseEdge = value;
        pads[pad].noteCross = value;
    }
    else
    {
        sendError("set_pad", "unknown_field");
        return;
    }

    pads[pad].initMemory();
    sendAck("set_pad", pad, field, value);
}

void handleSetGlobal(JsonDocument &doc)
{
    const char *field = doc["field"] | "";
    long value = doc["value"] | -1;

    if (strcmp(field, "midi_channel") == 0)
    {
        if (value < 1 || value > 16) { sendError("set_global", "value_out_of_range"); return; }
        midiChannel = value;
    }
    else if (strcmp(field, "midi_output") == 0)
    {
        if (value < 0 || value > OUTPUT_USB_BLE) { sendError("set_global", "value_out_of_range"); return; }
        midiOutput = value;
    }
    else if (strcmp(field, "brightness") == 0)
    {
        if (value < 10 || value > 100) { sendError("set_global", "value_out_of_range"); return; }
        brightness = value;
        applyBrightness();
    }
    else
    {
        sendError("set_global", "unknown_field");
        return;
    }

    EEPROM_ESP.write(EEPROM_GLOBAL_ADDR, midiChannel);
    EEPROM_ESP.write(EEPROM_GLOBAL_ADDR + 1, midiOutput);
    EEPROM_ESP.write(EEPROM_GLOBAL_ADDR + 2, brightness);
    EEPROM_ESP.commit();

    sendAck("set_global", -1, field, value);
    sendDeviceInfo();
}

void handleSerialCommand(const String &line)
{
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, line);
    if (err)
    {
        sendError("?", "invalid_json");
        return;
    }

    const char *cmd = doc["cmd"] | "";

    if (strcmp(cmd, "ping") == 0)
    {
        JsonDocument res;
        res["type"] = "pong";
        sendJsonLine(res);
    }
    else if (strcmp(cmd, "get_device_info") == 0)
    {
        sendDeviceInfo();
    }
    else if (strcmp(cmd, "get_pad") == 0)
    {
        int pad = doc["pad"] | -1;
        if (pad < 0 || pad >= NUM_PADS)
        {
            sendError(cmd, "invalid_pad");
            return;
        }
        sendPadConfig(pad);
    }
    else if (strcmp(cmd, "get_all_pads") == 0)
    {
        for (byte i = 0; i < NUM_PADS; i++)
        {
            sendPadConfig(i);
        }
    }
    else if (strcmp(cmd, "set_pad") == 0)
    {
        handleSetPad(doc);
    }
    else if (strcmp(cmd, "set_global") == 0)
    {
        handleSetGlobal(doc);
    }
    else if (strcmp(cmd, "save_all") == 0)
    {
        saveAllToEeprom();
        sendLog("Configuracao salva (save_all).");
        sendDeviceInfo();
    }
    else if (strcmp(cmd, "restore_all") == 0)
    {
        loadAllFromEeprom();
        for (byte i = 0; i < NUM_PADS; i++)
        {
            sendPadConfig(i);
        }
        sendLog("Configuracao restaurada (restore_all).");
        sendDeviceInfo();
    }
    else
    {
        sendError(cmd, "unknown_cmd");
    }
}

// Leitura nao-bloqueante: acumula ate '\n' e so entao processa - nunca usar
// algo como Serial.readStringUntil() com timeout aqui, pausaria o
// sensing/MIDI a cada chamada.
String serialLineBuffer;

void pollSerialCommands()
{
    while (Serial.available())
    {
        char c = Serial.read();
        if (c == '\n')
        {
            serialLineBuffer.trim();
            if (serialLineBuffer.length() > 0)
            {
                handleSerialCommand(serialLineBuffer);
            }
            serialLineBuffer = "";
        }
        else if (c != '\r')
        {
            serialLineBuffer += c;
            if (serialLineBuffer.length() > 256)
            {
                serialLineBuffer = "";
            }
        }
    }
}

void fireNote(byte note, byte velocity)
{
    if ((midiOutput == OUTPUT_USB || midiOutput == OUTPUT_USB_BLE) && TinyUSBDevice.mounted())
    {
        MIDI.sendNoteOn(note, velocity, midiChannel);
        MIDI.sendNoteOff(note, 0, midiChannel);
    }

    if ((midiOutput == OUTPUT_BLE || midiOutput == OUTPUT_USB_BLE) && bleMidiConnected)
    {
        BleMidi.sendNoteOn(note, velocity, midiChannel);
        BleMidi.sendNoteOff(note, 0, midiChannel);
    }
}

void fireControlChange(byte cc, byte value)
{
    if ((midiOutput == OUTPUT_USB || midiOutput == OUTPUT_USB_BLE) && TinyUSBDevice.mounted())
    {
        MIDI.sendControlChange(cc, value, midiChannel);
    }

    if ((midiOutput == OUTPUT_BLE || midiOutput == OUTPUT_USB_BLE) && bleMidiConnected)
    {
        BleMidi.sendControlChange(cc, value, midiChannel);
    }
}

#define PAD_FLASH_MS 60  // design/SPEC.md: solido 0-60ms
#define PAD_DECAY_MS 180 // ...decaindo (borda) ate 180ms

unsigned long padHitAtMs[NUM_PADS] = {0};

// Le o resultado do metodo de sensing ja chamado pra esse pad (ver
// dispatchSensing()) e decide o que enviar via hit/MIDI, de acordo com o
// pad_type. Ver docs/05-tipos-de-sensor.md.
void handlePadResult(byte i)
{
    HelloDrum &pad = pads[i];
    byte type = padTypes[i];

    if (pad.hit || pad.hitRim || pad.hitCup)
    {
        padHitAtMs[i] = millis();
    }

    switch (type)
    {
    case PAD_SINGLE:
    {
        if (!pad.hit)
        {
            break;
        }
        sendHitEvent(i, "bow", pad.note, pad.velocity);
        fireNote(pad.note, pad.velocity);
        break;
    }

    case PAD_HIHAT_SINGLE:
    {
        if (!pad.hit)
        {
            break;
        }
        byte pedalCh = hihatPedalChannel[i];
        bool open = (pedalCh == PAD_NO_LINK) || pads[pedalCh].openHH;
        byte note = open ? pad.noteOpen : pad.noteClose;
        sendHitEvent(i, open ? "open" : "closed", note, pad.velocity);
        fireNote(note, pad.velocity);
        break;
    }

    case PAD_CYMBAL_2ZONE:
    case PAD_HIHAT_2ZONE:
    {
        byte pedalCh = (type == PAD_HIHAT_2ZONE) ? hihatPedalChannel[i] : PAD_NO_LINK;
        bool open = (pedalCh == PAD_NO_LINK) || pads[pedalCh].openHH;

        // Nota: a lib so tem 3 "slots" de nota realmente independentes
        // (note/note_rim/note_cup). note_rim seta noteRim, noteEdge,
        // noteClose e noteOpenEdge TODOS pro mesmo valor - nao ha' como
        // configurar "borda aberta" com um som diferente de "fechado".
        // Por isso so distinguimos aberto/fechado na zona do corpo (bow);
        // a borda usa sempre o mesmo valor (note_rim). Ver
        // docs/05-tipos-de-sensor.md.
        if (pad.hit)
        {
            byte note = (type == PAD_HIHAT_2ZONE) ? (open ? pad.noteOpen : pad.noteRim) : pad.note;
            sendHitEvent(i, "bow", note, pad.velocity);
            fireNote(note, pad.velocity);
        }
        if (pad.hitRim)
        {
            byte note = (type == PAD_HIHAT_2ZONE) ? pad.noteRim : pad.noteEdge;
            sendHitEvent(i, "edge", note, pad.velocity);
            fireNote(note, pad.velocity);
        }
        if (pad.choke)
        {
            sendHitEvent(i, "choke", pad.note, 0);
        }
        break;
    }

    case PAD_CYMBAL_3ZONE:
    {
        if (pad.hit)
        {
            sendHitEvent(i, "bow", pad.note, pad.velocity);
            fireNote(pad.note, pad.velocity);
        }
        if (pad.hitRim)
        {
            sendHitEvent(i, "edge", pad.noteEdge, pad.velocity);
            fireNote(pad.noteEdge, pad.velocity);
        }
        if (pad.hitCup)
        {
            sendHitEvent(i, "cup", pad.noteCup, pad.velocity);
            fireNote(pad.noteCup, pad.velocity);
        }
        if (pad.choke)
        {
            sendHitEvent(i, "choke", pad.note, 0);
        }
        break;
    }

    case PAD_HIHAT_PEDAL:
    case PAD_HIHAT_OPTICAL:
    {
        if (pad.hit)
        {
            sendHitEvent(i, "pedal", pad.note, pad.velocity);
            fireNote(pad.note, pad.velocity);
        }

        static byte lastPedalCC[NUM_PADS] = {0};
        if (pad.pedalCC != lastPedalCC[i])
        {
            lastPedalCC[i] = pad.pedalCC;
            fireControlChange(HIHAT_PEDAL_CC, pad.pedalCC);
        }
        break;
    }
    }
}

// Chama o metodo de sensing certo pra esse pad, de acordo com o pad_type -
// ver docs/05-tipos-de-sensor.md. So chamado pra canais primarios.
void dispatchSensing(byte i)
{
    switch (padTypes[i])
    {
    case PAD_SINGLE:
        pads[i].singlePiezoMUX();
        break;
    case PAD_DUAL:
        pads[i].dualPiezoMUX();
        break;
    case PAD_HIHAT_SINGLE:
        pads[i].HHMUX();
        break;
    case PAD_CYMBAL_2ZONE:
        pads[i].cymbal2zoneMUX();
        break;
    case PAD_HIHAT_2ZONE:
        pads[i].HH2zoneMUX();
        break;
    case PAD_CYMBAL_3ZONE:
        pads[i].cymbal3zoneMUX();
        break;
    case PAD_HIHAT_PEDAL:
        pads[i].hihatControlMUX();
        break;
    case PAD_HIHAT_OPTICAL:
        pads[i].TCRT5000MUX();
        break;
    }
}

// ---------------------------------------------------------------------------
// Encoders - leitura com deteccao de hold (design/SPEC.md secao 1: hold
// 600ms nos dois encoders tem significado proprio, diferente de um clique).
// ---------------------------------------------------------------------------
long enc1LastPos = 0;
long enc2LastPos = 0;

bool sw1State = HIGH;
unsigned long sw1DebounceMs = 0;
bool sw1WaitingRelease = false;
bool sw1HoldFired = false;
unsigned long sw1PressedAtMs = 0;

bool sw2State = HIGH;
unsigned long sw2DebounceMs = 0;
bool sw2WaitingRelease = false;
bool sw2HoldFired = false;
unsigned long sw2PressedAtMs = 0;

unsigned long enc2LastStepMs = 0;

void goToLive()
{
    currentPage = PAGE_LIVE;
    forceScreenRedraw = true;
}

void onEnc1Rotate(int delta)
{
    if (currentPage == PAGE_PAD_EDIT || currentPage == PAGE_SIGNAL)
    {
        editPadIndex = (editPadIndex + delta + NUM_PADS) % NUM_PADS;
        editItemIndex = 0;
        editingValue = false;
        signalNeedsRedraw = true;
    }
    else
    {
        // Circular entre as 3 paginas de topo: LIVE <-> PADS <-> GLOBAL.
        int order = currentPage == PAGE_LIVE ? 0 : currentPage == PAGE_PADS ? 1 : currentPage == PAGE_GLOBAL ? 2 : 0;
        order = (order + delta + 3) % 3;
        currentPage = order == 0 ? PAGE_LIVE : order == 1 ? PAGE_PADS : PAGE_GLOBAL;
    }
    forceScreenRedraw = true;
}

void onEnc1Click()
{
    if (currentPage == PAGE_PAD_EDIT)
    {
        currentPage = PAGE_SIGNAL;
        signalNeedsRedraw = true;
        forceScreenRedraw = true;
    }
    else if (currentPage == PAGE_SIGNAL)
    {
        currentPage = PAGE_PAD_EDIT;
        forceScreenRedraw = true;
    }
    // Sem efeito em LIVE/PADS/GLOBAL (design/SPEC.md).
}

int currentFieldStep(const FieldDef &field)
{
    if (!field.accelerates)
    {
        return 1;
    }
    unsigned long now = millis();
    int step = (now - enc2LastStepMs) < 125 ? 5 : 1; // >8 detents/s = acelera (design/SPEC.md)
    enc2LastStepMs = now;
    return step;
}

void onEnc2Rotate(int delta)
{
    if (currentPage == PAGE_PADS)
    {
        int next = (int)padsListSelection + delta;
        if (next < 0) next = 0;
        if (next > NUM_PADS - 1) next = NUM_PADS - 1;
        padsListSelection = next;
        if (padsListSelection < padsListTop) padsListTop = padsListSelection;
        if (padsListSelection > padsListTop + 7) padsListTop = padsListSelection - 7;
        forceScreenRedraw = true;
    }
    else if (currentPage == PAGE_PAD_EDIT)
    {
        FieldDef fields[MAX_FIELDS_PER_PAD];
        byte n = getFieldsForType(padTypes[editPadIndex], fields);

        if (!editingValue)
        {
            int next = (int)editItemIndex + delta;
            if (next < 0) next = 0;
            if (next > n - 1) next = n - 1;
            editItemIndex = next;
        }
        else
        {
            FieldDef &f = fields[editItemIndex];
            int step = currentFieldStep(f) * (delta > 0 ? 1 : -1);
            int value = getFieldValue(editPadIndex, f.id) + step;
            if (value < f.minVal) value = f.minVal;
            if (value > f.maxVal) value = f.maxVal;
            setFieldValue(editPadIndex, f.id, value);
        }
        forceScreenRedraw = true;
    }
    else if (currentPage == PAGE_GLOBAL)
    {
        if (!globalEditing)
        {
            int next = (int)globalSelection + delta;
            if (next < 0) next = 0;
            if (next > GLOBAL_ROW_COUNT - 1) next = GLOBAL_ROW_COUNT - 1;
            globalSelection = next;
        }
        else
        {
            int step = delta > 0 ? 1 : -1;
            if (globalSelection == GLOBAL_ROW_MIDI_CH)
            {
                int v = constrain((int)midiChannel + step, 1, 16);
                midiChannel = v;
            }
            else if (globalSelection == GLOBAL_ROW_OUTPUT)
            {
                int v = ((int)midiOutput + step + 3) % 3;
                midiOutput = v;
            }
            else if (globalSelection == GLOBAL_ROW_BRIGHTNESS)
            {
                int v = constrain((int)brightness + step * 10, 10, 100);
                brightness = v;
                applyBrightness();
            }
            unsavedChanges = true;
        }
        forceScreenRedraw = true;
    }
}

void showToast(const char *line1, const char *line2)
{
    strncpy(toastLine1, line1, sizeof(toastLine1) - 1);
    toastLine1[sizeof(toastLine1) - 1] = '\0';
    strncpy(toastLine2, line2, sizeof(toastLine2) - 1);
    toastLine2[sizeof(toastLine2) - 1] = '\0';
    toastUntilMs = millis() + 900;
}

void onEnc2Click()
{
    if (currentPage == PAGE_PADS)
    {
        editPadIndex = padsListSelection;
        editItemIndex = 0;
        editingValue = false;
        currentPage = PAGE_PAD_EDIT;
        forceScreenRedraw = true;
    }
    else if (currentPage == PAGE_PAD_EDIT)
    {
        editingValue = !editingValue;
        forceScreenRedraw = true;
    }
    else if (currentPage == PAGE_GLOBAL)
    {
        if (globalSelection == GLOBAL_ROW_SAVE)
        {
            saveAllToEeprom();
            showToast("SALVO", "32 PADS EM NVS");
        }
        else if (globalSelection == GLOBAL_ROW_RESTORE)
        {
            loadAllFromEeprom();
            showToast("RESTAURADO", "32 PADS DA NVS");
        }
        else
        {
            globalEditing = !globalEditing;
        }
        forceScreenRedraw = true;
    }
}

void onEnc1Hold()
{
    goToLive();
}

void onEnc2Hold()
{
    editingValue = false;
    globalEditing = false;
    if (currentPage == PAGE_PAD_EDIT)
    {
        currentPage = PAGE_PADS;
        forceScreenRedraw = true;
    }
    else if (currentPage == PAGE_SIGNAL)
    {
        currentPage = PAGE_PAD_EDIT;
        forceScreenRedraw = true;
    }
    // PADS/GLOBAL/LIVE nao tem nivel abaixo - sem efeito (design/SPEC.md
    // so define essa transicao a partir de PAD_EDIT/SIGNAL).
}

void handleEncoders()
{
    long p1 = enc1.getPosition();
    if (p1 != enc1LastPos)
    {
        onEnc1Rotate(p1 > enc1LastPos ? 1 : -1);
        enc1LastPos = p1;
    }

    long p2 = enc2.getPosition();
    if (p2 != enc2LastPos)
    {
        onEnc2Rotate(p2 > enc2LastPos ? 1 : -1);
        enc2LastPos = p2;
    }

    unsigned long now = millis();

    bool raw1 = digitalRead(ENC1_SW);
    if (raw1 != sw1State && (now - sw1DebounceMs) > SW_DEBOUNCE_MS)
    {
        sw1State = raw1;
        sw1DebounceMs = now;
        if (sw1State == LOW)
        {
            sw1WaitingRelease = true;
            sw1HoldFired = false;
            sw1PressedAtMs = now;
        }
        else if (sw1WaitingRelease)
        {
            sw1WaitingRelease = false;
            if (!sw1HoldFired)
            {
                onEnc1Click();
            }
        }
    }
    if (sw1WaitingRelease && !sw1HoldFired && (now - sw1PressedAtMs) >= HOLD_MS)
    {
        sw1HoldFired = true;
        onEnc1Hold();
    }

    bool raw2 = digitalRead(ENC2_SW);
    if (raw2 != sw2State && (now - sw2DebounceMs) > SW_DEBOUNCE_MS)
    {
        sw2State = raw2;
        sw2DebounceMs = now;
        if (sw2State == LOW)
        {
            sw2WaitingRelease = true;
            sw2HoldFired = false;
            sw2PressedAtMs = now;
        }
        else if (sw2WaitingRelease)
        {
            sw2WaitingRelease = false;
            if (!sw2HoldFired)
            {
                onEnc2Click();
            }
        }
    }
    if (sw2WaitingRelease && !sw2HoldFired && (now - sw2PressedAtMs) >= HOLD_MS)
    {
        sw2HoldFired = true;
        onEnc2Hold();
    }
}

// ---------------------------------------------------------------------------
// Telas (design/SPEC.md secao 3). Widgets pequenos reutilizados entre elas -
// ver secao 6 do spec.
// ---------------------------------------------------------------------------

void drawTitleBar(const char *left, const char *right, uint16_t rightColor)
{
    tft.fillRect(0, 0, 128, 12, COL_SURFACE);
    tft.setTextSize(1);
    tft.setTextColor(COL_ACCENT);
    tft.setCursor(4, 2);
    tft.print(left);
    if (right && right[0])
    {
        int16_t x1, y1;
        uint16_t w, h;
        tft.getTextBounds(right, 0, 0, &x1, &y1, &w, &h);
        tft.setTextColor(rightColor);
        tft.setCursor(124 - (int)w, 2);
        tft.print(right);
    }
}

void drawValueRow(int y, const char *label, const char *value, bool selected, bool editing)
{
    tft.fillRect(0, y, 128, 14, editing ? COL_BG : selected ? COL_SURFACE : COL_BG);
    tft.setTextSize(1);
    tft.setTextColor(selected || editing ? COL_TXT : COL_TXT_DIM);
    tft.setCursor(4, y + 3);
    tft.print(label);

    int16_t x1, y1;
    uint16_t w, h;
    tft.getTextBounds(value, 0, 0, &x1, &y1, &w, &h);
    int vx = 124 - (int)w;
    if (editing)
    {
        tft.fillRect(vx - 3, y + 1, (int)w + 5, 12, COL_EDIT);
        tft.setTextColor(COL_BG);
    }
    else
    {
        tft.setTextColor(COL_TXT);
    }
    tft.setCursor(vx, y + 3);
    tft.print(value);
}

void renderBootProgress(byte percent)
{
    tft.fillRect(24, 82, 80, 4, COL_SURFACE);
    int fillW = map(percent, 0, 100, 0, 80);
    tft.fillRect(24, 82, fillW, 4, COL_ACCENT);
}

void renderBoot()
{
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
}

void renderLivePad(byte i)
{
    byte col = i % 8;
    byte row = i / 8;
    int x = 1 + col * 16;
    int y = 31 + row * 17;

    unsigned long since = millis() - padHitAtMs[i];
    bool solid = padHitAtMs[i] != 0 && since < PAD_FLASH_MS;
    bool decay = padHitAtMs[i] != 0 && since >= PAD_FLASH_MS && since < PAD_DECAY_MS;

    uint16_t bg = solid ? COL_HIT : COL_BG;
    uint16_t border = solid ? COL_HIT : decay ? COL_HIT : COL_LINE;
    uint16_t fg = solid ? COL_BG : decay ? COL_HIT : COL_TXT_DIM;

    tft.fillRect(x, y, 14, 14, bg);
    tft.drawRect(x, y, 14, 14, border);

    char buf[3];
    snprintf(buf, sizeof(buf), "%02d", i + 1);
    tft.setTextSize(1);
    tft.setTextColor(fg);
    tft.setCursor(x + 1, y + 4);
    tft.print(buf);
}

void renderLive()
{
    if (forceScreenRedraw)
    {
        tft.fillScreen(COL_BG);
        drawTitleBar("LIVE", "", COL_TXT);
        tft.setTextSize(1);
        tft.setTextColor(TinyUSBDevice.mounted() ? COL_OK : COL_LINE);
        tft.setCursor(100, 2);
        tft.print("U");
        tft.setTextColor(bleMidiConnected ? COL_OK : COL_LINE);
        tft.setCursor(118, 2);
        tft.print("B");
        for (byte i = 0; i < NUM_PADS; i++)
        {
            renderLivePad(i);
        }
        forceScreenRedraw = false;
        return;
    }

    // Nunca redesenha a grade inteira - so' os pads cujo estado (solido /
    // decaindo / idle) pode ter mudado desde o ultimo frame.
    unsigned long now = millis();
    for (byte i = 0; i < NUM_PADS; i++)
    {
        unsigned long since = now - padHitAtMs[i];
        if (padHitAtMs[i] != 0 && since <= PAD_DECAY_MS + 20)
        {
            renderLivePad(i);
        }
    }
}

void renderPadsList()
{
    if (!forceScreenRedraw)
    {
        return;
    }
    forceScreenRedraw = false;

    tft.fillScreen(COL_BG);
    char right[8];
    snprintf(right, sizeof(right), "%02d/32", padsListSelection + 1);
    drawTitleBar("PADS", right, COL_TXT_DIM);

    for (byte row = 0; row < 8; row++)
    {
        byte i = padsListTop + row;
        int y = 12 + row * 14;
        bool sel = (i == padsListSelection);

        tft.fillRect(0, y, 125, 14, sel ? COL_ACCENT : COL_BG);
        tft.setTextSize(1);
        tft.setTextColor(sel ? COL_BG : COL_TXT);

        char idxBuf[5];
        snprintf(idxBuf, sizeof(idxBuf), "P%02d", i + 1);
        tft.setCursor(4, y + 3);
        tft.print(idxBuf);

        tft.setTextColor(sel ? COL_BG : COL_TXT_DIM);
        tft.setCursor(34, y + 3);
        if (channelPrimary[i])
        {
            tft.print(padTypeShortName(padTypes[i]));
        }
        else
        {
            tft.print("--");
        }

        if (channelPrimary[i])
        {
            char noteBuf[6];
            snprintf(noteBuf, sizeof(noteBuf), "N%d", pads[i].note);
            int16_t x1, y1;
            uint16_t w, h;
            tft.setTextColor(sel ? COL_BG : COL_TXT);
            tft.getTextBounds(noteBuf, 0, 0, &x1, &y1, &w, &h);
            tft.setCursor(121 - (int)w, y + 3);
            tft.print(noteBuf);
        }
    }

    // Scrollbar proporcional (3px, coluna x=125).
    tft.fillRect(125, 12, 3, 116, COL_SURFACE);
    int barH = 116 * 8 / NUM_PADS;
    int barY = 12 + (116 - barH) * padsListTop / (NUM_PADS - 8);
    tft.fillRect(125, barY, 3, barH, COL_LINE);
}

void renderPadEdit()
{
    if (!forceScreenRedraw)
    {
        return;
    }
    forceScreenRedraw = false;

    tft.fillScreen(COL_BG);
    char left[8];
    snprintf(left, sizeof(left), "PAD %02d", editPadIndex + 1);
    drawTitleBar(left, "EDIT", COL_TXT_DIM);

    if (!channelPrimary[editPadIndex])
    {
        tft.setTextColor(0xFBC3);
        tft.setTextSize(1);
        tft.setCursor(4, 40);
        tft.print("Canal ocupado");
        tft.setCursor(4, 52);
        tft.print("(2o canal do pad anterior)");
        return;
    }

    FieldDef fields[MAX_FIELDS_PER_PAD];
    byte n = getFieldsForType(padTypes[editPadIndex], fields);

    byte top = 0;
    if (n > 7)
    {
        if (editItemIndex < top) top = editItemIndex;
        if (editItemIndex > top + 6) top = editItemIndex - 6;
    }

    byte visible = n > 7 ? 7 : n;
    for (byte row = 0; row < visible; row++)
    {
        byte idx = top + row;
        int y = 12 + row * 14;
        bool sel = (idx == editItemIndex);
        bool editingThis = sel && editingValue;

        char valueBuf[10];
        if (fields[idx].id == FIELD_SENSOR)
        {
            strncpy(valueBuf, padTypeShortName(getFieldValue(editPadIndex, fields[idx].id)), sizeof(valueBuf) - 1);
            valueBuf[sizeof(valueBuf) - 1] = '\0';
        }
        else if (fields[idx].id == FIELD_CURVE)
        {
            const char *curves[] = {"LIN", "EXP1", "EXP2", "LOG", "LOG2"};
            int v = getFieldValue(editPadIndex, fields[idx].id);
            strncpy(valueBuf, curves[v < 5 ? v : 0], sizeof(valueBuf) - 1);
            valueBuf[sizeof(valueBuf) - 1] = '\0';
        }
        else if (fields[idx].id == FIELD_PEDAL_LINK)
        {
            int v = getFieldValue(editPadIndex, fields[idx].id);
            if (v < 0) strncpy(valueBuf, "NENHUM", sizeof(valueBuf) - 1);
            else snprintf(valueBuf, sizeof(valueBuf), "P%02d", v + 1);
        }
        else
        {
            snprintf(valueBuf, sizeof(valueBuf), "%d", getFieldValue(editPadIndex, fields[idx].id));
        }

        drawValueRow(y, fields[idx].label, valueBuf, sel, editingThis);
    }

    tft.fillRect(0, 116, 128, 12, COL_SURFACE);
    tft.setTextSize(1);
    tft.setTextColor(COL_TXT_DIM);
    tft.setCursor(4, 118);
    tft.print("ENC2 GIRA VALOR");
    tft.setTextColor(COL_EDIT);
    tft.setCursor(96, 118);
    tft.print("PUSH OK");
}

// Puxa uma amostra do canal em foco pra dentro do buffer do osciloscopio -
// chamado a cada loop() enquanto SIGNAL esta' visivel (ver docs/01 pra a
// simplificacao assumida aqui: janela deslizante continua, nao um recorte
// alinhado a um hit especifico).
void captureSignalSample()
{
    int v = rawValue[editPadIndex]; // pin_1 == editPadIndex nesse projeto (ver construcao de pads[])
    signalBuffer[signalBufferPos] = v;
    signalBufferPos = (signalBufferPos + 1) % SIGNAL_BUFFER_LEN;
    if (v > signalPeak)
    {
        signalPeak = v;
    }
}

void renderSignal()
{
    if (!signalNeedsRedraw && !forceScreenRedraw)
    {
        return;
    }
    signalNeedsRedraw = false;
    forceScreenRedraw = false;

    tft.fillScreen(COL_BG);
    char left[8];
    snprintf(left, sizeof(left), "PAD %02d", editPadIndex + 1);
    drawTitleBar(left, "SIGNAL", COL_TXT_DIM);

    tft.drawLine(4, 18, 4, 91, COL_LINE);
    tft.drawLine(4, 91, 124, 91, COL_LINE);

    int prevX = -1, prevY = -1;
    int maxV = 1023;
    for (int i = 0; i < SIGNAL_BUFFER_LEN; i++)
    {
        int idx = (signalBufferPos + i) % SIGNAL_BUFFER_LEN;
        int x = 4 + i;
        int y = 91 - map(constrain(signalBuffer[idx], 0, maxV), 0, maxV, 0, 73);
        if (prevX >= 0)
        {
            tft.drawLine(prevX, prevY, x, y, COL_OK);
        }
        prevX = x;
        prevY = y;
    }

    tft.setTextSize(1);
    tft.setTextColor(COL_TXT_DIM);
    tft.setCursor(4, 96);
    tft.print("VEL");
    tft.setTextColor(COL_TXT);
    tft.print(" ");
    tft.print(pads[editPadIndex].velocity);
    tft.setTextColor(COL_TXT_DIM);
    tft.print("  PEAK ");
    tft.setTextColor(COL_TXT);
    tft.print(signalPeak);

    tft.setTextColor(COL_ACCENT);
    tft.setCursor(4, 110);
    tft.print("SCAN ");
    tft.print(pads[editPadIndex].scantime);
    tft.setTextColor(COL_LINE);
    tft.print(" MASK ");
    tft.print(pads[editPadIndex].masktime);
    tft.setTextColor(COL_EDIT);
    tft.print(" THR ");
    tft.print(pads[editPadIndex].threshold1);
}

const char *midiOutputLabel(byte v)
{
    return v == OUTPUT_USB ? "USB" : v == OUTPUT_BLE ? "BLE" : "USB+BLE";
}

void renderGlobal()
{
    unsigned long now = millis();
    bool showingToast = now < toastUntilMs;

    if (!forceScreenRedraw && !showingToast && toastUntilMs != 0 && now >= toastUntilMs)
    {
        toastUntilMs = 0;
        forceScreenRedraw = true;
    }

    if (!forceScreenRedraw)
    {
        return;
    }
    forceScreenRedraw = false;

    tft.fillScreen(COL_BG);
    drawTitleBar("GLOBAL", "", COL_TXT);

    char buf[10];
    snprintf(buf, sizeof(buf), "%d", midiChannel);
    drawValueRow(12, "MIDI CH", buf, globalSelection == GLOBAL_ROW_MIDI_CH, globalSelection == GLOBAL_ROW_MIDI_CH && globalEditing);

    drawValueRow(26, "SAIDA", midiOutputLabel(midiOutput), globalSelection == GLOBAL_ROW_OUTPUT, globalSelection == GLOBAL_ROW_OUTPUT && globalEditing);

    snprintf(buf, sizeof(buf), "%d%%", brightness);
    drawValueRow(40, "BRILHO", buf, globalSelection == GLOBAL_ROW_BRIGHTNESS, globalSelection == GLOBAL_ROW_BRIGHTNESS && globalEditing);

    drawValueRow(54, "SALVAR", unsavedChanges ? "*" : ">", globalSelection == GLOBAL_ROW_SAVE, false);
    drawValueRow(68, "RESTAURAR", ">", globalSelection == GLOBAL_ROW_RESTORE, false);

    if (showingToast)
    {
        tft.fillRect(14, 56, 100, 34, COL_BG);
        tft.drawRect(14, 56, 100, 34, COL_OK);
        int16_t x1, y1;
        uint16_t w, h;
        tft.setTextSize(2);
        tft.getTextBounds(toastLine1, 0, 0, &x1, &y1, &w, &h);
        tft.setTextColor(COL_OK);
        tft.setCursor(64 - (int)w / 2, 63);
        tft.print(toastLine1);
        tft.setTextSize(1);
        tft.getTextBounds(toastLine2, 0, 0, &x1, &y1, &w, &h);
        tft.setTextColor(COL_TXT_DIM);
        tft.setCursor(64 - (int)w / 2, 80);
        tft.print(toastLine2);
    }
}

void renderScreen()
{
    if (currentPage == PAGE_SIGNAL)
    {
        captureSignalSample();
    }

    switch (currentPage)
    {
    case PAGE_BOOT:
        break; // desenhado direto em setup(), nao faz parte do loop()
    case PAGE_LIVE:
        renderLive();
        break;
    case PAGE_PADS:
        renderPadsList();
        break;
    case PAGE_PAD_EDIT:
        renderPadEdit();
        break;
    case PAGE_SIGNAL:
        renderSignal();
        break;
    case PAGE_GLOBAL:
        renderGlobal();
        break;
    }
}

void setup()
{
    // TFT primeiro - precisamos dela pra mostrar a tela BOOT antes de mais
    // nada (design/SPEC.md SCR 0).
    pinMode(TFT_BLK, OUTPUT);
    ledcSetup(TFT_BLK_PWM_CHANNEL, 5000, 8);
    ledcAttachPin(TFT_BLK, TFT_BLK_PWM_CHANNEL);

    SPI.begin(TFT_SCLK, -1 /* MISO nao usado */, TFT_MOSI, TFT_CS);
    tft.initR(INITR_144GREENTAB); // variante do driver para telas 1.44" 128x128 - validar no hardware real
    tft.setRotation(0);
    renderBoot();

    if (!TinyUSBDevice.isInitialized())
    {
        TinyUSBDevice.begin(0);
    }
    Serial.begin(115200);
    renderBootProgress(20);

    usb_midi.setStringDescriptor("DrumCore MIDI");
    MIDI.begin(MIDI_CHANNEL_OMNI);
    if (TinyUSBDevice.mounted())
    {
        TinyUSBDevice.detach();
        delay(10);
        TinyUSBDevice.attach();
    }
    renderBootProgress(40);

    BLEBleMidi.setHandleConnected(onBleMidiConnected);
    BLEBleMidi.setHandleDisconnected(onBleMidiDisconnected);
    BleMidi.begin();
    renderBootProgress(55);

    if (!EEPROM_ESP.begin(EEPROM_SIZE))
    {
        sendLog("EEPROM_ESP.begin() falhou - configuracoes nao vao persistir entre boots.");
    }

    bool eepromFirstBoot = EEPROM_ESP.read(EEPROM_INIT_FLAG_ADDR) != EEPROM_INIT_MAGIC;
    if (eepromFirstBoot)
    {
        sendLog("EEPROM: primeira inicializacao - gravando valores padrao.");
        for (byte i = 0; i < NUM_PADS; i++)
        {
            pads[i].note = FIRST_TEST_NOTE + i;
            padLabels[i][0] = '\0';
            padTypes[i] = PAD_SINGLE;
            hihatPedalChannel[i] = PAD_NO_LINK;
            rebuildPadName(i);
            pads[i].initMemory();
            EEPROM_ESP.writeBytes(padLabelEepromAddr(i), padLabels[i], PAD_LABEL_MAX_LEN);
            EEPROM_ESP.write(EEPROM_TYPES_ADDR + i, padTypes[i]);
            EEPROM_ESP.write(EEPROM_HIHAT_LINK_ADDR + i, hihatPedalChannel[i]);
        }
        recomputeChannelPrimary();
        applyBrightness();
        EEPROM_ESP.write(EEPROM_GLOBAL_ADDR, midiChannel);
        EEPROM_ESP.write(EEPROM_GLOBAL_ADDR + 1, midiOutput);
        EEPROM_ESP.write(EEPROM_GLOBAL_ADDR + 2, brightness);
        EEPROM_ESP.write(EEPROM_INIT_FLAG_ADDR, EEPROM_INIT_MAGIC);
        EEPROM_ESP.commit();
    }
    else
    {
        loadAllFromEeprom();
    }
    renderBootProgress(80);

    pinMode(ENC1_SW, INPUT_PULLUP);
    pinMode(ENC2_SW, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(ENC1_A), isrEnc1, CHANGE);
    attachInterrupt(digitalPinToInterrupt(ENC1_B), isrEnc1, CHANGE);
    attachInterrupt(digitalPinToInterrupt(ENC2_A), isrEnc2, CHANGE);
    attachInterrupt(digitalPinToInterrupt(ENC2_B), isrEnc2, CHANGE);
    renderBootProgress(100);

    delay(300);
    sendLog("DrumCore - Fase J: navegacao/tela redesenhada (32 canais, 4x CD4051, USB-MIDI + BLE-MIDI)");
    goToLive();
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
        if (channelPrimary[i])
        {
            dispatchSensing(i);
        }
    }

    for (byte i = 0; i < NUM_PADS; i++)
    {
        if (channelPrimary[i])
        {
            handlePadResult(i);
        }
    }

    handleEncoders();
    renderScreen();
    pollSerialCommands();
}
