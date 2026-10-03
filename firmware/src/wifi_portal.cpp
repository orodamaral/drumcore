// Ver wifi_portal.h e docs/08-wifi.md.
#include "wifi_portal.h"

#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>

#include "webapp_files.h" // gerado por firmware/embed_webapp.py

#define WIFI_HOSTNAME "drumcore"
#define WIFI_AP_CHANNEL 6
#define WIFI_AP_MAX_CLIENTS 4
#define WS_LINE_MAX 300 // comandos do app tem bem menos que isso
#define WS_QUEUE_LEN 24
// Tempo pra conectar na rede de casa antes de criar a rede propria.
#define WIFI_STA_TIMEOUT_MS 15000
// Depois de conectar na rede de casa a partir da rede propria, ela fica no
// ar mais um pouco - da' tempo do app mostrar o novo endereco antes do
// celular perder a conexao.
#define WIFI_AP_LINGER_MS 30000
#define WIFI_SCAN_MAX 15

static AsyncWebServer *server = nullptr;
static AsyncWebSocket *ws = nullptr;
static QueueHandle_t rxQueue = nullptr;
static void (*cbCommand)(const String &) = nullptr;
static void (*cbStatus)() = nullptr;
static void (*cbEmit)(JsonDocument &) = nullptr;

static bool active = false;
static bool apOn = false;
static bool prefsLoaded = false;
static char apSsid[24] = "";
static char apPass[12] = "";
static char staSsid[33] = "";
static char staPass[64] = "";
static bool autostart = false;

static WifiStaState staState = WIFI_STA_NONE;
static unsigned long staSinceMs = 0;
static unsigned long apOffAtMs = 0; // 0 = nao agendado
static bool scanning = false;

struct RxLine
{
    char text[WS_LINE_MAX];
};

static void notifyStatus()
{
    if (cbStatus)
    {
        cbStatus();
    }
}

// Senha da rede propria: 8 digitos sorteados no 1o uso e guardados na NVS
// (Preferences) - cada placa tem a sua. Rede de casa e "ligar ao iniciar"
// tambem ficam la'.
static void loadPrefs()
{
    if (prefsLoaded)
    {
        return;
    }
    prefsLoaded = true;
    // MAC de fabrica (eFuse) - nao precisa do Wi-Fi ligado.
    uint64_t mac = ESP.getEfuseMac();
    snprintf(apSsid, sizeof(apSsid), "DrumCore-%02X%02X", (unsigned)((mac >> 32) & 0xFF), (unsigned)((mac >> 40) & 0xFF));

    Preferences prefs;
    prefs.begin("wifi", false);
    String pass = prefs.getString("ap_pass", "");
    if (pass.length() < 8)
    {
        char buf[9];
        for (int i = 0; i < 8; i++)
        {
            buf[i] = '0' + (esp_random() % 10);
        }
        buf[8] = '\0';
        pass = buf;
        prefs.putString("ap_pass", pass);
    }
    strncpy(apPass, pass.c_str(), sizeof(apPass) - 1);
    strncpy(staSsid, prefs.getString("sta_ssid", "").c_str(), sizeof(staSsid) - 1);
    strncpy(staPass, prefs.getString("sta_pass", "").c_str(), sizeof(staPass) - 1);
    autostart = prefs.getBool("autostart", false);
    prefs.end();
}

static void onWsEvent(AsyncWebSocket *, AsyncWebSocketClient *, AwsEventType type, void *arg, uint8_t *data, size_t len)
{
    if (type != WS_EVT_DATA)
    {
        return;
    }
    AwsFrameInfo *info = (AwsFrameInfo *)arg;
    // So' mensagens de texto inteiras num frame (o app manda 1 comando curto
    // por mensagem) - fragmentadas/grandes demais sao descartadas.
    if (!info->final || info->index != 0 || info->len != len || info->opcode != WS_TEXT)
    {
        return;
    }
    size_t start = 0;
    for (size_t i = 0; i <= len; i++)
    {
        if (i == len || data[i] == '\n')
        {
            size_t n = i - start;
            if (n > 0 && n < WS_LINE_MAX)
            {
                RxLine line;
                memcpy(line.text, data + start, n);
                line.text[n] = '\0';
                xQueueSend(rxQueue, &line, 0); // fila cheia: descarta
            }
            start = i + 1;
        }
    }
}

