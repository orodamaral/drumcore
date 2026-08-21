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
  Fase D: persistencia em EEPROM (NVS) - grava valores padrao no primeiro
  boot (HelloDrum::initMemory()) e restaura o que foi editado nos boots
  seguintes (HelloDrum::loadMemory()). As proprias escritas feitas pelos
  encoders (via settingEnable()) ja commitam sozinhas, isso e' so o
  load/init inicial.
  Fase E: protocolo serial (NDJSON) sobre a mesma porta USB-CDC, pra
  comunicacao com o app desktop de configuracao. Ver
  docs/04-protocolo-serial.md.
  Fase F: nome livre por pad (ex: "Caixa"), editavel so via o app desktop
  (comando set_pad com field="label") - nunca pelos encoders/TFT. O numero
  do pad e' fixo; o nome exibido e' sempre "N - Label" (ou "Pad N" sem
  label). Persistido em EEPROM junto com o resto.
  Fase G: tipos de sensor por pad (single/dual/2-zone/3-zone/hihat/pedal) e
  topologia de canais - cada pad pode consumir 1 ou 2 canais adjacentes
  (nenhum tipo dessa lib usa mais de 2), configuravel so pelo app desktop.
  Ver docs/01-decisoes-arquiteturais.md e docs/05-tipos-de-sensor.md.
  Fase H: BLE-MIDI (lathoub/Arduino-BLE-MIDI, stack Bluedroid do proprio
  core) como transporte adicional - todo hit/CC vai tanto pro USB-MIDI
  (Fase B) quanto pro BLE-MIDI simultaneamente, quando houver um
  dispositivo pareado. Ver docs/01-decisoes-arquiteturais.md.

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
#include <ArduinoJson.h>
#include <BLEMIDI_Transport.h>
#include <hardware/BLEMIDI_ESP32.h>

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

// CC usado para a posicao do pedal de chimbal (pad.pedalCC, ja vem 0-127 da
// lib). 4 = "Foot Controller" no GM - ajustar se o software do outro lado
// esperar outro numero de CC.
#define HIHAT_PEDAL_CC 4

// Primeira nota MIDI usada (pad 0) - so para identificar cada canal nos
// testes iniciais. O usuario pode reatribuir por pad via o menu na tela ou
// pelo app desktop.
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

// ---------------------------------------------------------------------------
// EEPROM (persistencia das configuracoes por pad)
// Layout: 10 bytes por pad (sensitivity, threshold1, scantime, masktime,
// rimSensitivity, rimThreshold, curvetype, note, noteRim, noteCup - ver
// HelloDrum::loadMemory()/initMemory() em hellodrum.cpp), seguido de 1 byte
// usado como flag de "ja inicializado" (Fase D), seguido de
// PAD_LABEL_MAX_LEN bytes por pad pro nome livre (Fase F), seguido de 1
// byte por pad pro tipo de sensor e 1 byte por pad pro canal do pedal de
// chimbal linkado (Fase G).
// ---------------------------------------------------------------------------
#define EEPROM_BYTES_PER_PAD 10
#define EEPROM_INIT_FLAG_ADDR (NUM_PADS * EEPROM_BYTES_PER_PAD)
#define EEPROM_NAMES_ADDR (EEPROM_INIT_FLAG_ADDR + 1)
#define EEPROM_TYPES_ADDR (EEPROM_NAMES_ADDR + NUM_PADS * PAD_LABEL_MAX_LEN)
#define EEPROM_HIHAT_LINK_ADDR (EEPROM_TYPES_ADDR + NUM_PADS)
#define EEPROM_SIZE (EEPROM_HIHAT_LINK_ADDR + NUM_PADS)
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
// que so leem pin_1, ex: singlePiezoMUX()) OU dual-channel (metodos que
// tambem leem pin_2, ex: dualPiezoMUX()), sem precisar reconstruir nada
// quando o tipo do pad muda em runtime - so trocamos qual metodo chamamos.
// Ver docs/01-decisoes-arquiteturais.md.
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
// USB-MIDI acima. A macro cria dois objetos: o transporte "BLEBleMidi"
// (usado so pra registrar os callbacks de conexao abaixo) e a interface
// MIDI "BleMidi" (usada pra enviar notas/CC, igual a "MIDI" do USB).
// "HelloDrum" e' o nome anunciado via Bluetooth (o que aparece ao pareear).
BLEMIDI_CREATE_INSTANCE("HelloDrum", BleMidi)

// true enquanto houver um dispositivo pareado via BLE-MIDI - os callbacks
// que atualizam essa flag (onBleMidiConnected/onBleMidiDisconnected) sao
// definidos mais abaixo (dependem de sendLog(), que ainda nao existe aqui).
volatile bool bleMidiConnected = false;

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

