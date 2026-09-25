/*
  Captura do sinal BRUTO de um pad dual (2026-09-24) - so' pra estudar a
  forma de onda do pad caseiro (piezo central sob o cone de espuma + piezo
  na barra perto do aro) e decidir a melhor estrategia de sensing. Sem
  MUX/tela/USB-MIDI/BLE/EEPROM do firmware principal.

  Pinos (mesmos do bring-up sem jackboard em main.cpp, ambos ADC1):
    GPIO9  (ADC1_CH8) - canal 0 = piezo central (head)
    GPIO10 (ADC1_CH9) - canal 1 = piezo da borda (rim)

  Como funciona: amostra os 2 canais continuamente a cada SAMPLE_PERIOD_US
  num buffer circular. Quando qualquer canal passa de (baseline + limiar),
  guarda preMs de "antes" + postMs de "depois" e despeja o bloco inteiro no
  Serial (CSV). Em repouso, a cada NOISE_REPORT_MS imprime estatisticas de
  ruido de fundo. O script tools/rawpad_capture.py le isso e salva cada
  batida num CSV separado.

  Formato no Serial:
    # ...                                     (comentario/status)
    NOISE ms=<janela> c0=<media>,<dp>,<min>,<max> c1=...
    HIT n=<num> trig=<canal> period_us=<real> pre=<frames> frames=<total>
    <c0>,<c1>                                 (uma linha por frame)
    END

  Comandos (terminar com Enter):
    t <n>   limiar de disparo em contagens de ADC acima do baseline (def. 60)
    w <ms>  janela pos-disparo em ms (def. 100, max ~ POST_MAX_MS)
    ?       mostra a configuracao atual

  Uso: pio run -e rawpad -t upload --upload-port COM5
       python tools/rawpad_capture.py COM5
*/

#include <Arduino.h>

#define PIN_HEAD 9
#define PIN_RIM 10

#define SAMPLE_PERIOD_US 125 // 8 kHz por canal - cada analogRead leva ~60us no S3, o par nao cabe em 100us
#define PRE_MS 10
#define POST_MAX_MS 250
#define PRE_FRAMES (PRE_MS * 1000 / SAMPLE_PERIOD_US)
#define POST_MAX_FRAMES (POST_MAX_MS * 1000 / SAMPLE_PERIOD_US)
#define NOISE_REPORT_MS 3000
#define BASELINE_SHIFT 6 // media movel exponencial, alfa = 1/64

static uint16_t ring[PRE_FRAMES][2];
static uint16_t ringPos = 0;
static uint16_t capture[PRE_FRAMES + POST_MAX_FRAMES][2];

static int threshold = 60;
static int postMs = 100;
static uint32_t hitCount = 0;

// Baseline em ponto fixo (<< BASELINE_SHIFT) por canal.
static int32_t baseFx[2] = {0, 0};

// Estatisticas de ruido do periodo em repouso.
static uint32_t nStat = 0;
static double sum[2], sumSq[2];
static uint16_t vMin[2], vMax[2];
static uint32_t statStartMs = 0;

static char cmdBuf[24];
static uint8_t cmdLen = 0;

static void resetStats()
{
    nStat = 0;
    for (int c = 0; c < 2; c++)
    {
        sum[c] = 0;
        sumSq[c] = 0;
        vMin[c] = 4095;
        vMax[c] = 0;
    }
    statStartMs = millis();
}

static void printConfig()
{
    Serial.printf("# rawpad head=GPIO%d rim=GPIO%d period_us=%d pre_ms=%d post_ms=%d threshold=%d\n",
                  PIN_HEAD, PIN_RIM, SAMPLE_PERIOD_US, PRE_MS, postMs, threshold);
}

static void handleCommand()
{
    cmdBuf[cmdLen] = 0;
    int v;
    if (sscanf(cmdBuf, "t %d", &v) == 1 && v > 0 && v < 4000)
        threshold = v;
    else if (sscanf(cmdBuf, "w %d", &v) == 1 && v >= 10 && v <= POST_MAX_MS)
        postMs = v;
    else if (cmdBuf[0] != '?')
        Serial.printf("# comando invalido: '%s'\n", cmdBuf);
    printConfig();
}

static void pollSerial()
{
    while (Serial.available())
    {
        char ch = Serial.read();
        if (ch == '\n' || ch == '\r')
        {
            if (cmdLen > 0)
                handleCommand();
            cmdLen = 0;
        }
        else if (cmdLen < sizeof(cmdBuf) - 1)
            cmdBuf[cmdLen++] = ch;
    }
}

