// Wi-Fi do modulo (Fase AE - ver docs/08-wifi.md): ConfigTool servido pela
// placa + WebSocket com o mesmo protocolo NDJSON da serial
// (docs/04-protocolo-serial.md).
//
// Fase 1: rede propria (ponto de acesso). Fase 2: rede de casa - com uma
// rede salva, o Wi-Fi tenta ela primeiro e so' cria a rede propria se nao
// conseguir conectar.
//
// Desligado por padrao a cada boot (a nao ser com "ligar ao iniciar") - liga
// pelo menu GLOBAL > WI-FI ou pelo comando set_wifi. O servidor roda na task
// do AsyncTCP (outro nucleo); comandos que chegam pelo WebSocket entram numa
// fila e so' sao executados no loop() principal, via wifiPortalPoll().
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

enum WifiStaState
{
    WIFI_STA_NONE,       // sem rede de casa salva, ou Wi-Fi desligado
    WIFI_STA_CONNECTING, // tentando conectar (ou reconectar)
    WIFI_STA_CONNECTED,
    WIFI_STA_FAILED, // nao conectou no tempo limite - rede propria no ar
};

// onCommand: linha recebida pelo WebSocket. onStatus: algo mudou (rede
// conectou/caiu, rede propria ligou/desligou) - o main reenvia device_info
// e redesenha a tela. emit: manda uma mensagem JSON (resultado da busca de
// redes). Todos chamados so' de dentro do wifiPortalPoll() (loop principal).
void wifiPortalSetCallbacks(void (*onCommand)(const String &line), void (*onStatus)(), void (*emit)(JsonDocument &doc));

bool wifiPortalStart();
void wifiPortalStop();
bool wifiPortalActive();
void wifiPortalPoll();

// Manda uma linha (sem '\n') pra todos os clientes do WebSocket.
void wifiPortalBroadcast(const String &line);

// Rede propria (ponto de acesso).
bool wifiPortalApActive();
const char *wifiPortalSsid();
const char *wifiPortalPassword();
String wifiPortalApIp();

// Rede de casa. A senha nunca sai da placa (nem no device_info).
bool wifiPortalSetNetwork(const char *ssid, const char *password);
bool wifiPortalRetry(); // tenta a rede salva de novo (depois de WIFI_STA_FAILED)
void wifiPortalForgetNetwork();
const char *wifiPortalStaSsid(); // "" = nenhuma salva
WifiStaState wifiPortalStaState();
const char *wifiPortalStaStateName();
String wifiPortalStaIp();
// ms ate' a rede propria desligar sozinha depois de conectar na de casa (0 = nao vai desligar)
unsigned long wifiPortalApOffInMs();

// Busca de redes (assincrona) - o resultado sai pelo emit como wifi_scan.
bool wifiPortalStartScan();

bool wifiPortalAutostart();
void wifiPortalSetAutostart(bool on);

const char *wifiPortalHostname(); // "drumcore" -> drumcore.local
int wifiPortalClientCount();