// padLabels[i]: texto livre editavel (ex: "Caixa"), vazio por padrao.
// padNames[i]: nome exibido de fato ("N - Label" ou "Pad N" sem label) -
// e' o que settingName() recebe. settingName() guarda o ponteiro recebido
// (nao copia a string), por isso padNames precisa ser memoria que dura o
// programa todo (nao um buffer temporario de escopo local) - e como e' um
// buffer mutavel, atualizar seu CONTEUDO depois (rebuildPadName()) reflete
// automaticamente no que a lib exibe, sem precisar chamar settingName() de
// novo. Ver docs/01-decisoes-arquiteturais.md.
char padLabels[NUM_PADS][PAD_LABEL_MAX_LEN];
char padNames[NUM_PADS][PAD_NAME_MAX_LEN];

// padTypes[i]: tipo de sensor desse canal (PAD_SINGLE..PAD_HIHAT_OPTICAL).
// hihatPedalChannel[i]: canal do pedal de chimbal linkado a esse pad (so
// relevante pra PAD_HIHAT_SINGLE/PAD_HIHAT_2ZONE) - PAD_NO_LINK se nenhum.
// channelPrimary[i]: false se esse canal e' o "segundo canal" (rim/edge/cup)
// de um pad de 2 canais no slot anterior - nesse caso ele nao e' sensoreado
// nem aparece como pad independente. Recalculado via recomputeChannelPrimary()
// sempre que algum padTypes[] muda. Ver docs/01-decisoes-arquiteturais.md.
byte padTypes[NUM_PADS];
byte hihatPedalChannel[NUM_PADS];
bool channelPrimary[NUM_PADS];

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

// GetPadName() devolve o mesmo ponteiro que passamos em settingName(padNames[i])
// - nao ha' getter pra ler o nameIndex (interno da lib) diretamente, mas como
// e' o MESMO ponteiro, comparar por identidade (nao por conteudo) recupera o
// indice atual de forma confiavel.
int currentPadIndex()
{
    const char *name = button.GetPadName();
    for (byte i = 0; i < NUM_PADS; i++)
    {
        if (padNames[i] == name)
        {
            return i;
        }
    }
    return -1;
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

    int idx = currentPadIndex();
    if (idx >= 0 && !channelPrimary[idx])
    {
        // canal consumido pelo pad anterior (2 canais) - nao ha' nada pra
        // editar aqui, so avisamos e nao mostramos item/valor.
        tft.setTextColor(ST77XX_RED);
        tft.setTextSize(1);
        tft.setCursor(4, 40);
        tft.print("Canal ocupado");
        tft.setCursor(4, 52);
        tft.print("(2o canal do pad anterior)");
        return;
    }

    tft.setTextColor(ST77XX_WHITE);
    tft.setTextSize(1);
    tft.setCursor(4, 40);
    tft.print(item);

    tft.setTextColor(ST77XX_WHITE);
    tft.setTextSize(3);
    tft.setCursor(4, 60);
    tft.print(value);
}

// ---------------------------------------------------------------------------
// Protocolo serial (NDJSON) com o app desktop - Fase E. Ver
// docs/04-protocolo-serial.md pro contrato completo (comandos/eventos).
// Todo o trafego Serial usa esse formato, inclusive os eventos de hit e as
// mensagens de log de boot (antes eram Serial.print livre) - mantem o
// stream inteiro facil de parsear do lado do app, sem misturar texto humano
// com JSON.
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
    doc["midi_channel"] = DRUM_MIDI_CHANNEL;
    doc["ble_connected"] = bleMidiConnected;
    doc["firmware_phase"] = "H";
    sendJsonLine(doc);
}

// Callbacks do BLE-MIDI (Fase H) - chamados pela stack BLE (Bluedroid,
// roda numa task propria) quando um central conecta/desconecta. Registrados
// em setup() via BLEBleMidi.setHandleConnected()/setHandleDisconnected() -
// "BLEBleMidi" e' o nome do objeto de transporte que a macro
// BLEMIDI_CREATE_INSTANCE("HelloDrum", BleMidi) gera automaticamente
// (prefixo "BLE" + nome da instancia). Reenviam device_info pra o app saber
// do novo estado sem precisar dar poll.
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
        // 2o canal de um pad de 2 canais no slot anterior - nao e' um pad
        // independente, so avisamos qual pad o esta usando.
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

