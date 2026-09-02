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

  Fase K: troca da multiplexação de 4x CD4051 (8 canais cada) para 2x
  CD4067/HW-178 (16 canais cada) - mesmas 32 entradas, só menos placas pra
  montar. Só a camada de MUX mudou (HelloDrumMUX_4067 em vez de _4051, 4
  pinos de seleção S0-S3 em vez de 3); pads[]/rawValue[]/EEPROM/protocolo
  continuam iguais. Ver docs/01-decisoes-arquiteturais.md.

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

// Religamento manual do hardware USB nativo (Fase Q, 2026-09-01) - ver
// docs/01-decisoes-arquiteturais.md pro relato completo da investigacao.
// No ESP32/Adafruit TinyUSB Arduino, Adafruit_USBD_Device::begin() NAO liga
// o periferico USB de verdade (e' um stub vazio nesse chip - a lib assume
// que o core arduino-esp32 faz isso). O caminho automatico do core
// (USB.begin(), via CDC/MSC/DFU_ON_BOOT) so' dispara com essas flags
// ligadas, e QUANDO usado aqui travou o boot (a tarefa "usbd" do CORE
// chamando tud_task() da ADAFRUIT - duas pilhas TinyUSB diferentes
// misturadas, incompativeis, nucleo trava, watchdog aborta em loop).
// A funcao abaixo e' a mesma sequencia que a PROPRIA lib Adafruit usa nas
// outras placas que suporta (SAMD/RP2040/nRF) - reset do periferico,
// configuracao dos pinos D+/D- (USBPHY_DM_NUM/DP_NUM), reset do core DWC2,
// tusb_init() - só que ela vem DESLIGADA de proposito no arquivo da lib
// pra ESP32 (Adafruit_TinyUSB_esp32.cpp, bloco "#if 0", comentario "This
// port implemented is not needed and left here for reference only").
// Replicamos aqui (sem editar o arquivo vendorizado da lib) porque e' a
// unica forma encontrada que efetivamente religa o hardware sem misturar
// as duas pilhas TinyUSB diferentes que coexistem nesse binario (a
// precompilada do core, libarduino_tinyusb.a, e a da Adafruit, compilada a
// partir do source) - usa so' as pecas de baixo nivel da Adafruit (mesma
// origem do tud_task() que "ganha" no link via -Wl,--allow-multiple-definition,
// ver platformio.ini), entao fica tudo consistente/da mesma implementacao.
#include "soc/soc.h"
#include "soc/periph_defs.h"
#include "soc/usb_periph.h"
#include "soc/usb_struct.h"
#include "soc/usb_reg.h"
#include "hal/usb_hal.h"
#include "driver/gpio.h"
#include "driver/periph_ctrl.h"
#include "esp_rom_gpio.h"

#define USBD_STACK_SZ (4096)

static void usbHardwareTask(void *param)
{
    (void)param;
    while (1)
    {
        tud_task();
    }
}

static void configureUsbPins(usb_hal_context_t *usb)
{
    for (const usb_iopin_dsc_t *iopin = usb_periph_iopins; iopin->pin != -1; ++iopin)
    {
        if ((usb->use_external_phy) || (iopin->ext_phy_only == 0))
        {
            esp_rom_gpio_pad_select_gpio(iopin->pin);
            if (iopin->is_output)
            {
                esp_rom_gpio_connect_out_signal(iopin->pin, iopin->func, false, false);
            }
            else
            {
                esp_rom_gpio_connect_in_signal(iopin->pin, iopin->func, false);
                if ((iopin->pin != GPIO_FUNC_IN_LOW) && (iopin->pin != GPIO_FUNC_IN_HIGH))
                {
                    PIN_INPUT_ENABLE(GPIO_PIN_MUX_REG[iopin->pin]);
                }
            }
            esp_rom_gpio_pad_unhold(iopin->pin);
        }
    }
    if (!usb->use_external_phy)
    {
        gpio_set_drive_capability((gpio_num_t)USBPHY_DM_NUM, GPIO_DRIVE_CAP_3);
        gpio_set_drive_capability((gpio_num_t)USBPHY_DP_NUM, GPIO_DRIVE_CAP_3);
    }
}

void bringUpNativeUsbHardware()
{
    periph_module_reset(PERIPH_USB_MODULE);
    periph_module_enable(PERIPH_USB_MODULE);

    usb_hal_context_t hal = {.use_external_phy = false};
    usb_hal_init(&hal);
    configureUsbPins(&hal);

    USB0.grstctl |= USB_CSFTRST;
    while ((USB0.grstctl & USB_CSFTRST) == USB_CSFTRST)
    {
    }

    // API nova do TinyUSB (versao vendorizada aqui exige role/speed
    // explicitos - o tusb_init() sem argumentos so' compila se
    // CFG_TUSB_RHPORT0_MODE estiver definido em tusb_config.h, o que nao e'
    // o caso nesse port ESP32 da Adafruit).
    tusb_rhport_init_t rhInit = {.role = TUSB_ROLE_DEVICE, .speed = TUSB_SPEED_AUTO};
    tusb_init(0, &rhInit);

    xTaskCreate(usbHardwareTask, "usbd", USBD_STACK_SZ, NULL, configMAX_PRIORITIES - 1, NULL);
}

// ---------------------------------------------------------------------------
// Pinout - Fase L (+ ajustes de contiguidade fisica, ver
// docs/01-decisoes-arquiteturais.md). Usa o pinout REAL da placa comprada
// (dev board ESP32-S3 c/ headers fisicos esquerdo/direito - ver
// docs/02-hardware.md). Cada subsistema sai inteiro de um unico header:
//   HEADER ESQUERDO (tem 3V3 no topo e GND na base - unico lado c/ alimentacao):
//     - CD4067 (S0-S3, SIG0/SIG1): GPIO4,5,6,7,15,16 - sequencia continua
//       na ordem fisica real do header, logo abaixo do 3V3/RST.
//     - TFT: GPIO9,10,11,12,13,14 - contiguos entre si, na base do header
//       (logo acima do 5V/GND), na ordem fisica de baixo pra cima BLK,CS,
//       DC,RES,SDA,SCL (ver defines abaixo) - escolhido assim (2026-08-31)
//       pra espelhar a ordem fisica do proprio conector da tela (GND,VCC,
//       SCL,SDA,RES,DC,CS,BLK): GND da tela vai pro GND da base do header
//       (mesma extremidade), e subindo os demais sinais casam um a um com
//       a sequencia da tela, sem entrelacar fios. So o VCC foge da
//       sequencia (o 3V3 so existe no topo do header) - fio isolado
//       inevitavel. Isso deixa de formar um unico feixe continuo com o
//       MUX (GPIO17,18,8 ficam livres entre os dois grupos), troca
//       aceita de proposito em favor de bater com o conector da tela.
//   HEADER DIREITO (so GND, encoders usam so pull-up interno - sem VCC):
//     - Encoder 1 + Encoder 2: GPIO1,2,42,41,40,39 - sequencia continua na
//       ordem fisica real do header (...44,1,2,42,41,40,39,38...), pulando
//       so o GPIO38 (LED embutido, ver abaixo). Corrige o pinout anterior
//       (42,41,40 / 37,36,35), que tinha um vao de 2 pinos (39,38) no meio
//       por evitar o GPIO38; como bonus, tambem deixa de depender do
//       GPIO35-37 (risco anotado de PSRAM octal, ver
//       docs/01-decisoes-arquiteturais.md).
// SIG0/SIG1 usam GPIO15/16 (ADC2, nao ADC1) - o conflito classico de ADC2
// e' com o driver Wi-Fi (arbitragem de RF); este projeto nunca inicializa
// Wi-Fi (so' BLE, que nao usa esse caminho), entao a rescricao "so ADC1"
// das fases anteriores foi relaxada aqui de proposito.
// ---------------------------------------------------------------------------

// --- CD4067 (2x, 32 canais) - header ESQUERDO ---
#define MUX_S0 4
#define MUX_S1 5
#define MUX_S2 6
#define MUX_S3 7

#define MUX0_Z 15 // SIG do HW-178 #0 (pads 0-15) - ADC2_4
#define MUX1_Z 16 // SIG do HW-178 #1 (pads 16-31) - ADC2_5

// TESTE TEMPORARIO (2026-09-01) - leitura direta de 2 pinos, sem MUX, pra
// testar um pad dual-zone (canais 0/1, "Pad 1" na UI) enquanto o MUX
// fisico nao chega. GPIO17/18: livres, ADC2, contiguos - ver
// docs/02-hardware.md ("Notas" - pinos livres/sobressalentes). Usados em
// loop() (sobrescreve rawValue[0]/[1] depois do scan dos MUX) e em
// setup() (habilita o pad 0 como PAD_DUAL). Remover quando o MUX chegar.
#define TEST_DIRECT_HEAD_PIN 17
#define TEST_DIRECT_RIM_PIN 18

#define NUM_MUX 2
#define PADS_PER_MUX 16
#define NUM_PADS (NUM_MUX * PADS_PER_MUX) // 32

// --- Tela TFT ST7735 (SPI) - header ESQUERDO, base do header ---
// Ordem fisica de baixo pra cima (perto do GND -> perto do MUX):
// BLK(9), CS(10), DC(11), RES/RST(12), SDA/MOSI(13), SCL/SCLK(14) -
// espelha o conector da propria tela (GND,VCC,SCL,SDA,RES,DC,CS,BLK) na
// direcao oposta (GND da tela = GND da base do header).
#define TFT_BLK 9
#define TFT_CS 10
#define TFT_DC 11
#define TFT_RST 12
#define TFT_MOSI 13
#define TFT_SCLK 14

// ---------------------------------------------------------------------------
// Pinout - 2 encoders rotativos com chave (ENC1 = pagina/pad em foco,
// ENC2 = navegacao/valor - ver design/SPEC.md secao 1) - header DIREITO.
// GPIO38 (fora dessa faixa) foi evitado por acionar um LED embutido
// (BUILTIN LED) dessa placa - o LED RGB endereçável fica no GPIO48
// (ja excluido por outro motivo, ver acima) - ver
// docs/01-decisoes-arquiteturais.md (Fase L).
// ---------------------------------------------------------------------------
#define ENC1_A 1
#define ENC1_B 2
#define ENC1_SW 42

#define ENC2_A 41
#define ENC2_B 40
#define ENC2_SW 39

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
// 2 canais - caixa 3 zonas (centro/pele=head, borda da pele=edge, aro=rim).
// Reusa cymbal3zoneMUX()/cymbal3zoneSensing() da lib (mesma tecnica do prato
// 3 zonas: 2 piezos, o segundo com 2 thresholds em sequencia) - o segundo
// piezo (aro) e' o mesmo lugar onde o PAD_DUAL ja poe o sensor de aro; a
// diferenca e' que aqui distinguimos "vibrou pouco no aro" (edge, hit perto
// da borda da pele) de "vibrou muito no aro" (rim, aro de verdade), em vez
// de tratar qualquer vibracao no aro como uma unica zona. Ver
// docs/01-decisoes-arquiteturais.md e docs/05-tipos-de-sensor.md.
#define PAD_SNARE_3ZONE 8
#define PAD_TYPE_COUNT 9

#define PAD_NO_LINK 255 // valor "nenhum" para hihatPedalChannel[]