static inline void readPair(uint16_t &h, uint16_t &r)
{
    h = analogRead(PIN_HEAD);
    r = analogRead(PIN_RIM);
}

void setup()
{
    Serial.begin(921600);
    analogReadResolution(12);
    analogSetAttenuation(ADC_11db); // faixa ~0-3.1V
    delay(300);

    // Baseline inicial: media de 256 leituras.
    uint32_t acc[2] = {0, 0};
    for (int i = 0; i < 256; i++)
    {
        uint16_t h, r;
        readPair(h, r);
        acc[0] += h;
        acc[1] += r;
        delayMicroseconds(SAMPLE_PERIOD_US);
    }
    for (int c = 0; c < 2; c++)
        baseFx[c] = (int32_t)(acc[c] / 256) << BASELINE_SHIFT;

    printConfig();
    Serial.println("# pronto - pode bater no pad");
    resetStats();
}

static void captureHit(int trigCh)
{
    // Copia o pre-trigger do buffer circular, em ordem cronologica.
    for (int i = 0; i < PRE_FRAMES; i++)
    {
        uint16_t idx = (ringPos + i) % PRE_FRAMES;
        capture[i][0] = ring[idx][0];
        capture[i][1] = ring[idx][1];
    }

    int postFrames = postMs * 1000 / SAMPLE_PERIOD_US;
    uint32_t t0 = micros();
    uint32_t next = t0;
    for (int i = 0; i < postFrames; i++)
    {
        while ((int32_t)(micros() - next) < 0)
        {
        }
        next += SAMPLE_PERIOD_US;
        readPair(capture[PRE_FRAMES + i][0], capture[PRE_FRAMES + i][1]);
    }
    float realPeriod = (float)(micros() - t0) / postFrames;

    hitCount++;
    int total = PRE_FRAMES + postFrames;
    Serial.printf("HIT n=%lu trig=%d period_us=%.1f pre=%d frames=%d base0=%ld base1=%ld\n",
                  (unsigned long)hitCount, trigCh, realPeriod, PRE_FRAMES, total,
                  (long)(baseFx[0] >> BASELINE_SHIFT), (long)(baseFx[1] >> BASELINE_SHIFT));
    for (int i = 0; i < total; i++)
        Serial.printf("%u,%u\n", capture[i][0], capture[i][1]);
    Serial.println("END");
    Serial.flush();

    // Re-sincroniza: descarta o que sobrou da cauda e zera o ring.
    delay(20);
    for (int i = 0; i < PRE_FRAMES; i++)
    {
        readPair(ring[i][0], ring[i][1]);
        delayMicroseconds(SAMPLE_PERIOD_US);
    }
    ringPos = 0;
    pollSerial(); // senao, disparando sem parar, nenhum comando e' lido
    resetStats();
}

void loop()
{
    static uint32_t next = micros();
    while ((int32_t)(micros() - next) < 0)
    {
    }
    next += SAMPLE_PERIOD_US;

    uint16_t v[2];
    readPair(v[0], v[1]);
    ring[ringPos][0] = v[0];
    ring[ringPos][1] = v[1];
    ringPos = (ringPos + 1) % PRE_FRAMES;

    for (int c = 0; c < 2; c++)
    {
        int base = baseFx[c] >> BASELINE_SHIFT;
        if ((int)v[c] - base > threshold)
        {
            captureHit(c);
            next = micros();
            return;
        }
    }

    // Repouso: atualiza baseline e estatisticas de ruido.
    for (int c = 0; c < 2; c++)
    {
        baseFx[c] += (int32_t)v[c] - (baseFx[c] >> BASELINE_SHIFT);
        sum[c] += v[c];
        sumSq[c] += (double)v[c] * v[c];
        if (v[c] < vMin[c])
            vMin[c] = v[c];
        if (v[c] > vMax[c])
            vMax[c] = v[c];
    }
    nStat++;

    if (millis() - statStartMs >= NOISE_REPORT_MS)
    {
        Serial.print("NOISE ms=");
        Serial.print(millis() - statStartMs);
        for (int c = 0; c < 2; c++)
        {
            double mean = sum[c] / nStat;
            double var = sumSq[c] / nStat - mean * mean;
            Serial.printf(" c%d=%.1f,%.1f,%u,%u", c, mean, var > 0 ? sqrt(var) : 0.0, vMin[c], vMax[c]);
        }
        Serial.println();
        pollSerial();
        resetStats();
        next = micros();
    }
    else if ((nStat & 0x3FF) == 0)
    {
        pollSerial();
    }
}
