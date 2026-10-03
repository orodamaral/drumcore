// Wi-Fi do modulo (Fase AE, fase 1 - ver docs/08-wifi.md): rede propria
// (ponto de acesso) + ConfigTool servido pela placa + WebSocket com o mesmo
// protocolo NDJSON da serial (docs/04-protocolo-serial.md).
//
// Desligado por padrao a cada boot - so' liga pelo menu GLOBAL > WI-FI ou
// pelo comando set_wifi. O servidor roda na task do AsyncTCP (outro
// nucleo); comandos que chegam pelo WebSocket entram numa fila e so' sao
// executados no loop() principal, via wifiPortalPoll().
#pragma once
#include <Arduino.h>

bool wifiPortalStart();
void wifiPortalStop();
bool wifiPortalActive();

// Chama `handler` (no loop principal) pra cada linha recebida pelo WebSocket.
void wifiPortalPoll(void (*handler)(const String &line));

// Manda uma linha (sem '\n') pra todos os clientes do WebSocket.
void wifiPortalBroadcast(const String &line);

const char *wifiPortalSsid();
const char *wifiPortalPassword();
const char *wifiPortalHostname(); // "drumcore" -> drumcore.local
String wifiPortalIp();
int wifiPortalClientCount();