static void serveFile(AsyncWebServerRequest *request, const WebAppFile &f)
{
    AsyncWebServerResponse *res = request->beginResponse(200, f.mime, f.data, f.len);
    res->addHeader("Content-Encoding", "gzip");
    // Arquivos em /assets/ tem hash no nome (Vite) - podem ficar em cache;
    // o index.html nao, pra pegar o app novo depois de atualizar o firmware.
    if (strncmp(f.path, "/assets/", 8) == 0)
    {
        res->addHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
    else
    {
        res->addHeader("Cache-Control", "no-cache");
    }
    request->send(res);
}

static void setupServer()
{
    server = new AsyncWebServer(80);
    ws = new AsyncWebSocket("/ws");
    ws->onEvent(onWsEvent);
    server->addHandler(ws);

    server->onNotFound([](AsyncWebServerRequest *request) {
        String url = request->url();
        if (url == "/")
        {
            url = "/index.html";
        }
        for (size_t i = 0; i < WEBAPP_FILE_COUNT; i++)
        {
            if (url == WEBAPP_FILES[i].path)
            {
                serveFile(request, WEBAPP_FILES[i]);
                return;
            }
        }
        request->send(404, "text/plain", "Nao encontrado");
    });
    server->begin();
}

static bool startAp()
{
    if (apOn)
    {
        return true;
    }
    bool sta = staState == WIFI_STA_CONNECTING || staState == WIFI_STA_CONNECTED;
    WiFi.mode(sta ? WIFI_AP_STA : WIFI_AP);
    apOn = WiFi.softAP(apSsid, apPass, WIFI_AP_CHANNEL, 0, WIFI_AP_MAX_CLIENTS);
    return apOn;
}

static void stopAp()
{
    if (!apOn)
    {
        return;
    }
    apOn = false;
    apOffAtMs = 0;
    WiFi.softAPdisconnect(true);
    bool sta = staState == WIFI_STA_CONNECTING || staState == WIFI_STA_CONNECTED;
    WiFi.mode(sta ? WIFI_STA : WIFI_OFF);
}

static void beginSta()
{
    WiFi.mode(apOn ? WIFI_AP_STA : WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(staSsid, staPass[0] ? staPass : nullptr);
    staState = WIFI_STA_CONNECTING;
    staSinceMs = millis();
}

void wifiPortalSetCallbacks(void (*onCommand)(const String &line), void (*onStatus)(), void (*emit)(JsonDocument &doc))
{
    cbCommand = onCommand;
    cbStatus = onStatus;
    cbEmit = emit;
}

bool wifiPortalStart()
{
    if (active)
    {
        return true;
    }
    loadPrefs();
    if (!rxQueue)
    {
        rxQueue = xQueueCreate(WS_QUEUE_LEN, sizeof(RxLine));
    }
    WiFi.setHostname(WIFI_HOSTNAME); // nome no roteador (DHCP) - antes do mode()
    staState = WIFI_STA_NONE;
    if (staSsid[0])
    {
        beginSta(); // rede propria so' se nao conectar - ver wifiPortalPoll()
    }
    else if (!startAp())
    {
        WiFi.mode(WIFI_OFF);
        return false;
    }
    if (!server)
    {
        setupServer(); // uma vez so' - fica ouvindo mesmo com o Wi-Fi desligado
    }
    if (MDNS.begin(WIFI_HOSTNAME))
    {
        MDNS.addService("http", "tcp", 80);
    }
    active = true;
    return true;
}

void wifiPortalStop()
{
    if (!active)
    {
        return;
    }
    active = false;
    ws->closeAll();
    MDNS.end();
    if (scanning)
    {
        WiFi.scanDelete();
        scanning = false;
    }
    WiFi.disconnect(true);
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_OFF);
    apOn = false;
    apOffAtMs = 0;
    staState = WIFI_STA_NONE;
}

bool wifiPortalActive()
{
    return active;
}

static void pollSta()
{
    if (staState == WIFI_STA_NONE)
    {
        return;
    }
    bool up = WiFi.status() == WL_CONNECTED;
    unsigned long now = millis();

    if (up && staState != WIFI_STA_CONNECTED)
    {
        staState = WIFI_STA_CONNECTED;
        if (apOn)
        {
            apOffAtMs = now + WIFI_AP_LINGER_MS; // ver WIFI_AP_LINGER_MS
        }
        notifyStatus();
    }
    else if (!up && staState == WIFI_STA_CONNECTED)
    {
        staState = WIFI_STA_CONNECTING; // caiu - o core tenta reconectar sozinho
        staSinceMs = now;
        apOffAtMs = 0;
        notifyStatus();
    }
    else if (staState == WIFI_STA_CONNECTING && now - staSinceMs > WIFI_STA_TIMEOUT_MS)
    {
        // Nao conectou: para de tentar (cada tentativa troca o canal do
        // radio e derruba quem esta' na rede propria) e poe a rede propria
        // no ar, pro usuario entrar e corrigir - "tentar de novo" pelo app
        // (wifiPortalRetry) ou ao religar o Wi-Fi.
        staState = WIFI_STA_FAILED;
        WiFi.setAutoReconnect(false);
        WiFi.disconnect(true);
        apOn = false; // o disconnect pode ter mexido no modo - recria
        startAp();
        notifyStatus();
    }

    if (apOffAtMs && (long)(now - apOffAtMs) >= 0 && staState == WIFI_STA_CONNECTED)
    {
        stopAp();
        notifyStatus();
    }
}

static void pollScan()
{
    if (!scanning)
    {
        return;
    }
    int n = WiFi.scanComplete();
    if (n == WIFI_SCAN_RUNNING)
    {
        return;
    }
    scanning = false;
    JsonDocument doc;
    doc["type"] = "wifi_scan";
    JsonArray arr = doc["networks"].to<JsonArray>();
    if (n > 0)
    {
        // Sem repetir o mesmo nome (roteador com varios pontos), o mais
        // forte primeiro.
        int order[64];
        int count = 0;
        for (int i = 0; i < n && count < 64; i++)
        {
            if (WiFi.SSID(i).length() == 0)
            {
                continue; // rede oculta
            }
            bool dup = false;
            for (int k = 0; k < count; k++)
            {
                if (WiFi.SSID(order[k]) == WiFi.SSID(i))
                {
                    if (WiFi.RSSI(i) > WiFi.RSSI(order[k]))
                    {
                        order[k] = i;
                    }
                    dup = true;
                    break;
                }
            }
            if (!dup)
            {
                order[count++] = i;
            }
        }
        for (int a = 0; a < count; a++)
        {
            for (int b = a + 1; b < count; b++)
            {
                if (WiFi.RSSI(order[b]) > WiFi.RSSI(order[a]))
                {
                    int t = order[a];
                    order[a] = order[b];
                    order[b] = t;
                }
            }
        }
        for (int a = 0; a < count && a < WIFI_SCAN_MAX; a++)
        {
            JsonObject o = arr.add<JsonObject>();
            o["ssid"] = WiFi.SSID(order[a]);
            o["rssi"] = WiFi.RSSI(order[a]);
            o["secure"] = WiFi.encryptionType(order[a]) != WIFI_AUTH_OPEN;
        }
    }
    else if (n < 0)
    {
        doc["error"] = "scan_failed";
    }
    WiFi.scanDelete();
    if (cbEmit)
    {
        cbEmit(doc);
    }
}

void wifiPortalPoll()
{
    if (rxQueue && cbCommand)
    {
        RxLine line;
        // Limite por volta do loop - nao deixa uma rajada de comandos segurar
        // a leitura dos pads por muito tempo.
        for (int n = 0; n < 4 && xQueueReceive(rxQueue, &line, 0) == pdTRUE; n++)
        {
            cbCommand(String(line.text));
        }
    }
    if (!active)
    {
        return;
    }
    pollSta();
    pollScan();
    static unsigned long lastCleanup = 0;
    if (millis() - lastCleanup > 1000)
    {
        lastCleanup = millis();
        ws->cleanupClients();
    }
}

void wifiPortalBroadcast(const String &line)
{
    if (active && ws->count() > 0)
    {
        ws->textAll(line);
    }
}

bool wifiPortalApActive()
{
    return active && apOn;
}

const char *wifiPortalSsid()
{
    loadPrefs();
    return apSsid;
}

const char *wifiPortalPassword()
{
    loadPrefs();
    return apPass;
}

String wifiPortalApIp()
{
    return wifiPortalApActive() ? WiFi.softAPIP().toString() : String("");
}

bool wifiPortalSetNetwork(const char *ssid, const char *password)
{
    loadPrefs();
    size_t ls = strlen(ssid), lp = strlen(password);
    if (ls == 0 || ls > 32 || (lp > 0 && lp < 8) || lp > 63)
    {
        return false;
    }
    strncpy(staSsid, ssid, sizeof(staSsid) - 1);
    staSsid[sizeof(staSsid) - 1] = '\0';
    strncpy(staPass, password, sizeof(staPass) - 1);
    staPass[sizeof(staPass) - 1] = '\0';
    Preferences prefs;
    prefs.begin("wifi", false);
    prefs.putString("sta_ssid", staSsid);
    prefs.putString("sta_pass", staPass);
    prefs.end();
    if (active)
    {
        // Conectado pela rede propria: ela fica no ar enquanto tenta (e mais
        // WIFI_AP_LINGER_MS depois de conectar).
        if (!apOn && staState != WIFI_STA_CONNECTED)
        {
            startAp();
        }
        WiFi.disconnect();
        beginSta();
    }
    return true;
}

bool wifiPortalRetry()
{
    if (!active || !staSsid[0])
    {
        return false;
    }
    if (!apOn && staState != WIFI_STA_CONNECTED)
    {
        startAp();
    }
    WiFi.disconnect();
    beginSta();
    return true;
}

void wifiPortalForgetNetwork()
{
    loadPrefs();
    staSsid[0] = '\0';
    staPass[0] = '\0';
    Preferences prefs;
    prefs.begin("wifi", false);
    prefs.remove("sta_ssid");
    prefs.remove("sta_pass");
    prefs.end();
    if (active)
    {
        WiFi.disconnect();
        staState = WIFI_STA_NONE;
        apOffAtMs = 0;
        if (apOn)
        {
            WiFi.mode(WIFI_AP);
        }
        else
        {
            startAp(); // sem rede de casa: volta pra rede propria
        }
    }
}

const char *wifiPortalStaSsid()
{
    loadPrefs();
    return staSsid;
}

WifiStaState wifiPortalStaState()
{
    return staState;
}

const char *wifiPortalStaStateName()
{
    switch (staState)
    {
    case WIFI_STA_CONNECTING:
        return "connecting";
    case WIFI_STA_CONNECTED:
        return "connected";
    case WIFI_STA_FAILED:
        return "failed";
    default:
        return "none";
    }
}

String wifiPortalStaIp()
{
    return staState == WIFI_STA_CONNECTED ? WiFi.localIP().toString() : String("");
}

unsigned long wifiPortalApOffInMs()
{
    if (!apOffAtMs || !apOn)
    {
        return 0;
    }
    long left = (long)(apOffAtMs - millis());
    return left > 0 ? (unsigned long)left : 0;
}

bool wifiPortalStartScan()
{
    if (!active || scanning)
    {
        return scanning;
    }
    if (WiFi.getMode() == WIFI_AP)
    {
        WiFi.mode(WIFI_AP_STA); // a busca precisa da interface de cliente
    }
    scanning = WiFi.scanNetworks(true) == WIFI_SCAN_RUNNING;
    return scanning;
}

bool wifiPortalAutostart()
{
    loadPrefs();
    return autostart;
}

void wifiPortalSetAutostart(bool on)
{
    loadPrefs();
    autostart = on;
    Preferences prefs;
    prefs.begin("wifi", false);
    prefs.putBool("autostart", on);
    prefs.end();
}

const char *wifiPortalHostname()
{
    return WIFI_HOSTNAME;
}

int wifiPortalClientCount()
{
    return active ? ws->count() : 0;
}