bool padTypeUsesSecondChannel(byte type)
{
    return type == PAD_DUAL || type == PAD_CYMBAL_2ZONE || type == PAD_HIHAT_2ZONE || type == PAD_CYMBAL_3ZONE || type == PAD_SNARE_3ZONE;
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
    case PAD_SNARE_3ZONE:
        return "SNR-3Z";
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
// (link do pedal de chimbal) + 1 byte/pad (canal habilitado, Fase N) +
// 1 byte/pad (retrigger, Fase P - persistido separado da lib de proposito,
// ver docs/01-decisoes-arquiteturais.md) + 1 byte/pad (gain, Fase P) +
// 1 byte/pad (xtalk, Fase P) + 1 byte/pad (xtalk_group, Fase P) +
// 1 byte/pad (hihat_invert, Fase X) + 2 bytes de config global
// (midi_channel, midi_output).
// ---------------------------------------------------------------------------
#define EEPROM_BYTES_PER_PAD 10
#define EEPROM_INIT_FLAG_ADDR (NUM_PADS * EEPROM_BYTES_PER_PAD)
#define EEPROM_NAMES_ADDR (EEPROM_INIT_FLAG_ADDR + 1)
#define EEPROM_TYPES_ADDR (EEPROM_NAMES_ADDR + NUM_PADS * PAD_LABEL_MAX_LEN)
#define EEPROM_HIHAT_LINK_ADDR (EEPROM_TYPES_ADDR + NUM_PADS)
#define EEPROM_ENABLED_ADDR (EEPROM_HIHAT_LINK_ADDR + NUM_PADS)
#define EEPROM_RETRIGGER_ADDR (EEPROM_ENABLED_ADDR + NUM_PADS)
#define EEPROM_GAIN_ADDR (EEPROM_RETRIGGER_ADDR + NUM_PADS)
#define EEPROM_XTALK_ADDR (EEPROM_GAIN_ADDR + NUM_PADS)
#define EEPROM_XTALK_GROUP_ADDR (EEPROM_XTALK_ADDR + NUM_PADS)
#define EEPROM_HIHAT_INVERT_ADDR (EEPROM_XTALK_GROUP_ADDR + NUM_PADS)
#define EEPROM_GLOBAL_ADDR (EEPROM_HIHAT_INVERT_ADDR + NUM_PADS)
#define EEPROM_SIZE (EEPROM_GLOBAL_ADDR + 2)
#define EEPROM_INIT_MAGIC 0xA5

#define padLabelEepromAddr(i) (EEPROM_NAMES_ADDR + (i) * PAD_LABEL_MAX_LEN)

// Cada HelloDrumMUX_4067 recebe um muxNum sequencial automatico (0..1, na
// ordem de instanciacao abaixo). Ver docs/01-decisoes-arquiteturais.md.
HelloDrumMUX_4067 mux[NUM_MUX] = {
    HelloDrumMUX_4067(MUX_S0, MUX_S1, MUX_S2, MUX_S3, MUX0_Z),
    HelloDrumMUX_4067(MUX_S0, MUX_S1, MUX_S2, MUX_S3, MUX1_Z),
};

// pads[i] usa i diretamente como indice em rawValue[] (pin_1), pois os 2 MUX
// acima sao instanciados em ordem (muxNum 0..1) e i == muxNum*PADS_PER_MUX +
// canal. Cada pad e' construido com 2 pinos (i, i+1) quando i+1 existe -
// assim um mesmo objeto ja suporta ser usado como single-channel (metodos
// que so leem pin_1) OU dual-channel (metodos que tambem leem pin_2), sem
// precisar reconstruir nada quando o tipo do pad muda em runtime.
//
// [MODIFICADO - projeto DrumCore, 2026-08-31] array default (sem lista de
// inicializadores) - cada pad e' inicializado via pads[i].begin(...) dentro
// do setup() (ver la), nao aqui. Motivo: uma lista de 27+ chamadas de
// construtor nao-trivial nesse array global travava o boot (watchdog reset
// antes do setup(), sem erro visivel) - a inicializacao estatica roda na
// tarefa principal, que tem so 4KB de pilha; sem garantia de RVO (nao
// estamos em C++17), os temporarios de cada elemento podem ficar vivos
// simultaneamente ate o fim da instrucao inteira, e sizeof(HelloDrum)~100
// bytes x 27+ elementos estoura isso. Isolado e confirmado com um teste
// minimo (26 funciona, 27 nao) - ver docs/01-decisoes-arquiteturais.md pro
// diagnostico completo e firmware/lib/HelloDrum-arduino-Library/src/
// hellodrum.h pro construtor padrao + begin() adicionados.
HelloDrum pads[NUM_PADS];

// Objeto USB-MIDI (TinyUSB) + instancia da lib MIDI (FortySevenEffects) usando
// esse objeto como transporte.
Adafruit_USBD_MIDI usb_midi;
MIDI_CREATE_INSTANCE(Adafruit_USBD_MIDI, usb_midi, MIDI);

// Instancia BLE-MIDI (Fase H) - transporte adicional, em paralelo ao
// USB-MIDI acima. "BleMidi" e' a interface MIDI (usada pra enviar
// notas/CC); a macro tambem gera "BLEBleMidi" (o transporte, usado so pra
// registrar os callbacks de conexao). "DrumCore" e' o nome anunciado via
// Bluetooth.
BLEMIDI_CREATE_INSTANCE("DRUMCORE", BleMidi)

volatile bool bleMidiConnected = false;

// Tela TFT (driver ST7735S, variante 1.44" 128x128 - ver Modelo Tela.jpeg).
Adafruit_ST7735 tft(TFT_CS, TFT_DC, TFT_RST);

// Framebuffer off-screen (Fase U) - as telas de navegacao/edicao desenhavam
// direto na tft (fillScreen(COL_BG) + redesenho completo a cada mudanca de
// selecao/valor, nao so' ao trocar de pagina), e o usuario via um flash
// preto visivel a cada toque no encoder. Agora essas telas desenham nesse
// canvas em RAM (mesma API do Adafruit_GFX - "canvas." no lugar de "tft."
// dentro das funcoes render*()) e so' no final renderScreen() manda o frame
// pronto pra tela fisica de uma vez (drawRGBBitmap - uma unica rajada SPI),
// entao o usuario nunca ve um quadro parcial/apagado. 160x128 = 40KB de RAM
// (confortavel - o firmware usa uns 20% dos 320KB do ESP32-S3 antes disso).
// A tela BOOT (renderBoot/renderBootProgress) continua desenhando direto na
// tft - roda so uma vez no boot, nao faz parte do flicker reportado.
GFXcanvas16 canvas(160, 128);

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
// pad independente. padEnabled[i]: false = canal desligado de proposito
// (slot sem sensor fisico conectado, fica flutuando e capta ruido/
// interferencia sem isso) - dispatchSensing()/handlePadResult() ignoram
// esse canal por completo enquanto desligado. Ver
// docs/01-decisoes-arquiteturais.md (Fase N).
byte padTypes[NUM_PADS];
byte hihatPedalChannel[NUM_PADS];
bool channelPrimary[NUM_PADS];
bool padEnabled[NUM_PADS];

// padGain[i]: multiplicador de calibracao (10-200 = 0.10x-2.00x, 100 =
// neutro) aplicado ao rawValue[] ANTES do dispatchSensing() - ver
// applyPadGain(). padXtalk[i]/padXtalkGroup[i]: supressao de crosstalk
// entre pads do mesmo grupo fisico (0 = nenhum grupo/desligado) - ver
// suppressCrosstalk(). Nenhum dos dois precisa de suporte da lib
// vendorizada. Fase P - ver docs/01-decisoes-arquiteturais.md.
byte padGain[NUM_PADS];
byte padXtalk[NUM_PADS];
byte padXtalkGroup[NUM_PADS];

// padHihatInvert[i]: so' relevante pra padTypeIsHihatPedal() (controlador
// de pedal FSR/VH-10/VH-11 ou optico TCRT5000) - alguns sensores mandam o
// sinal de posicao invertido (ex: fisicamente pedal fechado = raw baixo,
// quando o resto do codigo espera raw alto). Aplicado direto no CC final
// (fireControlChange) em vez de no rawValue[] - ver comentario em
// handlePadResult(). Fase X - ver docs/01-decisoes-arquiteturais.md.
bool padHihatInvert[NUM_PADS];

// Forward decls - auto-tune (Fase O). Implementado mais abaixo, perto do
// resto do fluxo de encoders/telas, mas handleSerialCommand() (que fica
// antes no arquivo) tambem precisa poder disparar/cancelar/aplicar.
void startAutoTune(byte pad);
void cancelAutoTune();
bool applyAutoTuneResult(); // false = ainda nao terminou de calibrar (ver AT_DONE)

// Forward decls - encoders virtuais via serial (Fase Q, encoders fisicos
// ainda nao conectados). Mesmo motivo das de auto-tune acima: essas seis
// funcoes sao o handler real de cada encoder fisico (chamadas por
// handleEncoders(), implementado mais abaixo perto das telas), e
// handleSerialCommand() precisa poder chama-las tambem pro comando
// "enc_input" - ver docs/04-protocolo-serial.md.
void onEnc1Rotate(int delta);
void onEnc1Click();
void onEnc1Hold();
void onEnc2Rotate(int delta);
void onEnc2Click();
void onEnc2Hold();

// Configuracao global (GLOBAL) - persistida como um bloco pequeno em EEPROM.
byte midiChannel = DEFAULT_MIDI_CHANNEL;
byte midiOutput = OUTPUT_USB_BLE;

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
    FIELD_ENABLED,
    FIELD_AUTOTUNE,
    FIELD_SENSITIVITY,
    FIELD_THRESHOLD,
    FIELD_SCAN,
    FIELD_MASK,
    FIELD_RETRIGGER,
    FIELD_GAIN,
    FIELD_RIM_SENS,
    FIELD_RIM_THRESH,
    FIELD_CURVE,
    FIELD_NOTE,
    FIELD_NOTE_RIM,
    FIELD_NOTE_CUP,
    FIELD_PEDAL_LINK,
    FIELD_XTALK,
    FIELD_XTALK_GROUP,
    FIELD_HIHAT_INVERT,
};

struct FieldDef
{
    FieldId id;
    const char *label;
    int minVal;
    int maxVal;
    bool accelerates; // true pros campos 1-127 (design/SPEC.md: acelera >8 detents/s)
};

#define MAX_FIELDS_PER_PAD 17