// Aplica um campo de configuracao a um pad. Pros campos numericos da lib
// (sensitivity, threshold, etc), atualiza em RAM e persiste os 10 campos
// desse pad na EEPROM via HelloDrum::initMemory() - reaproveita os offsets
// ja calculados pela lib, sem duplicar essa logica aqui. "label", "pad_type"
// e "hihat_pedal_channel" sao campos nossos (nao existem na lib), tratados
// separadamente logo abaixo.
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

        sendPadConfig(pad); // devolve o estado atualizado (name/label novos)
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
            sendPadConfig(pad + 1); // pode ter mudado de "livre" pra "ocupado" (ou vice-versa)
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
        // Reaproveitado pela lib como "edge threshold" (prato/chimbal 2 ou
        // 3 zonas) dependendo do pad_type - ver docs/05-tipos-de-sensor.md.
        if (value < 0 || value > 100) { sendError("set_pad", "value_out_of_range"); return; }
        pads[pad].rimSensitivity = value;
    }
    else if (strcmp(field, "rim_threshold") == 0)
    {
        // Reaproveitado pela lib como "cup threshold" (prato 3 zonas).
        if (value < 0 || value > 100) { sendError("set_pad", "value_out_of_range"); return; }
        pads[pad].rimThreshold = value;
    }
    else if (strcmp(field, "note") == 0)
    {
        if (value < 0 || value > 127) { sendError("set_pad", "value_out_of_range"); return; }
        pads[pad].note = value;
        pads[pad].noteOpen = value; // consistente com o que settingEnable() faz pro item NOTE
    }
    else if (strcmp(field, "note_rim") == 0)
    {
        // Reaproveitado como "note edge" (prato 2/3 zonas) ou "note close"
        // (chimbal) - mesmo aliasing que settingEnable() ja faz pro item
        // NOTE RIM/EDGE.
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
                serialLineBuffer = ""; // linha absurda - descarta em vez de crescer sem limite
            }
        }
    }
}

// Envia pros dois transportes que estiverem disponiveis (USB e/ou BLE) -
// nao sao mutuamente exclusivos, ver docs/01-decisoes-arquiteturais.md.
void fireNote(byte note, byte velocity)
{
    if (TinyUSBDevice.mounted())
    {
        MIDI.sendNoteOn(note, velocity, DRUM_MIDI_CHANNEL);
        MIDI.sendNoteOff(note, 0, DRUM_MIDI_CHANNEL);
    }

    if (bleMidiConnected)
    {
        BleMidi.sendNoteOn(note, velocity, DRUM_MIDI_CHANNEL);
        BleMidi.sendNoteOff(note, 0, DRUM_MIDI_CHANNEL);
    }
}

void fireControlChange(byte cc, byte value)
{
    if (TinyUSBDevice.mounted())
    {
        MIDI.sendControlChange(cc, value, DRUM_MIDI_CHANNEL);
    }

    if (bleMidiConnected)
    {
        BleMidi.sendControlChange(cc, value, DRUM_MIDI_CHANNEL);
    }
}

