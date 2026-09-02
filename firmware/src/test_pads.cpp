/*
  Teste de regressao do array HelloDrum pads[32] (2026-08-31) - versao SEM
  Serial.flush() apos cada print, testando a hipotese de que os flushes
  (nao o valor dos pinos) estavam fazendo o watchdog de tarefa (5s,
  CONFIG_ESP_TASK_WDT_TIMEOUT_S) disparar por falta de yield.
*/

#include <Arduino.h>
#include <hellodrum.h>

#define NUM_PADS 32

HelloDrum pads[NUM_PADS];

void setup()
{
    Serial.begin(115200);
    delay(200);
    Serial.println("DEBUG: entrou no setup() (test_pads, sem flush)");

    for (byte i = 0; i < NUM_PADS; i++)
    {
        if (i < NUM_PADS - 1)
            pads[i].begin(i, i + 1);
        else
            pads[i].begin(i);
    }

    Serial.println("DEBUG: pads[32].begin() ok - sem watchdog reset");
}

void loop()
{
    Serial.println("test_pads vivo");
    delay(1000);
}