byte getFieldsForType(byte padType, FieldDef *out)
{
    byte n = 0;
    out[n++] = {FIELD_SENSOR, "SENSOR", 0, PAD_TYPE_COUNT - 1, false};
    out[n++] = {FIELD_ENABLED, "ATIVO", 0, 1, false};
    out[n++] = {FIELD_SENSITIVITY, "SENSIB", 1, 100, true};
    out[n++] = {FIELD_THRESHOLD, "THRESH", 1, 100, true};
    out[n++] = {FIELD_SCAN, "SCAN", 1, 100, true};
    out[n++] = {FIELD_MASK, "MASK", 1, 100, true};
    out[n++] = {FIELD_RETRIGGER, "RETRIG", 0, 100, true};
    out[n++] = {FIELD_GAIN, "GAIN", 10, 200, true};

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
    else if (padType == PAD_SNARE_3ZONE)
    {
        out[n++] = {FIELD_RIM_SENS, "EDGETHR", 1, 100, true};
        out[n++] = {FIELD_RIM_THRESH, "RIMTHR", 1, 100, true};
    }
    else if (padTypeIsHihatPedal(padType))
    {
        out[n++] = {FIELD_RIM_SENS, "PEDSENS", 1, 100, true};
        out[n++] = {FIELD_HIHAT_INVERT, "INVERT", 0, 1, false};
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
    else if (padType == PAD_SNARE_3ZONE)
    {
        out[n++] = {FIELD_NOTE_RIM, "N.EDGE", 0, 127, true};
        out[n++] = {FIELD_NOTE_CUP, "N.RIM", 0, 127, true};
    }

    if (padTypeIsHihatCymbal(padType))
    {
        out[n++] = {FIELD_PEDAL_LINK, "PEDAL", -1, NUM_PADS - 1, false};
    }

    // Universal, no fim da lista - supressao de crosstalk entre pads do
    // mesmo grupo fisico (Fase P, ver docs/01-decisoes-arquiteturais.md).
    out[n++] = {FIELD_XTALK, "XTALK", 0, 100, true};
    out[n++] = {FIELD_XTALK_GROUP, "XGRUPO", 0, 4, false};

    // Universal, sempre o ultimo item - "clicar" aqui (sem entrar em modo de
    // edicao) dispara o assistente de auto-calibracao (Fase O). Ver
    // docs/01-decisoes-arquiteturais.md.
    out[n++] = {FIELD_AUTOTUNE, "CALIBRAR", 0, 0, false};

    return n;
}

int getFieldValue(byte padIndex, FieldId id)
{
    HelloDrum &p = pads[padIndex];
    switch (id)
    {
    case FIELD_SENSOR:
        return padTypes[padIndex];
    case FIELD_ENABLED:
        return padEnabled[padIndex] ? 1 : 0;
    case FIELD_SENSITIVITY:
        return p.sensitivity;
    case FIELD_THRESHOLD:
        return p.threshold1;
    case FIELD_SCAN:
        return p.scantime;
    case FIELD_MASK:
        return p.masktime;
    case FIELD_RETRIGGER:
        return p.retrigger;
    case FIELD_GAIN:
        return padGain[padIndex];
    case FIELD_XTALK:
        return padXtalk[padIndex];
    case FIELD_XTALK_GROUP:
        return padXtalkGroup[padIndex];
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
    case FIELD_HIHAT_INVERT:
        return padHihatInvert[padIndex] ? 1 : 0;
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
    case FIELD_ENABLED:
        padEnabled[padIndex] = (value != 0);
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
    case FIELD_RETRIGGER:
        p.retrigger = value;
        break;
    case FIELD_GAIN:
        padGain[padIndex] = value;
        break;
    case FIELD_XTALK:
        padXtalk[padIndex] = value;
        break;
    case FIELD_XTALK_GROUP:
        padXtalkGroup[padIndex] = value;
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
    case FIELD_HIHAT_INVERT:
        padHihatInvert[padIndex] = (value != 0);
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
    PAGE_AUTOTUNE, // Fase O - ver docs/01-decisoes-arquiteturais.md
};

ScreenPage currentPage = PAGE_BOOT;
bool forceScreenRedraw = true;

byte padsListSelection = 0; // 0-31, pad selecionado na lista PADS
byte padsListTop = 0;       // primeira linha visivel (janela de 8)

byte editPadIndex = 0;  // pad em foco em PAD_EDIT/SIGNAL
byte editItemIndex = 0; // item selecionado dentro de PAD_EDIT
bool editingValue = false;

byte globalSelection = 0; // 0..3 (MIDI CH, SAIDA, SALVAR, RESTAURAR)
bool globalEditing = false;

#define GLOBAL_ROW_MIDI_CH 0
#define GLOBAL_ROW_OUTPUT 1
#define GLOBAL_ROW_SAVE 2
#define GLOBAL_ROW_RESTORE 3
#define GLOBAL_ROW_COUNT 4

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

// zone: "bow" (padrao/unico zone), "rim", "edge", "cup", "head" (centro da
// pele, PAD_SNARE_3ZONE), "pedal" ou "choke".
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
    doc["enabled"] = padEnabled[padIndex];
    doc["retrigger"] = pads[padIndex].retrigger;
    doc["gain"] = padGain[padIndex];
    doc["xtalk"] = padXtalk[padIndex];
    doc["xtalk_group"] = padXtalkGroup[padIndex];
    doc["hihat_invert"] = padHihatInvert[padIndex];
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

void persistPadEnabled(byte i)
{
    EEPROM_ESP.write(EEPROM_ENABLED_ADDR + i, padEnabled[i] ? 1 : 0);
    EEPROM_ESP.commit();
}

void persistPadRetrigger(byte i)
{
    EEPROM_ESP.write(EEPROM_RETRIGGER_ADDR + i, pads[i].retrigger);
    EEPROM_ESP.commit();
}

void persistPadGain(byte i)
{
    EEPROM_ESP.write(EEPROM_GAIN_ADDR + i, padGain[i]);
    EEPROM_ESP.commit();
}

void persistPadXtalk(byte i)
{
    EEPROM_ESP.write(EEPROM_XTALK_ADDR + i, padXtalk[i]);
    EEPROM_ESP.commit();
}

void persistPadXtalkGroup(byte i)
{
    EEPROM_ESP.write(EEPROM_XTALK_GROUP_ADDR + i, padXtalkGroup[i]);
    EEPROM_ESP.commit();
}

void persistPadHihatInvert(byte i)
{
    EEPROM_ESP.write(EEPROM_HIHAT_INVERT_ADDR + i, padHihatInvert[i] ? 1 : 0);
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
        EEPROM_ESP.write(EEPROM_ENABLED_ADDR + i, padEnabled[i] ? 1 : 0);
        EEPROM_ESP.write(EEPROM_RETRIGGER_ADDR + i, pads[i].retrigger);
        EEPROM_ESP.write(EEPROM_GAIN_ADDR + i, padGain[i]);
        EEPROM_ESP.write(EEPROM_XTALK_ADDR + i, padXtalk[i]);
        EEPROM_ESP.write(EEPROM_XTALK_GROUP_ADDR + i, padXtalkGroup[i]);
        EEPROM_ESP.write(EEPROM_HIHAT_INVERT_ADDR + i, padHihatInvert[i] ? 1 : 0);
    }
    EEPROM_ESP.write(EEPROM_GLOBAL_ADDR, midiChannel);
    EEPROM_ESP.write(EEPROM_GLOBAL_ADDR + 1, midiOutput);
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
        padEnabled[i] = EEPROM_ESP.read(EEPROM_ENABLED_ADDR + i) != 0;
        pads[i].retrigger = EEPROM_ESP.read(EEPROM_RETRIGGER_ADDR + i);
        padGain[i] = EEPROM_ESP.read(EEPROM_GAIN_ADDR + i);
        if (padGain[i] < 10 || padGain[i] > 200)
        {
            padGain[i] = 100; // valor invalido (ex: EEPROM virgem) - neutro
        }
        padXtalk[i] = EEPROM_ESP.read(EEPROM_XTALK_ADDR + i);
        padXtalkGroup[i] = EEPROM_ESP.read(EEPROM_XTALK_GROUP_ADDR + i);
        if (padXtalkGroup[i] > 4)
        {
            padXtalkGroup[i] = 0;
        }
        padHihatInvert[i] = EEPROM_ESP.read(EEPROM_HIHAT_INVERT_ADDR + i) != 0;
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

    if (strcmp(field, "enabled") == 0)
    {
        long enabledValue = doc["value"] | -1;
        if (enabledValue != 0 && enabledValue != 1)
        {
            sendError("set_pad", "value_out_of_range");
            return;
        }

        padEnabled[pad] = (enabledValue == 1);
        persistPadEnabled(pad);
        sendPadConfig(pad);
        return;
    }

    if (strcmp(field, "hihat_invert") == 0)
    {
        long invertValue = doc["value"] | -1;
        if (invertValue != 0 && invertValue != 1)
        {
            sendError("set_pad", "value_out_of_range");
            return;
        }

        padHihatInvert[pad] = (invertValue == 1);
        persistPadHihatInvert(pad);
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
    else if (strcmp(field, "retrigger") == 0)
    {
        if (value < 0 || value > 100) { sendError("set_pad", "value_out_of_range"); return; }
        pads[pad].retrigger = value;
        persistPadRetrigger(pad);
        sendAck("set_pad", pad, field, value);
        return;
    }
    else if (strcmp(field, "gain") == 0)
    {
        if (value < 10 || value > 200) { sendError("set_pad", "value_out_of_range"); return; }
        padGain[pad] = value;
        persistPadGain(pad);
        sendAck("set_pad", pad, field, value);
        return;
    }
    else if (strcmp(field, "xtalk") == 0)
    {
        if (value < 0 || value > 100) { sendError("set_pad", "value_out_of_range"); return; }
        padXtalk[pad] = value;
        persistPadXtalk(pad);
        sendAck("set_pad", pad, field, value);
        return;
    }
    else if (strcmp(field, "xtalk_group") == 0)
    {
        if (value < 0 || value > 4) { sendError("set_pad", "value_out_of_range"); return; }
        padXtalkGroup[pad] = value;
        persistPadXtalkGroup(pad);
        sendAck("set_pad", pad, field, value);
        return;
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
    else
    {
        sendError("set_global", "unknown_field");
        return;
    }

    EEPROM_ESP.write(EEPROM_GLOBAL_ADDR, midiChannel);
    EEPROM_ESP.write(EEPROM_GLOBAL_ADDR + 1, midiOutput);
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
    else if (strcmp(cmd, "start_autotune") == 0)
    {
        int pad = doc["pad"] | -1;
        if (pad < 0 || pad >= NUM_PADS || !channelPrimary[pad])
        {
            sendError(cmd, "invalid_pad");
            return;
        }
        if (!padEnabled[pad])
        {
            sendError(cmd, "channel_disabled");
            return;
        }
        startAutoTune((byte)pad);
    }
    else if (strcmp(cmd, "cancel_autotune") == 0)
    {
        cancelAutoTune();
    }
    else if (strcmp(cmd, "apply_autotune") == 0)
    {
        if (!applyAutoTuneResult())
        {
            sendError(cmd, "not_ready");
        }
    }
    else if (strcmp(cmd, "enc_input") == 0)
    {
        // Encoder virtual (app desktop) - mesma semantica dos fisicos (ver
        // design/SPEC.md secao 1). Sem resposta dedicada: o resultado ja'
        // aparece na tela fisica do modulo, que e' a fonte da verdade de
        // navegacao (o app nao espelha currentPage/editItemIndex/etc).
        int enc = doc["enc"] | 0;
        const char *action = doc["action"] | "";
        if (enc != 1 && enc != 2)
        {
            sendError(cmd, "invalid_enc");
            return;
        }
        if (strcmp(action, "rotate") == 0)
        {
            int delta = doc["delta"] | 1;
            if (delta == 0)
            {
                sendError(cmd, "invalid_delta");
                return;
            }
            if (enc == 1) onEnc1Rotate(delta); else onEnc2Rotate(delta);
        }
        else if (strcmp(action, "click") == 0)
        {
            if (enc == 1) onEnc1Click(); else onEnc2Click();
        }
        else if (strcmp(action, "hold") == 0)
        {
            if (enc == 1) onEnc1Hold(); else onEnc2Hold();
        }
        else
        {
            sendError(cmd, "invalid_action");
        }
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

    case PAD_DUAL:
    {
        // Bug encontrado 2026-08-22: faltava esse case desde a Fase G -
        // um pad PAD_DUAL nunca enviava hit/nota nenhuma (nem head nem
        // rim), apesar do protocolo (docs/04-protocolo-serial.md) e o
        // modo demo do app desktop (mockDevice.ts) ja preverem as zonas
        // "head"/"rim" pra esse tipo. Ver docs/01-decisoes-arquiteturais.md.
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

    case PAD_SNARE_3ZONE:
    {
        // Mesma sensing do prato 3 zonas (cymbal3zoneMUX/Sensing na lib
        // vendorizada), so' com zonas renomeadas pro contexto de caixa:
        // hit=centro da pele, hitRim=borda da pele (vibracao leve no
        // sensor do aro), hitCup=aro de verdade (vibracao forte no
        // sensor do aro). Ver define de PAD_SNARE_3ZONE mais acima.
        if (pad.hit)
        {
            sendHitEvent(i, "head", pad.note, pad.velocity);
            fireNote(pad.note, pad.velocity);
        }
        if (pad.hitRim)
        {
            sendHitEvent(i, "edge", pad.noteEdge, pad.velocity);
            fireNote(pad.noteEdge, pad.velocity);
        }
        if (pad.hitCup)
        {
            sendHitEvent(i, "rim", pad.noteCup, pad.velocity);
            fireNote(pad.noteCup, pad.velocity);
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

        // [Fase X] "Inverter" (padHihatInvert) flipa o CC final (127-CC),
        // nao o rawValue[] - assim tem efeito imediato ao ligar/desligar,
        // sem precisar recalibrar (threshold/sensitivity continuam
        // calibrados pro sensor "como ele e'"). Ver docs/01-decisoes-
        // arquiteturais.md.
        byte cc = padHihatInvert[i] ? (byte)(127 - pad.pedalCC) : pad.pedalCC;
        static byte lastPedalCC[NUM_PADS] = {0};
        if (cc != lastPedalCC[i])
        {
            lastPedalCC[i] = cc;
            fireControlChange(HIHAT_PEDAL_CC, cc);
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
    case PAD_SNARE_3ZONE:
        pads[i].cymbal3zoneMUX(); // mesma sensing do prato 3 zonas - ver define de PAD_SNARE_3ZONE
        break;
    case PAD_HIHAT_PEDAL:
        pads[i].hihatControlMUX();
        break;
    case PAD_HIHAT_OPTICAL:
        pads[i].TCRT5000MUX();
        break;
    }
}

// Resolucao do ADC do ESP32-S3 (12 bits) - mesmo valor usado internamente
// pela lib pra normalizar rawValue[] (ver comentario de applyPadGain()).
#define ADC_RAW_MAX 4095

// Gain (Fase P, ver docs/01-decisoes-arquiteturais.md) - multiplicador de
// calibracao por pad (padGain[], 10-200 = 0.10x-2.00x, 100 = neutro).
// Aplicado direto no rawValue[] ANTES do dispatchSensing() usar esse valor
// - nao precisa de nenhuma mudanca na lib vendorizada. Escala o valor bruto
// a partir do repouso (rawValue perto de 0 quando nada esta sendo tocado -
// circuito real confirmado na Fase S, piezo + resistor de 100k em
// paralelo, ver docs/01-decisoes-arquiteturais.md), preservando esse
// repouso ~0 independente do gain escolhido.
//
// [MODIFICADO - projeto DrumCore, 2026-09-02] a formula original escalava
// o desvio em relacao ao TOPO da escala (ADC_RAW_MAX - rawValue[i]),
// assumindo repouso perto de ADC_RAW_MAX - a mesma suposicao invertida
// encontrada e corrigida em hellodrum.cpp e em autoTuneTick() na Fase S,
// so' que essa copia ficou pra tras. Com gain=100 (neutro, o padrao) a
// formula antiga virava um no-op (por isso nunca deu sintoma visivel
// ainda) - mas assim que alguem calibrar o gain de um pad pra != 100, ia
// escalar na direcao errada.
void applyPadGain()
{
    for (byte i = 0; i < NUM_PADS; i++)
    {
        if (!channelPrimary[i] || !padEnabled[i] || padGain[i] == 100)
        {
            continue;
        }

        float g = padGain[i] / 100.0f;
        rawValue[i] = (int)(g * rawValue[i]);
        rawValue[i] = constrain(rawValue[i], 0, ADC_RAW_MAX);

        if (padTypeUsesSecondChannel(padTypes[i]))
        {
            rawValue[i + 1] = (int)(g * rawValue[i + 1]);
            rawValue[i + 1] = constrain(rawValue[i + 1], 0, ADC_RAW_MAX);
        }
    }
}

// Crosstalk (Fase P, ver docs/01-decisoes-arquiteturais.md) - roda depois
// do dispatchSensing() (que ja decidiu hit/velocity via a lib) e antes do
// handlePadResult() (que decide o que sai por MIDI/protocolo). Um hit e'
// descartado se outro pad do MESMO grupo (padXtalkGroup[], 0 = nenhum)
// bateu bem mais forte no mesmo ciclo de loop() - modela vibracao mecanica
// entre pads montados juntos (ex: mesmo rack) e/ou crosstalk eletrico
// entre canais que o usuario souber que interferem entre si (inclusive os
// dois CD4067 que compartilham o barramento S0-S3 - ver
// docs/02-hardware.md). padXtalk[] (0-100) controla o quao agressiva e' a
// supressao: 0 desliga; valores altos toleram so' uma diferenca pequena
// antes de suprimir.
void suppressCrosstalk()
{
    byte padPeak[NUM_PADS] = {0};

    for (byte i = 0; i < NUM_PADS; i++)
    {
        if (!channelPrimary[i] || !padEnabled[i])
        {
            continue;
        }
        HelloDrum &p = pads[i];
        byte v = 0;
        if (p.hit && p.velocity > v) v = p.velocity;
        if (p.hitRim && p.velocityRim > v) v = p.velocityRim;
        if (p.hitCup && p.velocityCup > v) v = p.velocityCup;
        padPeak[i] = v;
    }

    for (byte i = 0; i < NUM_PADS; i++)
    {
        if (!channelPrimary[i] || !padEnabled[i] || padXtalkGroup[i] == 0 || padXtalk[i] == 0 || padPeak[i] == 0)
        {
            continue;
        }

        byte otherMax = 0;
        for (byte j = 0; j < NUM_PADS; j++)
        {
            if (j == i || !channelPrimary[j] || !padEnabled[j] || padXtalkGroup[j] != padXtalkGroup[i])
            {
                continue;
            }
            if (padPeak[j] > otherMax)
            {
                otherMax = padPeak[j];
            }
        }
        if (otherMax == 0)
        {
            continue; // nenhum outro pad do grupo bateu nesse ciclo
        }

        int margin = (100 - padXtalk[i]) * 127 / 100;
        if (otherMax > padPeak[i] && (otherMax - padPeak[i]) > margin)
        {
            HelloDrum &p = pads[i];
            p.hit = false;
            p.hitRim = false;
            p.hitCup = false;
        }
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

// ---------------------------------------------------------------------------
// Auto-tune (Fase O) - assistente de auto-calibracao inspirado no recurso
// "Auto Tune" do microDRUM/nanoDRUM (github.com/massimobernava/md-firmware,
// c_pin.ino/l_loop.ino) - ver docs/01-decisoes-arquiteturais.md pro racional
// completo e as simplificacoes assumidas em relacao ao original.
//
// So calibra o sensor principal do pad (pin_1/piezoValue) - pads de 2 canais
// (aro/borda/cup) continuam precisando de ajuste manual pro 2o sensor.
// ---------------------------------------------------------------------------
enum AutoTuneState : byte
{
    AT_IDLE,
    AT_NOISE,     // fase 1: mede o ruido de fundo (usuario nao toca no pad)
    AT_WAITING,   // esperando a proxima pancada
    AT_RISING,    // pancada em andamento, procurando o pico
    AT_DECAYING,  // pico encontrado, esperando o sinal cair pra metade (mask_time)
    AT_COOLDOWN,  // intervalo entre uma pancada e a proxima
    AT_HH_OPEN,   // [Fase X] controlador de pedal (HHC) - captura a posicao "solto"
    AT_HH_CLOSED, // [Fase X] controlador de pedal (HHC) - captura a posicao "pressionado"
    AT_DONE,      // resultado calculado, esperando confirmacao
    AT_ABORTED,   // cancelado (timeout ou canal desligado) - ver atAbortedReason
};

enum AutoTuneAbortReason : byte
{
    AT_ABORT_TIMEOUT,
    AT_ABORT_DISABLED,
};

// [MODIFICADO - projeto DrumCore, 2026-09-02] 3 niveis de intensidade
// (fraco/medio/forte), 8 batidas cada (24 no total, era so' 8 de
// intensidade unica) - a pedido do Rodrigo, pra deixar a calibracao mais
// precisa: o nivel FRACO calibra o piso (threshold, garante que toques
// leves disparem), o FORTE calibra o teto (sensitivity, velocity 127 de
// verdade numa pancada forte de verdade), o MEDIO serve de conferencia
// (nao alimenta a formula final, so' e' guardado/enviado pro app). Ver
// finishAutoTune() e docs/01-decisoes-arquiteturais.md.
enum AutoTuneTier : byte
{
    AT_TIER_WEAK,
    AT_TIER_MEDIUM,
    AT_TIER_STRONG,
};
#define AUTOTUNE_TIER_COUNT 3

// [Fase U/V] Pads de 2 canais fazem 1 ou 2 rodadas EXTRAS de calibracao
// (mais 3 niveis x 8 golpes cada) depois da passada normal no canal
// principal (que vira a zona "PRIMARY") - quantas rodadas extras e o que
// cada uma mede dependem de COMO a lib classifica a zona, que varia por
// "formato" de pad (AutoTuneShape):
//
// - AT_SHAPE_DUAL (so' PAD_DUAL, pele+aro): dualPiezoSensing() nao decide
//   pele-vs-aro olhando cada piezo isolado - compara os picos dos DOIS
//   canais do MESMO golpe (os dois sempre disparam juntos, um "vaza" pro
//   outro): `(velocity - velocityRim < rimSensitivity) && (velocityRim >
//   rimThreshold)`. 1 rodada extra (zona SECONDARY = aro), medindo o pico
//   do aro E o vazamento cruzado com a pele em cada golpe.
// - AT_SHAPE_TRI (PAD_CYMBAL_3ZONE/PAD_SNARE_3ZONE): cymbal3zoneSensing()
//   usa so' 2 canais fisicos tambem, mas a 3a zona (cup/aro-forte) vem de
//   uma FAIXA de threshold mais alta no MESMO canal secundario (edge e
//   cup nao sao diferenca entre 2 canais, sao 2 niveis no canal do
//   aro/borda) - ver `cupThreshold`/`edgeThreshold` em cymbal3zoneSensing().
//   2 rodadas extras (SECONDARY = edge/borda, TERTIARY = cup/aro-forte),
//   cada uma so' medindo o pico do canal secundario nessa faixa (sem
//   diferenca entre canais - o vazamento da PRIMARY so' entra pra achar o
//   piso do threshold de edge, igual no DUAL).
//
// Sem golpes reais nas zonas extras pra medir isso, os campos
// rimSensitivity/rimThreshold (reaproveitados com significado diferente
// por formato - ver getFieldsForType()) so' davam pra ajustar na mao. Ver
// docs/01-decisoes-arquiteturais.md.
enum AutoTuneShape : byte
{
    AT_SHAPE_SINGLE, // 1 canal - so' a rodada PRIMARY (comportamento de sempre)
    AT_SHAPE_DUAL,   // PAD_DUAL - 1 rodada extra, classificacao por DIFERENCA entre 2 canais
    AT_SHAPE_TRI,    // PAD_CYMBAL_3ZONE/PAD_SNARE_3ZONE - 2 rodadas extras, 3a zona por FAIXA de threshold no canal secundario
};

enum AutoTuneZone : byte
{
    AT_ZONE_PRIMARY,
    AT_ZONE_SECONDARY,
    AT_ZONE_TERTIARY, // so' usada em AT_SHAPE_TRI
};

#define AUTOTUNE_NOISE_MS 2000
#define AUTOTUNE_HIT_TARGET 8 // por nivel - 24 batidas no total (AUTOTUNE_TIER_COUNT niveis)
#define AUTOTUNE_RISE_SETTLE_MS 8
#define AUTOTUNE_DECAY_TIMEOUT_MS 500
#define AUTOTUNE_COOLDOWN_MS 30
#define AUTOTUNE_WAIT_TIMEOUT_MS 15000

// [Fase X] Controlador de pedal (HHC) - assistente completamente diferente
// do baseado em pancada acima: nao ha' "golpe" nenhum, e' um sensor de
// POSICAO continua. So' pede pro usuario segurar em 2 posicoes (solto,
// depois pressionado) por AUTOTUNE_HH_HOLD_MS cada, e amostra so' o
// ultimo AUTOTUNE_HH_SAMPLE_MS de cada uma (da tempo do usuario chegar na
// posicao e o sinal assentar antes de comecar a contar).
#define AUTOTUNE_HH_HOLD_MS 3000
#define AUTOTUNE_HH_SAMPLE_MS 1000

AutoTuneState atState = AT_IDLE;
AutoTuneTier atTier = AT_TIER_WEAK;
byte atPad = 0;
byte atSavedGain = 100; // gain original do pad, salvo em startAutoTune() - ver comentario la
unsigned long atPhaseStartMs = 0;
unsigned long atLastCountdownMs = 0; // so' pra redesenhar a contagem regressiva do AT_NOISE 1x/segundo
int atNoiseFloor = 0;
byte atHitCount = 0; // zera a cada nivel (0..AUTOTUNE_HIT_TARGET)
int atHitPeak = 0;
unsigned long atHitStartMs = 0;
unsigned long atPeakAtMs = 0;
long atSumScanMs = 0; // acumulado nos 3 niveis - timing nao varia muito por forca
long atSumMaskMs = 0;
long atSumPeakByTier[AUTOTUNE_TIER_COUNT] = {0, 0, 0};
byte atResultSensitivity = 0;
byte atResultThreshold = 0;
byte atResultScan = 0;
byte atResultMask = 0;
AutoTuneAbortReason atAbortedReason = AT_ABORT_TIMEOUT;

// [Fase U/V] Estado das rodadas extras (canal secundario) - ver comentario
// grande no enum AutoTuneShape acima pro racional completo.
AutoTuneShape atShape = AT_SHAPE_SINGLE;
AutoTuneZone atZone = AT_ZONE_PRIMARY;
int atOtherPeak = 0;             // pico do canal PASSIVO (o que o usuario NAO esta' batendo agora) durante o golpe atual - so' usado em AT_SHAPE_DUAL
int atCrossFloor = 0;            // pior vazamento visto no canal secundario durante golpes na zona PRIMARY (qualquer shape com 2 canais)
long atMaxHeadRimDiff = -100000; // pior (primary - secondary) visto durante golpes reais na zona SECONDARY - so' usado em AT_SHAPE_DUAL. Sentinela bem negativa, sobrescrita no 1o golpe
long atSumRimPeakByTier[AUTOTUNE_TIER_COUNT] = {0, 0, 0};  // picos da zona SECONDARY (aro em DUAL, edge/borda em TRI)
long atSumCupByTier[AUTOTUNE_TIER_COUNT] = {0, 0, 0};      // picos da zona TERTIARY (cup/aro-forte) - so' usado em AT_SHAPE_TRI
byte atResultRimSensitivity = 0; // vai no campo rimSensitivity do pad - "aro" em DUAL, "edge threshold" em TRI (ver getFieldsForType)
byte atResultRimThreshold = 0;   // vai no campo rimThreshold do pad - "aro" em DUAL, "cup threshold" em TRI

// [Fase X] Captura de range do controlador de pedal (HHC) - ver comentario
// em AUTOTUNE_HH_HOLD_MS acima.
long atHhSampleSum = 0;
int atHhSampleCount = 0;
int atHhOpenRaw = 0;   // media amostrada com o pedal solto/aberto
int atHhClosedRaw = 0; // media amostrada com o pedal pressionado/fechado

const char *autoTuneTierName(AutoTuneTier tier)
{
    switch (tier)
    {
    case AT_TIER_WEAK:
        return "weak";
    case AT_TIER_MEDIUM:
        return "medium";
    case AT_TIER_STRONG:
        return "strong";
    }
    return "weak";
}

// Nomes da zona pro protocolo JSON - reaproveita exatamente o mesmo
// vocabulario ja usado no evento "hit" (zone: "head"/"rim"/"bow"/"edge"/
// "cup" - ver sendHitEvent() em dispatchHit() e docs/04-protocolo-serial.md)
// em vez de nomes genericos tipo "secondary", pra ficar consistente com o
// resto do protocolo.
const char *autoTuneZoneName(byte padType, AutoTuneZone zone)
{
    if (padType == PAD_DUAL)
    {
        return zone == AT_ZONE_SECONDARY ? "rim" : "head";
    }
    if (padType == PAD_CYMBAL_3ZONE)
    {
        if (zone == AT_ZONE_SECONDARY) return "edge";
        if (zone == AT_ZONE_TERTIARY) return "cup";
        return "bow";
    }
    if (padType == PAD_SNARE_3ZONE)
    {
        if (zone == AT_ZONE_SECONDARY) return "edge";
        if (zone == AT_ZONE_TERTIARY) return "rim";
        return "head";
    }
    return "primary";
}

// Rotulo curto pra tela fisica (PAD_EDIT>CALIBRAR) - mesma zona, texto
// PT-BR/curto pra caber na tela pequena.
const char *autoTuneZoneTftLabel(byte padType, AutoTuneZone zone)
{
    if (padType == PAD_DUAL)
    {
        return zone == AT_ZONE_SECONDARY ? "ARO" : "PELE";
    }
    if (padType == PAD_CYMBAL_3ZONE)
    {
        if (zone == AT_ZONE_SECONDARY) return "EDGE";
        if (zone == AT_ZONE_TERTIARY) return "CUP";
        return "BOW";
    }
    if (padType == PAD_SNARE_3ZONE)
    {
        if (zone == AT_ZONE_SECONDARY) return "BORDA";
        if (zone == AT_ZONE_TERTIARY) return "ARO";
        return "PELE";
    }
    return "";
}

// Quantas rodadas EXTRAS (alem da PRIMARY) esse formato de pad precisa, e
// qual a proxima zona - usado pelo avanco de rodada em autoTuneTick().
bool autoTuneHasNextZone(AutoTuneShape shape, AutoTuneZone zone)
{
    if (shape == AT_SHAPE_SINGLE) return false;
    if (shape == AT_SHAPE_DUAL) return zone == AT_ZONE_PRIMARY;
    return zone == AT_ZONE_PRIMARY || zone == AT_ZONE_SECONDARY; // AT_SHAPE_TRI
}

AutoTuneZone autoTuneNextZone(AutoTuneZone zone)
{
    return zone == AT_ZONE_PRIMARY ? AT_ZONE_SECONDARY : AT_ZONE_TERTIARY;
}

// [Fase X] Mesma transformacao que FSRSensing()/TCRT5000Sensing() aplicam
// no valor bruto ANTES de comparar com threshold/sensitivity (ver
// hellodrum.cpp) - o assistente de captura de range do HHC precisa
// reproduzir isso pra gravar threshold/sensitivity na MESMA escala que a
// sensing de verdade vai usar depois. PAD_HIHAT_OPTICAL usa o raw de 12
// bits direto (TCRT = 4096 - raw); PAD_HIHAT_PEDAL (FSR) normaliza pra 10
// bits primeiro (fsr = 1023 - raw/4).
int hihatInternalValue(byte padType, int raw12bit)
{
    if (padType == PAD_HIHAT_OPTICAL)
    {
        return 4096 - raw12bit;
    }
    return 1023 - raw12bit / 4; // PAD_HIHAT_PEDAL
}

// threshold/sensitivity sao campos 1-100 na UI, multiplicados por isso
// pra virar raw internamente (ver TCRT5000Sensing()/FSRSensing()).
int hihatFieldMultiplier(byte padType)
{
    return padType == PAD_HIHAT_OPTICAL ? 40 : 10;
}

// Espelha o estado do assistente pro app desktop (Fase O) - emitido a cada
// mudanca de estado relevante, nao so' em resposta a comando (pra dar
// progresso em tempo real: contagem regressiva do ruido, golpes capturados
// etc). Ver docs/04-protocolo-serial.md.
void sendAutoTuneStatus()
{
    JsonDocument doc;
    doc["type"] = "autotune_status";
    doc["pad"] = atPad;

    switch (atState)
    {
    case AT_IDLE:
        doc["state"] = "idle";
        break;
    case AT_NOISE:
        doc["state"] = "noise";
        break;
    case AT_WAITING:
    case AT_RISING:
    case AT_DECAYING:
    case AT_COOLDOWN:
        doc["state"] = "collecting";
        doc["tier"] = autoTuneTierName(atTier);
        doc["tier_index"] = atTier + 1;
        doc["tier_count"] = AUTOTUNE_TIER_COUNT;
        if (atShape != AT_SHAPE_SINGLE)
        {
            doc["zone"] = autoTuneZoneName(padTypes[atPad], atZone);
        }
        break;
    case AT_HH_OPEN:
    case AT_HH_CLOSED:
        // [Fase X] Sensor de posicao continua - sem "golpes"/niveis, so'
        // segura em 2 posicoes por um tempo (ver AUTOTUNE_HH_HOLD_MS).
        doc["state"] = "collecting";
        doc["phase"] = atState == AT_HH_OPEN ? "hh_open" : "hh_closed";
        doc["hold_elapsed_ms"] = (long)(millis() - atPhaseStartMs);
        doc["hold_target_ms"] = AUTOTUNE_HH_HOLD_MS;
        break;
    case AT_DONE:
        doc["state"] = "done";
        break;
    case AT_ABORTED:
        doc["state"] = "aborted";
        doc["reason"] = atAbortedReason == AT_ABORT_DISABLED ? "channel_disabled" : "timeout";
        break;
    }

    doc["hit_count"] = atHitCount;
    doc["hit_target"] = AUTOTUNE_HIT_TARGET;

    if (atState == AT_DONE)
    {
        doc["sensitivity"] = atResultSensitivity;
        doc["threshold"] = atResultThreshold;
        doc["scan_time"] = atResultScan;
        doc["mask_time"] = atResultMask;
        if (atShape != AT_SHAPE_SINGLE)
        {
            doc["rim_sensitivity"] = atResultRimSensitivity;
            doc["rim_threshold"] = atResultRimThreshold;
        }
        if (padTypeIsHihatPedal(padTypes[atPad]))
        {
            // Avisa o app que sensitivity/threshold acima sao min/max de
            // posicao (pedal aberto/fechado), nao pico de pancada - a tela
            // de resultado deve rotular/explicar diferente.
            doc["mode"] = "hihat_range";
        }
    }

    sendJsonLine(doc);
}

void startAutoTune(byte pad)
{
    atPad = pad;
    // [Fase X] Controlador de pedal (HHC) e' um sensor de POSICAO continua,
    // nao um sensor de impacto - pula direto pra captura de range (sem
    // AT_NOISE, sem niveis/zonas de pancada). Ver AUTOTUNE_HH_HOLD_MS.
    atState = padTypeIsHihatPedal(padTypes[pad]) ? AT_HH_OPEN : AT_NOISE;
    atTier = AT_TIER_WEAK;
    atZone = AT_ZONE_PRIMARY;
    // ver comentario no enum AutoTuneShape
    if (padTypes[pad] == PAD_DUAL)
    {
        atShape = AT_SHAPE_DUAL;
    }
    else if (padTypes[pad] == PAD_CYMBAL_3ZONE || padTypes[pad] == PAD_SNARE_3ZONE)
    {
        atShape = AT_SHAPE_TRI;
    }
    else
    {
        atShape = AT_SHAPE_SINGLE;
    }
    atPhaseStartMs = millis();
    atNoiseFloor = 0;
    atHitCount = 0;
    atSumScanMs = 0;
    atSumMaskMs = 0;
    atSumPeakByTier[0] = 0;
    atSumPeakByTier[1] = 0;
    atSumPeakByTier[2] = 0;
    atSumRimPeakByTier[0] = 0;
    atSumRimPeakByTier[1] = 0;
    atSumRimPeakByTier[2] = 0;
    atSumCupByTier[0] = 0;
    atSumCupByTier[1] = 0;
    atSumCupByTier[2] = 0;
    atCrossFloor = 0;
    atMaxHeadRimDiff = -100000;
    atHhSampleSum = 0;
    atHhSampleCount = 0;
    atHhOpenRaw = 0;
    atHhClosedRaw = 0;
    atLastCountdownMs = atPhaseStartMs;

    // [Fase W] O pad entra na calibracao com o "gain" (Fase P) que ja
    // tinha de uma calibracao anterior - se nao for 100 (neutro), ele
    // escala rawValue[] (ver applyPadGain(), roda todo loop() ANTES de
    // autoTuneTick() ler o mesmo rawValue[] global compartilhado com a
    // lib - ver "int rawValue[]" em hellodrum.cpp) antes do assistente
    // sequer ver o valor. Isso quebra especialmente o nivel FRACO: a
    // margem de seguranca do piso de ruido (atNoiseFloor*1.3+5, calculada
    // JA em cima do valor escalado) tem um "+5" fixo que nao escala junto
    // - com gain baixo, um toque fraco de verdade pode nao conseguir
    // superar esse piso. Forcamos o gain pra 100 (neutro) durante TODA a
    // calibracao, pra o assistente sempre partir "do zero" (aplicado
    // tambem na lib de verdade, ja que rawValue[] e' compartilhado -
    // consistente com o resultado calculado, que assume gain neutro).
    // Restaurado em cancelAutoTune()/goToLive() se o usuario nao aplicar;
    // fica em 100 de proposito se aplicar (ver applyAutoTuneResult()).
    atSavedGain = padGain[pad];
    padGain[pad] = 100;

    currentPage = PAGE_AUTOTUNE;
    forceScreenRedraw = true;
    sendAutoTuneStatus();
}

// So calcula os resultados (RAM) - nao aplica ainda, ver applyAutoTuneResult().
void finishAutoTune()
{
    float avgWeak = (float)atSumPeakByTier[AT_TIER_WEAK] / AUTOTUNE_HIT_TARGET;
    float avgStrong = (float)atSumPeakByTier[AT_TIER_STRONG] / AUTOTUNE_HIT_TARGET;
    // atSumScanMs/atSumMaskMs acumulam em TODOS os golpes de TODAS as
    // rodadas (PRIMARY e, se houver, SECONDARY/TERTIARY) - media sobre o
    // total de golpes capturados, nao so' o ultimo nivel/rodada.
    byte roundCount = atShape == AT_SHAPE_SINGLE ? 1 : atShape == AT_SHAPE_DUAL ? 2 : 3;
    long totalHits = (long)AUTOTUNE_HIT_TARGET * AUTOTUNE_TIER_COUNT * roundCount;
    float avgScanMs = (float)atSumScanMs / totalHits;
    float avgMaskMs = (float)atSumMaskMs / totalHits;

    // sensitivity/threshold sao lidos pela lib como Valor*10 (raw ADC,
    // 0-1023ish pos-transformacao ESP32) - ver dualPiezoSensing() etc em
    // hellodrum.cpp.
    //
    // [3 niveis] threshold vem do nivel FRACO: fica 30% do caminho entre o
    // piso de ruido e o pico medio das batidas fracas, garantindo margem dos
    // dois lados (acima do ruido, abaixo da batida mais fraca de verdade).
    // sensitivity (teto pra velocity=127) vem do nivel FORTE com +15% de
    // folga pra acentos mais fortes que os batidos durante a calibracao. O
    // nivel MEDIO nao entra na formula - serve so' de checagem de
    // consistencia (o usuario realmente variou a forca da batida).
    int threshRaw = atNoiseFloor + (int)((avgWeak - atNoiseFloor) * 0.3f);
    int sensRaw = (int)(avgStrong * 1.15f);
    if (threshRaw >= sensRaw)
    {
        threshRaw = sensRaw / 2; // salvaguarda - nao deveria acontecer na pratica
    }

    atResultSensitivity = (byte)constrain(sensRaw / 10, 1, 100);
    atResultThreshold = (byte)constrain(threshRaw / 10, 1, 100);
    atResultScan = (byte)constrain((int)(avgScanMs * 1.2f), 1, 100);   // +20% de margem
    atResultMask = (byte)constrain((int)(avgMaskMs * 1.3f), 1, 100);   // +30% de margem (evita retrigger falso)

    if (atShape == AT_SHAPE_DUAL)
    {
        // rimThreshold: piso minimo pro aro ser sequer considerado - mesma
        // logica de margem do threshold principal (30% do caminho entre um
        // "piso" e a media fraca), so' que aqui o "piso" e' o pior
        // vazamento visto no aro durante os golpes na PELE (atCrossFloor),
        // nao o ruido de silencio.
        float avgRimWeak = (float)atSumRimPeakByTier[AT_TIER_WEAK] / AUTOTUNE_HIT_TARGET;
        int rimThreshRaw = atCrossFloor + (int)((avgRimWeak - atCrossFloor) * 0.3f);
        if (rimThreshRaw < 1)
        {
            rimThreshRaw = 1;
        }

        // rimSensitivity: dualPiezoSensing() classifica como ARO quando
        // (pele - aro) < rimSensitivity. Usamos o PIOR caso observado nos
        // golpes reais de aro (maior diferenca pele-aro, tipicamente nas
        // batidas mais fracas de aro, onde o vazamento da pele pesa mais)
        // + uma folga fixa - garante que ate' um toque fraco no aro
        // continue sendo classificado como aro.
        int rimSensRaw = (int)atMaxHeadRimDiff + 15;
        if (rimSensRaw < 10)
        {
            rimSensRaw = 10; // piso - nunca deixar quase 0 (classificaria quase tudo como pele)
        }

        atResultRimSensitivity = (byte)constrain(rimSensRaw / 10, 1, 100);
        atResultRimThreshold = (byte)constrain(rimThreshRaw / 10, 1, 100);
    }
    else if (atShape == AT_SHAPE_TRI)
    {
        // cymbal3zoneSensing() (hellodrum.cpp) discrimina zona por 2 FAIXAS
        // de threshold no MESMO canal secundario (nao diferenca entre 2
        // canais como no DUAL): abaixo de edgeThreshold = so' vazamento da
        // PRIMARY (bow/pele), entre edgeThreshold e cupThreshold = edge/
        // borda, acima de cupThreshold = cup/aro-forte. edgeThreshold (vai
        // no campo rimSensitivity) usa a mesma margem de 30% entre o pior
        // vazamento na PRIMARY (atCrossFloor) e a media fraca da rodada
        // SECONDARY (edge). cupThreshold (vai no campo rimThreshold) usa
        // 30% do caminho entre a media FORTE da rodada SECONDARY (edge mais
        // alto) e a media FRACA da rodada TERTIARY (cup mais fraco) -
        // separando as 2 faixas com folga dos dois lados.
        float avgEdgeWeak = (float)atSumRimPeakByTier[AT_TIER_WEAK] / AUTOTUNE_HIT_TARGET;
        float avgEdgeStrong = (float)atSumRimPeakByTier[AT_TIER_STRONG] / AUTOTUNE_HIT_TARGET;
        float avgCupWeak = (float)atSumCupByTier[AT_TIER_WEAK] / AUTOTUNE_HIT_TARGET;

        int edgeThreshRaw = atCrossFloor + (int)((avgEdgeWeak - atCrossFloor) * 0.3f);
        if (edgeThreshRaw < 1)
        {
            edgeThreshRaw = 1;
        }

        int cupThreshRaw = (int)(avgEdgeStrong + (avgCupWeak - avgEdgeStrong) * 0.3f);
        if (cupThreshRaw <= edgeThreshRaw)
        {
            // salvaguarda - as faixas se sobrepuseram (fisicamente
            // inesperado: edge forte >= cup fraco). Abre um vao minimo
            // acima do edgeThreshold em vez de deixar cup inalcancavel.
            cupThreshRaw = edgeThreshRaw + (int)((avgEdgeStrong - edgeThreshRaw) * 0.5f) + 10;
        }

        atResultRimSensitivity = (byte)constrain(edgeThreshRaw / 10, 1, 100);
        atResultRimThreshold = (byte)constrain(cupThreshRaw / 10, 1, 100);
    }

    atState = AT_DONE;
    forceScreenRedraw = true;
    sendAutoTuneStatus();
}

// [Fase X] So' calcula os resultados (RAM) a partir de atHhOpenRaw/
// atHhClosedRaw - nao aplica ainda, ver applyAutoTuneResult(). threshold
// vira o menor dos dois raw (CC=0) e sensitivity o maior (CC=127) - SEMPRE
// nessa ordem (min/max), garantindo uma faixa valida nao-degenerada
// independente da polaridade fisica do sensor. A direcao "certa" (pedal
// solto = CC baixo ou alto) fica por conta do campo separado
// `hihat_invert`, aplicado no CC final (ver handlePadResult()) - nao
// precisa entrar nessa conta.
void finishHihatCalibration()
{
    int lo = min(atHhOpenRaw, atHhClosedRaw);
    int hi = max(atHhOpenRaw, atHhClosedRaw);
    if (hi == lo)
    {
        hi = lo + 1; // salvaguarda - pedal nao se moveu o suficiente entre as 2 posicoes
    }

    int mult = hihatFieldMultiplier(padTypes[atPad]);
    atResultThreshold = (byte)constrain(lo / mult, 1, 100);
    atResultSensitivity = (byte)constrain(hi / mult, 1, 100);
    // scan/mask nao se aplicam a esse fluxo (sao usados pra detectar o
    // "chick"/hit do pedal, nao a faixa continua) - mantem os valores
    // atuais do pad (applyAutoTuneResult() os regrava sem mudar nada).
    atResultScan = pads[atPad].scantime;
    atResultMask = pads[atPad].masktime;

    atState = AT_DONE;
    forceScreenRedraw = true;
    sendAutoTuneStatus();
}

// Chamado a cada loop() so' enquanto PAGE_AUTOTUNE esta' visivel. Le'
// pads[atPad].piezoValue, que o dispatchSensing() normal ja atualiza todo
// loop() (independente do tipo do pad) - nao precisa de nenhuma leitura de
// sensor extra, so observa o que ja esta' sendo lido.
void autoTuneTick()
{
    if (atState == AT_IDLE || atState == AT_DONE || atState == AT_ABORTED)
    {
        return;
    }

    // [Fase X] Controlador de pedal (HHC) - fluxo totalmente separado do
    // resto (sensor de posicao continua, nao de impacto). So' 1 canal
    // (padTypeIsHihatPedal() e' sempre channels:1 - ver PAD_TYPE_META).
    if (atState == AT_HH_OPEN || atState == AT_HH_CLOSED)
    {
        unsigned long now = millis();
        int internal = hihatInternalValue(padTypes[atPad], rawValue[atPad]);

        if (now - atPhaseStartMs >= AUTOTUNE_HH_HOLD_MS - AUTOTUNE_HH_SAMPLE_MS)
        {
            atHhSampleSum += internal;
            atHhSampleCount++;
        }

        if (now - atLastCountdownMs >= 250)
        {
            atLastCountdownMs = now;
            forceScreenRedraw = true; // redesenha a barra de progresso
        }

        if (now - atPhaseStartMs >= AUTOTUNE_HH_HOLD_MS)
        {
            int avg = atHhSampleCount > 0 ? (int)(atHhSampleSum / atHhSampleCount) : internal;
            if (atState == AT_HH_OPEN)
            {
                atHhOpenRaw = avg;
                atState = AT_HH_CLOSED;
                atPhaseStartMs = now;
                atHhSampleSum = 0;
                atHhSampleCount = 0;
                forceScreenRedraw = true;
                sendAutoTuneStatus();
            }
            else
            {
                atHhClosedRaw = avg;
                finishHihatCalibration(); // ja envia sendAutoTuneStatus() internamente
            }
        }
        return;
    }

    // pad.piezoValue e' privado na lib - lemos o mesmo rawValue[] que o
    // dispatchSensing() normal ja atualiza e aplicamos a mesma transformacao
    // que a lib faz internamente pra ESP32 (ver dualPiezoSensing() etc em
    // hellodrum.cpp). pin_1 == atPad nesse projeto (ver captureSignalSample()).
    //
    // [MODIFICADO - projeto DrumCore, 2026-09-02] era "1023 - rawValue[atPad] / 4"
    // (mesma inversao encontrada e corrigida em hellodrum.cpp na Fase S -
    // ver docs/01-decisoes-arquiteturais.md) - essa copia aqui em main.cpp
    // ficou pra tras na correcao. Com a formula invertida, o piso de ruido
    // calculado em AT_NOISE (repouso vira o valor MAIS ALTO possivel) fica
    // maior que qualquer "v" alcancavel numa pancada de verdade - o
    // assistente nunca detecta golpe nenhum e sempre estoura o timeout de
    // 15s (AT_WAITING -> AT_ABORTED). Era a causa do "auto-calibrar nao
    // funciona".
    // [Fase U/V] Fora da zona PRIMARY (so' pads com atShape != AT_SHAPE_SINGLE
    // - ver enum AutoTuneShape), o canal ATIVO (que dirige a maquina de
    // estado waiting/rising/decaying, igual sempre foi) passa a ser o canal
    // secundario (atPad+1) em vez do principal - e' o que o usuario esta'
    // batendo agora (SECONDARY e TERTIARY sempre leem o MESMO canal
    // secundario - em AT_SHAPE_TRI, edge e cup sao 2 faixas do mesmo
    // piezo, nao 2 piezos diferentes). O canal PASSIVO (o outro) so' e'
    // lido quando atShape != AT_SHAPE_SINGLE - pra um pad de canal unico,
    // atPad+1 e' o canal de um pad totalmente diferente, sem relacao
    // nenhuma com este, entao nem chegamos a ler.
    byte activeChannel = (atShape != AT_SHAPE_SINGLE && atZone != AT_ZONE_PRIMARY) ? (byte)(atPad + 1) : atPad;
    int v = rawValue[activeChannel] / 4;
    int vOther = 0;
    if (atShape != AT_SHAPE_SINGLE)
    {
        byte otherChannel = (atZone == AT_ZONE_PRIMARY) ? (byte)(atPad + 1) : atPad;
        vOther = rawValue[otherChannel] / 4;
    }
    unsigned long now = millis();

    if (atState == AT_NOISE)
    {
        if (v > atNoiseFloor)
        {
            atNoiseFloor = v;
        }
        if (now - atLastCountdownMs >= 1000)
        {
            atLastCountdownMs = now;
            forceScreenRedraw = true; // redesenha a contagem regressiva
        }
        if (now - atPhaseStartMs >= AUTOTUNE_NOISE_MS)
        {
            atNoiseFloor = (int)(atNoiseFloor * 1.3f) + 5; // margem de seguranca sobre o ruido observado
            atState = AT_WAITING;
            atPhaseStartMs = now;
            forceScreenRedraw = true;
            sendAutoTuneStatus();
        }
        return;
    }

    if (atState == AT_WAITING)
    {
        if (v > atNoiseFloor)
        {
            atHitStartMs = now;
            atHitPeak = v;
            atOtherPeak = vOther;
            atPeakAtMs = now;
            atState = AT_RISING;
        }
        else if (now - atPhaseStartMs > AUTOTUNE_WAIT_TIMEOUT_MS)
        {
            atState = AT_ABORTED;
            atAbortedReason = AT_ABORT_TIMEOUT;
            forceScreenRedraw = true;
            sendAutoTuneStatus();
        }
        return;
    }

    if (atState == AT_RISING)
    {
        if (v > atHitPeak)
        {
            atHitPeak = v;
            atPeakAtMs = now;
        }
        if (vOther > atOtherPeak)
        {
            atOtherPeak = vOther;
        }
        // "Assentou" no pico: nenhum valor maior chegou nos ultimos
        // AUTOTUNE_RISE_SETTLE_MS - o sinal comecou a cair.
        if ((now - atPeakAtMs) >= AUTOTUNE_RISE_SETTLE_MS)
        {
            atState = AT_DECAYING;
        }
        return;
    }

    if (atState == AT_DECAYING)
    {
        // O canal passivo pode "atrasar" um pouco em relacao ao ativo (o
        // vazamento entre os 2 piezos nao e' instantaneo) - continua
        // observando o pico dele tambem enquanto o ativo decai.
        if (vOther > atOtherPeak)
        {
            atOtherPeak = vOther;
        }
        if (v <= atHitPeak / 2)
        {
            unsigned long scanMs = atPeakAtMs - atHitStartMs;
            unsigned long maskMs = now - atPeakAtMs;
            atSumScanMs += scanMs;
            atSumMaskMs += maskMs;

            if (atZone == AT_ZONE_TERTIARY)
            {
                // atHitPeak aqui e' o pico do canal secundario na faixa
                // TERTIARY (cup/aro-forte, so' AT_SHAPE_TRI) - nao ha'
                // diferenca entre canais pra calcular aqui, e' so' o nivel
                // desse golpe na mesma faixa/canal da rodada SECONDARY.
                atSumCupByTier[atTier] += atHitPeak;
            }
            else if (atZone == AT_ZONE_SECONDARY)
            {
                // atHitPeak aqui e' o pico do canal secundario (aro em
                // AT_SHAPE_DUAL, edge/borda em AT_SHAPE_TRI); atOtherPeak e'
                // o vazamento do canal principal nesse mesmo golpe - so'
                // usado na formula em AT_SHAPE_DUAL (diferenca entre
                // canais), mas nao custa nada acumular sempre.
                atSumRimPeakByTier[atTier] += atHitPeak;
                if (atShape == AT_SHAPE_DUAL)
                {
                    long diff = (long)atOtherPeak - (long)atHitPeak;
                    if (diff > atMaxHeadRimDiff)
                    {
                        atMaxHeadRimDiff = diff;
                    }
                }
            }
            else // AT_ZONE_PRIMARY
            {
                atSumPeakByTier[atTier] += atHitPeak;
                if (atShape != AT_SHAPE_SINGLE && atOtherPeak > atCrossFloor)
                {
                    atCrossFloor = atOtherPeak; // pior vazamento no canal secundario durante uma pancada na PRIMARY
                }
            }
            atHitCount++;
            forceScreenRedraw = true;

            bool tierDone = atHitCount >= AUTOTUNE_HIT_TARGET;
            bool lastTierOfZone = tierDone && atTier >= AT_TIER_STRONG;
            bool zoneNeedsAdvance = lastTierOfZone && autoTuneHasNextZone(atShape, atZone);

            if (lastTierOfZone && !zoneNeedsAdvance)
            {
                finishAutoTune(); // ja envia sendAutoTuneStatus() internamente
            }
            else
            {
                if (zoneNeedsAdvance)
                {
                    // rodada atual completa (24 golpes) - avanca pra proxima zona, do zero
                    atZone = autoTuneNextZone(atZone);
                    atTier = AT_TIER_WEAK;
                    atHitCount = 0;
                }
                else if (tierDone)
                {
                    // nivel atual completo (8/8) - avanca fraco -> medio -> forte
                    atTier = (AutoTuneTier)(atTier + 1);
                    atHitCount = 0;
                }
                atState = AT_COOLDOWN;
                atPhaseStartMs = now;
                sendAutoTuneStatus(); // atualiza o contador/nivel/zona pro app
            }
        }
        else if ((now - atPeakAtMs) > AUTOTUNE_DECAY_TIMEOUT_MS)
        {
            // Nunca decaiu de verdade (provavelmente ruido/instabilidade) -
            // descarta essa tentativa, sem contar como pancada.
            atState = AT_WAITING;
            atPhaseStartMs = now;
        }
        return;
    }

    if (atState == AT_COOLDOWN)
    {
        // atNoiseFloor foi medido no canal da PELE (fase AT_NOISE, sempre
        // roda antes da rodada PRIMARY) - na rodada SECONDARY isso vira uma
        // aproximacao (o "v" aqui e' do ARO), mas so' serve pra decidir
        // "acabou de assentar, pode esperar o proximo golpe" - nao entra em
        // nenhuma formula de resultado, entao a aproximacao e' aceitavel.
        if (v < atNoiseFloor)
        {
            if (now - atPhaseStartMs > AUTOTUNE_COOLDOWN_MS)
            {
                atState = AT_WAITING;
                atPhaseStartMs = now;
            }
        }
        else
        {
            atPhaseStartMs = now; // ainda em decaimento/ruido alto - reinicia o cooldown
        }
        return;
    }
}

// Grava o resultado calculado nos campos do pad (so' em RAM - mesma
// convencao de "persistencia explicita via GLOBAL > SALVAR" usada pelo
// resto da edicao via encoders). Retorna false se chamado fora de hora
// (nenhum resultado pronto ainda) - o chamador (encoder ou serial) decide
// o que fazer nesse caso.
bool applyAutoTuneResult()
{
    if (atState != AT_DONE)
    {
        return false;
    }

    byte pad = atPad;
    pads[pad].sensitivity = atResultSensitivity;
    pads[pad].threshold1 = atResultThreshold;
    pads[pad].scantime = atResultScan;
    pads[pad].masktime = atResultMask;
    if (atShape != AT_SHAPE_SINGLE)
    {
        pads[pad].rimSensitivity = atResultRimSensitivity;
        pads[pad].rimThreshold = atResultRimThreshold;
    }
    // gain fica em 100 (neutro) de proposito - o resultado acima foi
    // calculado assumindo gain neutro (ver startAutoTune()), entao os
    // numeros so' fazem sentido nessa combinacao. Se o pad tinha um gain
    // != 100 antes, essa calibracao o substitui.
    padGain[pad] = 100;
    unsavedChanges = true;

    atState = AT_IDLE;
    currentPage = PAGE_PAD_EDIT;
    forceScreenRedraw = true;
    sendAutoTuneStatus();
    sendPadConfig(pad); // reflete sensitivity/threshold/scan/mask novos pro app
    return true;
}

// Desfaz o gain neutro forcado em startAutoTune() - so' quando a
// calibracao estava mesmo ativa (idempotente, seguro de chamar sempre).
// Todo caminho de saida do assistente que NAO seja um apply bem sucedido
// (cancelar em qualquer fase, abortar por timeout/canal desligado -
// ambos so' saem de fato via cancelAutoTune() - ou o "panico" ENC1 hold
// -> LIVE a partir de qualquer tela) precisa passar por aqui.
void restoreAutoTuneGainIfActive()
{
    if (atState != AT_IDLE)
    {
        padGain[atPad] = atSavedGain;
    }
}

void cancelAutoTune()
{
    restoreAutoTuneGainIfActive();
    atState = AT_IDLE;
    currentPage = PAGE_PAD_EDIT;
    forceScreenRedraw = true;
    sendAutoTuneStatus();
}

void goToLive()
{
    restoreAutoTuneGainIfActive();
    atState = AT_IDLE; // seguranca - nao deixa o assistente rodando fora da tela dele
    currentPage = PAGE_LIVE;
    forceScreenRedraw = true;
}

void onEnc1Rotate(int delta)
{
    if (currentPage == PAGE_AUTOTUNE)
    {
        return; // sem navegacao durante o assistente - so' ENC2 (aplicar/cancelar) ou hold (cancelar)
    }

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
    if (currentPage == PAGE_AUTOTUNE)
    {
        return;
    }

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
        FieldDef fields[MAX_FIELDS_PER_PAD];
        byte n = getFieldsForType(padTypes[editPadIndex], fields);
        if (editItemIndex < n && fields[editItemIndex].id == FIELD_AUTOTUNE)
        {
            if (padEnabled[editPadIndex])
            {
                startAutoTune(editPadIndex);
            }
            else
            {
                // showToast() so' e' desenhado por renderGlobal() - aqui
                // reusamos a tela do assistente direto no estado "abortado",
                // com uma mensagem especifica pra esse motivo.
                atPad = editPadIndex;
                atState = AT_ABORTED;
                atAbortedReason = AT_ABORT_DISABLED;
                currentPage = PAGE_AUTOTUNE;
                forceScreenRedraw = true;
            }
        }
        else
        {
            editingValue = !editingValue;
            forceScreenRedraw = true;
        }
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
    else if (currentPage == PAGE_AUTOTUNE)
    {
        if (atState == AT_DONE)
        {
            applyAutoTuneResult();
            showToast("CALIBRADO", "VALORES APLICADOS");
        }
        else if (atState == AT_ABORTED)
        {
            cancelAutoTune();
        }
        // Durante NOISE/WAITING/RISING/DECAYING/COOLDOWN, clicar nao faz
        // nada - so' ENC2 hold cancela no meio do assistente.
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
    else if (currentPage == PAGE_AUTOTUNE)
    {
        cancelAutoTune(); // cancela em qualquer estado, inclusive no meio da coleta de golpes
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
    canvas.fillRect(0, 0, canvas.width(), 12, COL_SURFACE);
    canvas.setTextSize(1);
    canvas.setTextColor(COL_ACCENT);
    canvas.setCursor(4, 2);
    canvas.print(left);
    if (right && right[0])
    {
        int16_t x1, y1;
        uint16_t w, h;
        canvas.getTextBounds(right, 0, 0, &x1, &y1, &w, &h);
        canvas.setTextColor(rightColor);
        canvas.setCursor(canvas.width() - 4 - (int)w, 2);
        canvas.print(right);
    }
}

void drawValueRow(int y, const char *label, const char *value, bool selected, bool editing)
{
    canvas.fillRect(0, y, canvas.width(), 14, editing ? COL_BG : selected ? COL_SURFACE : COL_BG);
    canvas.setTextSize(1);
    canvas.setTextColor(selected || editing ? COL_TXT : COL_TXT_DIM);
    canvas.setCursor(4, y + 3);
    canvas.print(label);

    int16_t x1, y1;
    uint16_t w, h;
    canvas.getTextBounds(value, 0, 0, &x1, &y1, &w, &h);
    int vx = canvas.width() - 4 - (int)w;
    if (editing)
    {
        canvas.fillRect(vx - 3, y + 1, (int)w + 5, 12, COL_EDIT);
        canvas.setTextColor(COL_BG);
    }
    else
    {
        canvas.setTextColor(COL_TXT);
    }
    canvas.setCursor(vx, y + 3);
    canvas.print(value);
}

// Largura da barra de progresso - compartilhada entre renderBoot() (desenha
// o fundo) e renderBootProgress() (desenha o preenchimento) - ver
// BOOT_BAR_X abaixo, centralizado dinamicamente pela largura real da tela
// (2026-09-01: paisagem, 160px - antes era so' um x fixo pensado pros
// 128px de retrato).
#define BOOT_BAR_W 100
#define BOOT_BAR_X ((tft.width() - BOOT_BAR_W) / 2)
#define BOOT_BAR_Y 82

void renderBootProgress(byte percent)
{
    tft.fillRect(BOOT_BAR_X, BOOT_BAR_Y, BOOT_BAR_W, 4, COL_SURFACE);
    int fillW = map(percent, 0, 100, 0, BOOT_BAR_W);
    tft.fillRect(BOOT_BAR_X, BOOT_BAR_Y, fillW, 4, COL_ACCENT);
}

// Centraliza uma linha de texto horizontalmente na largura real da tela -
// usa getTextBounds() (em vez de um x fixo) pra continuar centralizado
// mesmo se o texto mudar. tft.setTextSize()/setTextColor() precisam ser
// chamados ANTES (getTextBounds usa o tamanho de fonte atual).
void printCentered(const char *text, int y)
{
    int16_t x1, y1;
    uint16_t w, h;
    tft.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
    tft.setCursor((tft.width() - (int)w) / 2, y);
    tft.print(text);
}

void renderBoot()
{
    tft.fillScreen(COL_BG);

    tft.setTextColor(COL_ACCENT);
    tft.setTextSize(2);
    printCentered("DRUMCORE", 34);

    tft.setTextSize(1);
    tft.setTextColor(COL_TXT_DIM);
    printCentered("32 PAD TRIGGER", 58);

    tft.fillRect(BOOT_BAR_X, BOOT_BAR_Y, BOOT_BAR_W, 4, COL_SURFACE);

    tft.setTextColor(COL_LINE);
    printCentered("v0.1  ESP32-S3", 110);
}

// Grade 8x4 ocupando a largura/altura inteiras da tela em paisagem (2026-
// 09-01 - antes do giro pra paisagem, cabia numa area 128x99 so', sobrando
// uma faixa em branco embaixo; agora usa os 160x116 disponiveis abaixo da
// barra de titulo). Pitch = passo entre celulas, celula em si e' 2-3px
// menor que o pitch (a diferenca vira a folga entre pads, igual ao design
// original).
#define LIVE_GRID_PITCH_X 20
#define LIVE_GRID_CELL_W 18
#define LIVE_GRID_Y0 14
#define LIVE_GRID_PITCH_Y 28
#define LIVE_GRID_CELL_H 25

void renderLivePad(byte i)
{
    byte col = i % 8;
    byte row = i / 8;
    int x = 1 + col * LIVE_GRID_PITCH_X;
    int y = LIVE_GRID_Y0 + row * LIVE_GRID_PITCH_Y;

    unsigned long since = millis() - padHitAtMs[i];
    bool solid = padHitAtMs[i] != 0 && since < PAD_FLASH_MS;
    bool decay = padHitAtMs[i] != 0 && since >= PAD_FLASH_MS && since < PAD_DECAY_MS;

    // Canal desligado (padEnabled[i] == false): nunca acende (nunca chega
    // a ter hit), so' desenha "apagado" - sem borda visivel, numero bem
    // fraco - pra distinguir de um canal ligado que so' esta' ocioso.
    bool off = channelPrimary[i] && !padEnabled[i];

    uint16_t bg = solid ? COL_HIT : COL_BG;
    uint16_t border = off ? COL_BG : solid ? COL_HIT : decay ? COL_HIT : COL_LINE;
    uint16_t fg = off ? COL_LINE : solid ? COL_BG : decay ? COL_HIT : COL_TXT_DIM;

    canvas.fillRect(x, y, LIVE_GRID_CELL_W, LIVE_GRID_CELL_H, bg);
    canvas.drawRect(x, y, LIVE_GRID_CELL_W, LIVE_GRID_CELL_H, border);

    char buf[3];
    snprintf(buf, sizeof(buf), "%02d", i + 1);
    canvas.setTextSize(1);
    canvas.setTextColor(fg);
    // "01".."32" (2 chars, textSize 1) mede uns 11px de largura - centraliza
    // na celula, que agora e' bem maior que o texto (LIVE_GRID_CELL_W/H).
    canvas.setCursor(x + (LIVE_GRID_CELL_W - 11) / 2, y + (LIVE_GRID_CELL_H - 8) / 2);
    canvas.print(buf);
}

// Retorna true se algo foi desenhado nesse frame (o canvas precisa ser
// mandado pra tela fisica - ver renderScreen()), false se nada mudou.
bool renderLive()
{
    if (forceScreenRedraw)
    {
        canvas.fillScreen(COL_BG);
        drawTitleBar("LIVE", "", COL_TXT);
        canvas.setTextSize(1);
        canvas.setTextColor(TinyUSBDevice.mounted() ? COL_OK : COL_LINE);
        canvas.setCursor(canvas.width() - 28, 2);
        canvas.print("U");
        canvas.setTextColor(bleMidiConnected ? COL_OK : COL_LINE);
        canvas.setCursor(canvas.width() - 10, 2);
        canvas.print("B");
        for (byte i = 0; i < NUM_PADS; i++)
        {
            renderLivePad(i);
        }
        forceScreenRedraw = false;
        return true;
    }

    // Nunca redesenha a grade inteira - so' os pads cujo estado (solido /
    // decaindo / idle) pode ter mudado desde o ultimo frame.
    bool any = false;
    unsigned long now = millis();
    for (byte i = 0; i < NUM_PADS; i++)
    {
        unsigned long since = now - padHitAtMs[i];
        if (padHitAtMs[i] != 0 && since <= PAD_DECAY_MS + 20)
        {
            renderLivePad(i);
            any = true;
        }
    }
    return any;
}

bool renderPadsList()
{
    if (!forceScreenRedraw)
    {
        return false;
    }
    forceScreenRedraw = false;

    canvas.fillScreen(COL_BG);
    char right[8];
    snprintf(right, sizeof(right), "%02d/32", padsListSelection + 1);
    drawTitleBar("PADS", right, COL_TXT_DIM);

    // Largura da lista = tela inteira menos a faixa da scrollbar (3px) e um
    // pequeno respiro (2px) antes dela - ver scrollbar no fim da funcao.
    int rowW = canvas.width() - 5;

    for (byte row = 0; row < 8; row++)
    {
        byte i = padsListTop + row;
        int y = 12 + row * 14;
        bool sel = (i == padsListSelection);

        // Canal primario mas desligado (padEnabled[i] == false): tudo na
        // linha em COL_LINE (mais apagado que COL_TXT_DIM), distinto de
        // "canal ocupado" (2o canal de um pad de 2 zonas, mostra "--").
        bool off = channelPrimary[i] && !padEnabled[i];

        canvas.fillRect(0, y, rowW, 14, sel ? COL_ACCENT : COL_BG);
        canvas.setTextSize(1);
        canvas.setTextColor(sel ? COL_BG : off ? COL_LINE : COL_TXT);

        char idxBuf[5];
        snprintf(idxBuf, sizeof(idxBuf), "P%02d", i + 1);
        canvas.setCursor(4, y + 3);
        canvas.print(idxBuf);

        canvas.setTextColor(sel ? COL_BG : off ? COL_LINE : COL_TXT_DIM);
        canvas.setCursor(40, y + 3);
        if (channelPrimary[i] && padLabels[i][0] != '\0')
        {
            // Nome configurado pelo usuario (campo "label" do protocolo -
            // ver docs/04-protocolo-serial.md), nao o "N - Label" completo
            // de padNames[] (o indice ja aparece na coluna P01/P02/...).
            // Truncado pra nao invadir a coluna de nota/OFF a direita.
            char labelBuf[14];
            strncpy(labelBuf, padLabels[i], sizeof(labelBuf) - 1);
            labelBuf[sizeof(labelBuf) - 1] = '\0';
            canvas.print(labelBuf);
        }
        else
        {
            canvas.print("--");
        }

        if (channelPrimary[i])
        {
            char noteBuf[6];
            if (off)
            {
                snprintf(noteBuf, sizeof(noteBuf), "OFF");
            }
            else
            {
                snprintf(noteBuf, sizeof(noteBuf), "N%d", pads[i].note);
            }
            int16_t x1, y1;
            uint16_t w, h;
            canvas.setTextColor(sel ? COL_BG : off ? COL_LINE : COL_TXT);
            canvas.getTextBounds(noteBuf, 0, 0, &x1, &y1, &w, &h);
            canvas.setCursor(rowW - 4 - (int)w, y + 3);
            canvas.print(noteBuf);
        }
    }

    // Scrollbar proporcional (3px, encostada na borda direita).
    int barX = canvas.width() - 3;
    canvas.fillRect(barX, 12, 3, 116, COL_SURFACE);
    int barH = 116 * 8 / NUM_PADS;
    int barY = 12 + (116 - barH) * padsListTop / (NUM_PADS - 8);
    canvas.fillRect(barX, barY, 3, barH, COL_LINE);
    return true;
}

bool renderPadEdit()
{
    if (!forceScreenRedraw)
    {
        return false;
    }
    forceScreenRedraw = false;

    canvas.fillScreen(COL_BG);
    char left[8];
    snprintf(left, sizeof(left), "PAD %02d", editPadIndex + 1);
    drawTitleBar(left, "EDIT", COL_TXT_DIM);

    if (!channelPrimary[editPadIndex])
    {
        canvas.setTextColor(0xFBC3);
        canvas.setTextSize(1);
        canvas.setCursor(4, 40);
        canvas.print("Canal ocupado");
        canvas.setCursor(4, 52);
        canvas.print("(2o canal do pad anterior)");
        return true;
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
        else if (fields[idx].id == FIELD_AUTOTUNE)
        {
            strncpy(valueBuf, "INICIAR>", sizeof(valueBuf) - 1);
            valueBuf[sizeof(valueBuf) - 1] = '\0';
        }
        else if (fields[idx].id == FIELD_ENABLED || fields[idx].id == FIELD_HIHAT_INVERT)
        {
            strncpy(valueBuf, getFieldValue(editPadIndex, fields[idx].id) ? "SIM" : "NAO", sizeof(valueBuf) - 1);
            valueBuf[sizeof(valueBuf) - 1] = '\0';
        }
        else
        {
            snprintf(valueBuf, sizeof(valueBuf), "%d", getFieldValue(editPadIndex, fields[idx].id));
        }

        drawValueRow(y, fields[idx].label, valueBuf, sel, editingThis);
    }

    canvas.fillRect(0, 116, canvas.width(), 12, COL_SURFACE);
    canvas.setTextSize(1);
    canvas.setTextColor(COL_TXT_DIM);
    canvas.setCursor(4, 118);
    canvas.print("ENC2 GIRA VALOR");
    canvas.setTextColor(COL_EDIT);
    canvas.setCursor(canvas.width() - 46, 118);
    canvas.print("PUSH OK");
    return true;
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

bool renderSignal()
{
    if (!signalNeedsRedraw && !forceScreenRedraw)
    {
        return false;
    }
    signalNeedsRedraw = false;
    forceScreenRedraw = false;

    canvas.fillScreen(COL_BG);
    char left[8];
    snprintf(left, sizeof(left), "PAD %02d", editPadIndex + 1);
    drawTitleBar(left, "SIGNAL", COL_TXT_DIM);

    canvas.drawLine(4, 18, 4, 91, COL_LINE);
    canvas.drawLine(4, 91, 124, 91, COL_LINE);

    int prevX = -1, prevY = -1;
    int maxV = 1023;
    for (int i = 0; i < SIGNAL_BUFFER_LEN; i++)
    {
        int idx = (signalBufferPos + i) % SIGNAL_BUFFER_LEN;
        int x = 4 + i;
        int y = 91 - map(constrain(signalBuffer[idx], 0, maxV), 0, maxV, 0, 73);
        if (prevX >= 0)
        {
            canvas.drawLine(prevX, prevY, x, y, COL_OK);
        }
        prevX = x;
        prevY = y;
    }

    canvas.setTextSize(1);
    canvas.setTextColor(COL_TXT_DIM);
    canvas.setCursor(4, 96);
    canvas.print("VEL");
    canvas.setTextColor(COL_TXT);
    canvas.print(" ");
    canvas.print(pads[editPadIndex].velocity);
    canvas.setTextColor(COL_TXT_DIM);
    canvas.print("  PEAK ");
    canvas.setTextColor(COL_TXT);
    canvas.print(signalPeak);

    canvas.setTextColor(COL_ACCENT);
    canvas.setCursor(4, 110);
    canvas.print("SCAN ");
    canvas.print(pads[editPadIndex].scantime);
    canvas.setTextColor(COL_LINE);
    canvas.print(" MASK ");
    canvas.print(pads[editPadIndex].masktime);
    canvas.setTextColor(COL_EDIT);
    canvas.print(" THR ");
    canvas.print(pads[editPadIndex].threshold1);
    return true;
}

const char *midiOutputLabel(byte v)
{
    return v == OUTPUT_USB ? "USB" : v == OUTPUT_BLE ? "BLE" : "USB+BLE";
}

bool renderGlobal()
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
        return false;
    }
    forceScreenRedraw = false;

    canvas.fillScreen(COL_BG);
    drawTitleBar("GLOBAL", "", COL_TXT);

    char buf[10];
    snprintf(buf, sizeof(buf), "%d", midiChannel);
    drawValueRow(12, "MIDI CH", buf, globalSelection == GLOBAL_ROW_MIDI_CH, globalSelection == GLOBAL_ROW_MIDI_CH && globalEditing);

    drawValueRow(26, "SAIDA", midiOutputLabel(midiOutput), globalSelection == GLOBAL_ROW_OUTPUT, globalSelection == GLOBAL_ROW_OUTPUT && globalEditing);

    drawValueRow(40, "SALVAR", unsavedChanges ? "*" : ">", globalSelection == GLOBAL_ROW_SAVE, false);
    drawValueRow(54, "RESTAURAR", ">", globalSelection == GLOBAL_ROW_RESTORE, false);

    if (showingToast)
    {
        canvas.fillRect(14, 56, 100, 34, COL_BG);
        canvas.drawRect(14, 56, 100, 34, COL_OK);
        int16_t x1, y1;
        uint16_t w, h;
        canvas.setTextSize(2);
        canvas.getTextBounds(toastLine1, 0, 0, &x1, &y1, &w, &h);
        canvas.setTextColor(COL_OK);
        canvas.setCursor(64 - (int)w / 2, 63);
        canvas.print(toastLine1);
        canvas.setTextSize(1);
        canvas.getTextBounds(toastLine2, 0, 0, &x1, &y1, &w, &h);
        canvas.setTextColor(COL_TXT_DIM);
        canvas.setCursor(64 - (int)w / 2, 80);
        canvas.print(toastLine2);
    }
    return true;
}

// Tela do assistente de auto-tune (Fase O) - ver comentario grande no bloco
// de estados (perto de goToLive()) pro racional completo.
bool renderAutoTune()
{
    if (!forceScreenRedraw)
    {
        return false;
    }
    forceScreenRedraw = false;

    canvas.fillScreen(COL_BG);
    char left[8];
    snprintf(left, sizeof(left), "PAD %02d", atPad + 1);
    drawTitleBar(left, "CALIBRAR", COL_EDIT);

    if (atState == AT_NOISE)
    {
        unsigned long remainMs = AUTOTUNE_NOISE_MS - (millis() - atPhaseStartMs);
        canvas.setTextSize(1);
        canvas.setTextColor(COL_TXT);
        canvas.setCursor(4, 30);
        canvas.print("OUCA O RUIDO");
        canvas.setTextColor(COL_TXT_DIM);
        canvas.setCursor(4, 46);
        canvas.print("nao toque no pad...");
        canvas.setTextColor(COL_ACCENT);
        canvas.setCursor(4, 64);
        canvas.print((remainMs / 1000) + 1);
        canvas.print("s");
    }
    else if (atState == AT_WAITING || atState == AT_RISING || atState == AT_DECAYING || atState == AT_COOLDOWN)
    {
        const char *tierLabel = atTier == AT_TIER_WEAK ? "FRACO" : (atTier == AT_TIER_MEDIUM ? "MEDIO" : "FORTE");
        const char *tierHint = atTier == AT_TIER_WEAK ? "toque de leve" : (atTier == AT_TIER_MEDIUM ? "toque normal" : "toque com forca");

        canvas.setTextSize(1);
        canvas.setTextColor(COL_TXT_DIM);
        canvas.setCursor(4, 14);
        char tierBuf[24];
        if (atShape != AT_SHAPE_SINGLE)
        {
            snprintf(tierBuf, sizeof(tierBuf), "%s NIVEL %d/%d", autoTuneZoneTftLabel(padTypes[atPad], atZone), atTier + 1, AUTOTUNE_TIER_COUNT);
        }
        else
        {
            snprintf(tierBuf, sizeof(tierBuf), "NIVEL %d/%d", atTier + 1, AUTOTUNE_TIER_COUNT);
        }
        canvas.print(tierBuf);

        canvas.setTextColor(COL_TXT);
        canvas.setCursor(4, 30);
        canvas.print("BATA ");
        canvas.print(tierLabel);
        canvas.setTextColor(COL_TXT_DIM);
        canvas.setCursor(4, 46);
        canvas.print(tierHint);

        canvas.setTextColor(COL_ACCENT);
        canvas.setTextSize(2);
        char countBuf[8];
        snprintf(countBuf, sizeof(countBuf), "%d/%d", atHitCount, AUTOTUNE_HIT_TARGET);
        canvas.setCursor(4, 64);
        canvas.print(countBuf);

        // Barrinha de progresso (golpes capturados no nivel atual).
        int barW = 120 * atHitCount / AUTOTUNE_HIT_TARGET;
        canvas.drawRect(4, 90, 120, 8, COL_LINE);
        if (barW > 0)
        {
            canvas.fillRect(4, 90, barW, 8, COL_ACCENT);
        }
    }
    else if (atState == AT_HH_OPEN || atState == AT_HH_CLOSED)
    {
        bool isOpenPhase = atState == AT_HH_OPEN;
        unsigned long elapsedMs = millis() - atPhaseStartMs;
        unsigned long remainMs = elapsedMs >= AUTOTUNE_HH_HOLD_MS ? 0 : AUTOTUNE_HH_HOLD_MS - elapsedMs;

        canvas.setTextSize(1);
        canvas.setTextColor(COL_TXT_DIM);
        canvas.setCursor(4, 14);
        canvas.print(isOpenPhase ? "POSICAO ABERTA" : "POSICAO FECHADA");

        canvas.setTextColor(COL_TXT);
        canvas.setCursor(4, 30);
        canvas.print(isOpenPhase ? "SOLTE O PEDAL" : "PRESSIONE O PEDAL");
        canvas.setTextColor(COL_TXT_DIM);
        canvas.setCursor(4, 46);
        canvas.print(isOpenPhase ? "deixe totalmente aberto" : "ate' o fim, segure firme");

        canvas.setTextColor(COL_ACCENT);
        canvas.setTextSize(2);
        canvas.setCursor(4, 64);
        canvas.print((remainMs / 1000) + 1);
        canvas.print("s");

        // Barrinha de progresso (tempo decorrido nessa posicao).
        int barW = (int)(120L * elapsedMs / AUTOTUNE_HH_HOLD_MS);
        if (barW > 120) barW = 120;
        canvas.drawRect(4, 90, 120, 8, COL_LINE);
        if (barW > 0)
        {
            canvas.fillRect(4, 90, barW, 8, COL_ACCENT);
        }
    }
    else if (atState == AT_DONE)
    {
        canvas.setTextSize(1);
        canvas.setTextColor(COL_OK);
        canvas.setCursor(4, 12);
        canvas.print("CALIBRADO!");

        bool isHihat = padTypeIsHihatPedal(padTypes[atPad]);
        char buf[10];
        snprintf(buf, sizeof(buf), "%d", atResultSensitivity);
        drawValueRow(28, isHihat ? "MAXIMO" : "SENSIB", buf, false, false);
        snprintf(buf, sizeof(buf), "%d", atResultThreshold);
        drawValueRow(42, isHihat ? "MINIMO" : "THRESH", buf, false, false);
        if (!isHihat)
        {
            snprintf(buf, sizeof(buf), "%d", atResultScan);
            drawValueRow(56, "SCAN", buf, false, false);
            snprintf(buf, sizeof(buf), "%d", atResultMask);
            drawValueRow(70, "MASK", buf, false, false);
        }
        if (atShape != AT_SHAPE_SINGLE)
        {
            snprintf(buf, sizeof(buf), "%d", atResultRimSensitivity);
            drawValueRow(84, "R.SENS", buf, false, false);
            snprintf(buf, sizeof(buf), "%d", atResultRimThreshold);
            drawValueRow(98, "R.THRE", buf, false, false);
        }
    }
    else if (atState == AT_ABORTED)
    {
        canvas.setTextSize(1);
        canvas.setTextColor(0xFBC3);
        canvas.setCursor(4, 40);
        if (atAbortedReason == AT_ABORT_DISABLED)
        {
            canvas.print("CANAL DESLIGADO");
            canvas.setTextColor(COL_TXT_DIM);
            canvas.setCursor(4, 54);
            canvas.print("ative o canal pra calibrar");
        }
        else
        {
            canvas.print("SEM RESPOSTA");
            canvas.setTextColor(COL_TXT_DIM);
            canvas.setCursor(4, 54);
            canvas.print("cancelado - sem pancadas");
        }
    }

    canvas.fillRect(0, 116, canvas.width(), 12, COL_SURFACE);
    canvas.setTextSize(1);
    if (atState == AT_DONE)
    {
        canvas.setTextColor(COL_OK);
        canvas.setCursor(4, 118);
        canvas.print("PUSH APLICA");
        canvas.setTextColor(COL_TXT_DIM);
        canvas.setCursor(canvas.width() - 52, 118);
        canvas.print("HOLD SAI");
    }
    else if (atState == AT_ABORTED)
    {
        canvas.setTextColor(COL_TXT_DIM);
        canvas.setCursor(4, 118);
        canvas.print("PUSH/HOLD VOLTA");
    }
    else
    {
        canvas.setTextColor(COL_TXT_DIM);
        canvas.setCursor(4, 118);
        canvas.print("HOLD CANCELA");
    }
    return true;
}

void renderScreen()
{
    if (currentPage == PAGE_SIGNAL)
    {
        captureSignalSample();
    }

    // Cada render*() desenha no canvas em RAM (nunca direto na tft - ver
    // comentario na declaracao de "canvas" acima) e devolve se desenhou algo
    // nesse frame. So' manda o frame pra tela fisica (uma unica rajada SPI)
    // quando teve desenho de verdade - evita ficar re-enviando o mesmo
    // quadro todo loop() a toa (ex: PAGE_LIVE com nenhum pad ativo).
    bool dirty = false;
    switch (currentPage)
    {
    case PAGE_BOOT:
        break; // desenhado direto em setup(), nao faz parte do loop()
    case PAGE_LIVE:
        dirty = renderLive();
        break;
    case PAGE_PADS:
        dirty = renderPadsList();
        break;
    case PAGE_PAD_EDIT:
        dirty = renderPadEdit();
        break;
    case PAGE_SIGNAL:
        dirty = renderSignal();
        break;
    case PAGE_GLOBAL:
        dirty = renderGlobal();
        break;
    case PAGE_AUTOTUNE:
        dirty = renderAutoTune();
        break;
    }

    if (dirty)
    {
        tft.drawRGBBitmap(0, 0, canvas.getBuffer(), canvas.width(), canvas.height());
    }
}

void setup()
{
    Serial.begin(115200); // com ARDUINO_USB_CDC_ON_BOOT=0, "Serial" e' a UART
                           // fisica (GPIO43/44), nao a USB nativa - ver
                           // docs/01-decisoes-arquiteturais.md

    // [MODIFICADO - projeto DrumCore, 2026-08-31] pads[] agora e' um array
    // default (ver declaracao logo apos mux[] acima) - cada pad e'
    // inicializado aqui, dentro do setup() (tarefa do loop, pilha ~8KB),
    // em vez de numa lista de inicializadores no array global (rodava na
    // tarefa principal, pilha de so 4KB - travava o boot com 27+ pads sem
    // nenhum erro visivel).
    //
    // CAUSA RAIZ ENCONTRADA E CORRIGIDA (2026-09-01, Fase R - ver
    // docs/01-decisoes-arquiteturais.md pro relato completo): nao era um
    // bug de pilha nem de sequencia/tempo - "#ifdef PULLUP" em
    // hellodrum.cpp ficava SEMPRE ativo no ESP32 (colisao de nome com o
    // PULLUP=0x04 que o proprio core arduino-esp32 ja define), entao todo
    // begin() chamava pinMode(pin1/pin2, INPUT_PULLUP) usando os indices
    // de canal do MUX (0-31) como se fossem GPIOs de verdade - quando o
    // indice caia num GPIO reservado internamente (flash/PSRAM), travava o
    // sistema. Corrigido removendo esses blocos em
    // firmware/lib/HelloDrum-arduino-Library/src/hellodrum.cpp. Restaurado
    // o pareamento real pin_1=i/pin_2=i+1 - cada pad le' seu proprio canal
    // do MUX (o ultimo usa so' pin_1, pin_2=32 nao existiria).
    for (byte i = 0; i < NUM_PADS; i++)
    {
        if (i < NUM_PADS - 1)
        {
            pads[i].begin(i, i + 1);
        }
        else
        {
            pads[i].begin(i);
        }
    }

    // TFT primeiro - precisamos dela pra mostrar a tela BOOT antes de mais
    // nada (design/SPEC.md SCR 0).
    // Backlight sempre ligado, sem PWM/dimming (2026-09-01 - removido a
    // pedido do Rodrigo: o duty PWM calculado variava certinho (25-255,
    // confirmado por log), mas o brilho fisico do backlight nao mudava
    // visivelmente nessa placa clone - nao valia a pena investigar mais a
    // fundo agora. Ver docs/01-decisoes-arquiteturais.md).
    pinMode(TFT_BLK, OUTPUT);
    digitalWrite(TFT_BLK, HIGH);

    SPI.begin(TFT_SCLK, -1 /* MISO nao usado */, TFT_MOSI, TFT_CS);
    tft.initR(INITR_BLACKTAB); // 2026-08-31: confirmado em hardware real via ambiente
                                // display_test (ver firmware/src/test_display.cpp) - com fiacao
                                // boa (curto de solda ja corrigido), INITR_144GREENTAB (o "certo"
                                // pra 1.44"/128x128 pelo catalogo Adafruit) deu tela em branco,
                                // INITR_BLACKTAB funcionou (cores ciclando corretamente) - clone
                                // generico nao segue a convencao de tab da Adafruit. Ver
                                // docs/01-decisoes-arquiteturais.md
    // Paisagem (2026-09-01, a pedido do Rodrigo - ver foto em anexo na
    // conversa): o painel fisico e' 128x160 (sticker "1.8' 128X160
    // RGB_TFT" - a doc antiga de 1.44"/128x128 estava desatualizada), e
    // vinha rodando em retrato (rotacao 0) so' porque nunca foi ajustado.
    // rotation 1 = 90 graus - se sair de cabeca pra baixo/espelhado,
    // trocar pra rotation 3 (270 graus), e' so' isso que muda.
    tft.setRotation(1);
    renderBoot();

    if (!TinyUSBDevice.isInitialized())
    {
        // Nome do dispositivo USB (2026-09-01, a pedido do Rodrigo - "DRUMCORE"
        // em tudo quanto e' lugar que o SO mostrar). Precisa ser chamado ANTES
        // de begin() - depois disso os descritores ja' foram enviados pro
        // host. Isso troca o nome do dispositivo USB em si (o que aparece em
        // Gerenciador de Dispositivos/Configuracoes de Som do Windows); o
        // nome da porta MIDI (usb_midi.setStringDescriptor(), mais abaixo)
        // e' outro campo, mostrado dentro de apps de audio/MIDI.
        TinyUSBDevice.setManufacturerDescriptor("DRUMCORE");
        TinyUSBDevice.setProductDescriptor("DRUMCORE");
        // Numero de serie USB (2026-09-01) - nunca foi definido antes. Sem
        // ele, o Windows identifica o dispositivo so' pelo VID/PID (sempre
        // os mesmos aqui, ver docs/01-decisoes-arquiteturais.md), e como a
        // placa ja foi gravada com varias configuracoes de USB diferentes
        // ao longo do projeto, o driver associado no Windows pode ter
        // ficado em cache de uma config antiga (de antes do MIDI existir),
        // sem re-enumerar do zero. Um serial fixo forca o Windows a tratar
        // como dispositivo "novo".
        TinyUSBDevice.setSerialDescriptor("DRUMCORE001");
        TinyUSBDevice.begin(0);
    }
    renderBootProgress(20);

    usb_midi.setStringDescriptor("DRUMCORE");
    MIDI.begin(MIDI_CHANNEL_OMNI);
    if (TinyUSBDevice.mounted())
    {
        TinyUSBDevice.detach();
        delay(10);
        TinyUSBDevice.attach();
    }

    // Religa o hardware USB de verdade AGORA - depois do descritor Adafruit
    // ja estar completo (MIDI incluido acima) - ver bringUpNativeUsbHardware()
    // no topo do arquivo pro racional completo. Tentativa anterior
    // (USB.begin() da classe ESPUSB) travava o boot por misturar duas
    // pilhas TinyUSB incompativeis - essa versao usa so' as pecas de baixo
    // nivel da propria Adafruit, consistente com o tud_task() que "ganha"
    // no link.
    bringUpNativeUsbHardware();
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
            padEnabled[i] = true; // todo canal comeca habilitado por padrao
            pads[i].retrigger = 0; // Fase P - 0 = desligado (comportamento original)
            padGain[i] = 100;       // 1.00x, neutro
            padXtalk[i] = 0;        // sem supressao de crosstalk
            padXtalkGroup[i] = 0;   // sem grupo
            padHihatInvert[i] = false; // Fase X - nao invertido por padrao
            rebuildPadName(i);
            pads[i].initMemory();
            EEPROM_ESP.writeBytes(padLabelEepromAddr(i), padLabels[i], PAD_LABEL_MAX_LEN);
            EEPROM_ESP.write(EEPROM_TYPES_ADDR + i, padTypes[i]);
            EEPROM_ESP.write(EEPROM_HIHAT_LINK_ADDR + i, hihatPedalChannel[i]);
            EEPROM_ESP.write(EEPROM_ENABLED_ADDR + i, 1);
            EEPROM_ESP.write(EEPROM_RETRIGGER_ADDR + i, 0);
            EEPROM_ESP.write(EEPROM_GAIN_ADDR + i, 100);
            EEPROM_ESP.write(EEPROM_XTALK_ADDR + i, 0);
            EEPROM_ESP.write(EEPROM_XTALK_GROUP_ADDR + i, 0);
            EEPROM_ESP.write(EEPROM_HIHAT_INVERT_ADDR + i, 0);
        }
        recomputeChannelPrimary();
        EEPROM_ESP.write(EEPROM_GLOBAL_ADDR, midiChannel);
        EEPROM_ESP.write(EEPROM_GLOBAL_ADDR + 1, midiOutput);
        EEPROM_ESP.write(EEPROM_INIT_FLAG_ADDR, EEPROM_INIT_MAGIC);
        EEPROM_ESP.commit();
    }
    else
    {
        loadAllFromEeprom();
    }

    // CONTORNO TEMPORARIO (ainda necessario em 2026-09-01, mesmo com o bug
    // do pads[] corrigido - Fase R): sem os 2x CD4067/32 pads fisicos
    // conectados de verdade ainda, cada canal ADC fica flutuando e capta
    // ruido, o que disparia "hit" espalhados pelos 32 quadrados na tela
    // LIVE o tempo todo. Desabilitando todos os canais aqui (so' em RAM,
    // nao mexe na EEPROM) pra manter a interface legivel ate' o MUX/pads
    // serem conectados de verdade - ai' sim remover este bloco (ou
    // habilitar so' os canais com sensor conectado).
    for (byte i = 0; i < NUM_PADS; i++)
    {
        padEnabled[i] = false;
    }

    // TESTE TEMPORARIO (2026-09-01, a pedido do Rodrigo) - o MUX fisico
    // ainda nao chegou. Habilita so' o pad 0 (canais 0 e 1, "Pad 1" na UI
    // 1-based) como dual-zone (corpo+aro), lido direto de 2 pinos do
    // ESP32-S3 em vez do MUX (ver leitura em loop(), logo apos o scan dos
    // MUX - sobrescreve rawValue[0]/rawValue[1], que os MUX tambem
    // escrevem, com lixo/flutuando, ja' que o MUX0 nao esta' conectado de
    // verdade ainda). "Pad 2" (canal 1) aparece como "canal ocupado" na
    // lista, igual qualquer outro dual-zone - e' esperado, nao e' um
    // segundo pad de verdade. Remover esse bloco (e a leitura em loop())
    // quando o MUX chegar e a fiacao real dos 32 canais for feita - ver
    // docs/02-hardware.md pros pinos GPIO17/GPIO18 usados aqui (livres,
    // ADC2, sem uso previsto ate' entao).
    padTypes[0] = PAD_DUAL;
    padEnabled[0] = true;
    recomputeChannelPrimary();
    rebuildPadName(0);
    rebuildPadName(1);

    renderBootProgress(80);

    pinMode(ENC1_SW, INPUT_PULLUP);
    pinMode(ENC2_SW, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(ENC1_A), isrEnc1, CHANGE);
    attachInterrupt(digitalPinToInterrupt(ENC1_B), isrEnc1, CHANGE);
    attachInterrupt(digitalPinToInterrupt(ENC2_A), isrEnc2, CHANGE);
    attachInterrupt(digitalPinToInterrupt(ENC2_B), isrEnc2, CHANGE);
    renderBootProgress(100);

    // 2026-09-01, a pedido do Rodrigo - tela de boot ficava visivel por
    // fracoes de segundo (todo o resto do setup() acima e' rapido o
    // suficiente pra nao dar tempo de ler nada). Segura mais um pouco
    // antes de ir pra LIVE.
    delay(1200);
    sendLog("DrumCore - Fase J/K: navegacao/tela redesenhada (32 canais, 2x CD4067, USB-MIDI + BLE-MIDI)");
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

    // TESTE TEMPORARIO (2026-09-01) - ver defines TEST_DIRECT_HEAD_PIN/
    // TEST_DIRECT_RIM_PIN acima. Sobrescreve de proposito o que
    // mux[0].scan() acabou de escrever em rawValue[0]/[1] (lixo/flutuando,
    // MUX0 nao conectado de verdade ainda) com a leitura real dos 2 pinos
    // diretos. Remover quando o MUX chegar.
    rawValue[0] = analogRead(TEST_DIRECT_HEAD_PIN);
    rawValue[1] = analogRead(TEST_DIRECT_RIM_PIN);

    applyPadGain(); // Fase P - antes do dispatch, pra ja ler o rawValue calibrado

    for (byte i = 0; i < NUM_PADS; i++)
    {
        // padEnabled[i] == false: canal desligado de proposito (slot sem
        // sensor conectado) - nem processa o rawValue dele, pra ruido/
        // interferencia nesse canal nunca virar hit/nota. Ver
        // docs/01-decisoes-arquiteturais.md (Fase N).
        if (channelPrimary[i] && padEnabled[i])
        {
            dispatchSensing(i);
        }
    }

    suppressCrosstalk(); // Fase P - depois do dispatch, antes de decidir o que enviar

    for (byte i = 0; i < NUM_PADS; i++)
    {
        if (channelPrimary[i] && padEnabled[i])
        {
            handlePadResult(i);
        }
    }

    if (currentPage == PAGE_AUTOTUNE)
    {
        autoTuneTick();
    }

    handleEncoders();
    renderScreen();
    pollSerialCommands();
}