// Le o resultado do metodo de sensing ja chamado pra esse pad (ver
// dispatchSensing()) e decide o que enviar via hit/MIDI, de acordo com o
// pad_type. Ver docs/05-tipos-de-sensor.md pro detalhamento de cada tipo.
void handlePadResult(byte i)
{
    HelloDrum &pad = pads[i];
    byte type = padTypes[i];

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

    case PAD_DUAL:
    {
        if (pad.hit)
        {
            sendHitEvent(i, "head", pad.note, pad.velocity);
            fireNote(pad.note, pad.velocity);
        }
        if (pad.hitRim)
        {
            sendHitEvent(i, "rim", pad.noteRim, pad.velocity);
            fireNote(pad.noteRim, pad.velocity);
        }
        break;
    }

    case PAD_CYMBAL_2ZONE:
    case PAD_HIHAT_2ZONE:
    {
        byte pedalCh = (type == PAD_HIHAT_2ZONE) ? hihatPedalChannel[i] : PAD_NO_LINK;
        bool open = (pedalCh == PAD_NO_LINK) || pads[pedalCh].openHH;

        // Nota: a lib so tem 3 "slots" de nota realmente independentes
        // (note/note_rim/note_cup - ver handleSetPad). note_rim seta
        // noteRim, noteEdge, noteClose e noteOpenEdge TODOS pro mesmo
        // valor (mesmo aliasing que settingEnable() ja faz por padrao da
        // lib) - ou seja, nao ha' como configurar "borda aberta" com um
        // som diferente de "fechado" nessa lib. Por isso, pro chimbal 2
        // zonas, so distinguimos aberto/fechado na zona do corpo (bow);
        // a borda (edge) usa sempre o mesmo valor (note_rim), em qualquer
        // estado do pedal. Ver docs/05-tipos-de-sensor.md.
        if (pad.hit)
        {
            byte note = (type == PAD_HIHAT_2ZONE) ? (open ? pad.noteOpen : pad.noteRim) : pad.note;
            sendHitEvent(i, "bow", note, pad.velocity);
            fireNote(note, pad.velocity);
        }
        if (pad.hitRim) // hitRim = zona da borda/edge tambem pra 2-zone (ver cymbal2zoneSensing)
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
            // "Pedal chick" - fecho rapido do chimbal. Nota configuravel via
            // o campo "note" (GM sugere 44 - Pedal Hi-Hat).
            sendHitEvent(i, "pedal", pad.note, pad.velocity);
            fireNote(pad.note, pad.velocity);
        }

        // CC de posicao do pedal (pad.pedalCC ja vem 0-127 da lib) - so
        // envia quando muda, pra nao inundar o barramento MIDI/serial.
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
// ver docs/05-tipos-de-sensor.md. So chamado pra canais primarios
// (channelPrimary[i] == true); o 2o canal de um pad de 2 canais nao tem
// sensing proprio, e' lido pelo pad.pin_2 do canal anterior.
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

    // BLE-MIDI (Fase H) - transporte adicional, em paralelo ao USB-MIDI
    // acima. "BLEBleMidi" e' o objeto de transporte (nao a interface MIDI)
    // gerado pela macro BLEMIDI_CREATE_INSTANCE - so ele expõe os callbacks
    // de conexao.
    BLEBleMidi.setHandleConnected(onBleMidiConnected);
    BLEBleMidi.setHandleDisconnected(onBleMidiDisconnected);
    BleMidi.begin();

    if (!EEPROM_ESP.begin(EEPROM_SIZE))
    {
        sendLog("EEPROM_ESP.begin() falhou - configuracoes nao vao persistir entre boots.");
    }

    // Primeiro boot (ou EEPROM ainda nao inicializada): grava os valores
    // padrao de cada pad (initMemory()). Nos demais boots, restaura o que foi
    // salvo (loadMemory()) - que pode ja ter sido editado via os encoders.
    bool eepromFirstBoot = EEPROM_ESP.read(EEPROM_INIT_FLAG_ADDR) != EEPROM_INIT_MAGIC;
    if (eepromFirstBoot)
    {
        sendLog("EEPROM: primeira inicializacao - gravando valores padrao por pad.");
    }

    for (byte i = 0; i < NUM_PADS; i++)
    {
        pads[i].note = FIRST_TEST_NOTE + i;

        if (eepromFirstBoot)
        {
            padLabels[i][0] = '\0'; // sem nome customizado ainda
            EEPROM_ESP.writeBytes(padLabelEepromAddr(i), padLabels[i], PAD_LABEL_MAX_LEN);

            padTypes[i] = PAD_SINGLE;
            EEPROM_ESP.write(EEPROM_TYPES_ADDR + i, padTypes[i]);

            hihatPedalChannel[i] = PAD_NO_LINK;
            EEPROM_ESP.write(EEPROM_HIHAT_LINK_ADDR + i, hihatPedalChannel[i]);
        }
        else
        {
            EEPROM_ESP.readBytes(padLabelEepromAddr(i), padLabels[i], PAD_LABEL_MAX_LEN);
            padLabels[i][PAD_LABEL_MAX_LEN - 1] = '\0'; // seguranca contra dado corrompido sem terminador

            padTypes[i] = EEPROM_ESP.read(EEPROM_TYPES_ADDR + i);
            if (padTypes[i] >= PAD_TYPE_COUNT)
            {
                padTypes[i] = PAD_SINGLE; // valor invalido/corrompido - volta pro seguro
            }

            hihatPedalChannel[i] = EEPROM_ESP.read(EEPROM_HIHAT_LINK_ADDR + i);
        }
        rebuildPadName(i);

        // settingName() tambem incrementa nameIndexMax (global, dentro da
        // lib) - sem chamar isso pra cada pad, a navegacao via encoder fica
        // travada no pad 0 (nameIndexMax ficaria 0). Ver
        // docs/01-decisoes-arquiteturais.md.
        pads[i].settingName(padNames[i]);

        if (eepromFirstBoot)
        {
            pads[i].initMemory(); // grava os defaults acima (nota inclusa) na EEPROM
        }
        else
        {
            pads[i].loadMemory(); // restaura os valores salvos - pode sobrescrever o note default acima
        }
    }

    recomputeChannelPrimary();

    if (eepromFirstBoot)
    {
        EEPROM_ESP.write(EEPROM_INIT_FLAG_ADDR, EEPROM_INIT_MAGIC);
        EEPROM_ESP.commit();
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
    sendLog("HelloDrum - Fase H: BLE-MIDI + tipos de sensor + protocolo serial + EEPROM + tela TFT + 2 encoders (32 canais, 4x CD4051, USB-MIDI + BLE-MIDI)");
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

    // 1a passada: sensing de todos os canais primarios (a ordem importa
    // pros pads de chimbal - o canal do pedal precisa ja ter sido lido
    // nesse mesmo loop() antes do pad da cymbal ler o estado openHH dele em
    // handlePadResult(), por isso separamos sensing e MIDI em duas
    // passadas em vez de fazer tudo num loop so).
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

    handleConfigInputs();
    renderScreen();
    pollSerialCommands();
}
