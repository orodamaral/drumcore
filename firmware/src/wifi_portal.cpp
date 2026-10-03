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

static AsyncWebServer *server = nullptr;
static AsyncWebSocket *ws = nullptr;
static QueueHandle_t rxQueue = nullptr;
static bool active = false;
static char ssid[24] = "";
static char password[12] = "";

struct RxLine
{
    char text[WS_LINE_MAX];
};

// Senha da rede: 8 digitos sorteados no 1o uso e guardados na NVS
// (Preferences) - cada placa tem a sua, mostrada na tela GLOBAL e no app.
static void loadCredentials()
{
    // MAC de fabrica (eFuse) - nao precisa do Wi-Fi ligado.
    uint64_t mac = ESP.getEfuseMac();
    snprintf(ssid, sizeof(ssid), "DrumCore-%02X%02X", (unsigned)((mac >> 32) & 0xFF), (unsigned)((mac >> 40) & 0xFF));

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
    prefs.end();
    strncpy(password, pass.c_str(), sizeof(password) - 1);
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

bool wifiPortalStart()
{
    if (active)
    {
        return true;
    }
    if (!rxQueue)
    {
        rxQueue = xQueueCreate(WS_QUEUE_LEN, sizeof(RxLine));
    }
    WiFi.mode(WIFI_AP);
    if (!ssid[0])
    {
        loadCredentials();
    }
    if (!WiFi.softAP(ssid, password, WIFI_AP_CHANNEL, 0, WIFI_AP_MAX_CLIENTS))
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
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_OFF);
}

bool wifiPortalActive()
{
    return active;
}

void wifiPortalPoll(void (*handler)(const String &line))
{
    if (!rxQueue)
    {
        return;
    }
    RxLine line;
    // Limite por volta do loop - nao deixa uma rajada de comandos segurar
    // a leitura dos pads por muito tempo.
    for (int n = 0; n < 4 && xQueueReceive(rxQueue, &line, 0) == pdTRUE; n++)
    {
        handler(String(line.text));
    }
    if (active)
    {
        static unsigned long lastCleanup = 0;
        if (millis() - lastCleanup > 1000)
        {
            lastCleanup = millis();
            ws->cleanupClients();
        }
    }
}

void wifiPortalBroadcast(const String &line)
{
    if (active && ws->count() > 0)
    {
        ws->textAll(line);
    }
}

const char *wifiPortalSsid()
{
    if (!ssid[0])
    {
        loadCredentials();
    }
    return ssid;
}

const char *wifiPortalPassword()
{
    if (!ssid[0])
    {
        loadCredentials();
    }
    return password;
}

const char *wifiPortalHostname()
{
    return WIFI_HOSTNAME;
}

String wifiPortalIp()
{
    return active ? WiFi.softAPIP().toString() : String("");
}

int wifiPortalClientCount()
{
    return active ? ws->count() : 0;
}
