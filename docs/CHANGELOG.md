# Changelog

Registro cronológico do que foi feito no projeto (mais recente no topo).

## 2026-08-20 (2)

- Implementada a **Fase A**: firmware básico (`firmware/src/main.cpp`) que
  instancia 4x `HelloDrumMUX_4051` + 32x `HelloDrum` e reporta hits via Serial
  (sensibilidade/threshold padrão da lib, sem MIDI/OLED/botões ainda).
- Definido pinout proposto para o ESP32-S3 (S0/S1/S2 compartilhados + 4 pinos
  ADC1 dedicados, evitando strapping pins e os pinos do USB nativo). Ver
  [02-hardware.md](02-hardware.md).
- **Bug encontrado e corrigido na lib vendorizada**: `padType[16]` e
  `showInstrument[]` (16 entradas) são indexados por `padNum`/`nameIndex`, que
  vão até 31 com 32 pads — causaria overflow de memória a partir do pad 17.
  Ambos ampliados para 32. Detalhes em
  [03-biblioteca-hellodrum.md](03-biblioteca-hellodrum.md).
- PlatformIO CLI instalado (`pip install --user platformio`) e build validado:
  compila com sucesso para `esp32-s3-devkitc-1` (RAM 7.0%, Flash 8.7%). Ainda
  **não testado em hardware real** — o hardware com os 4x CD4051 ainda não foi
  montado, então a lógica de sensing em si não foi validada com sinais reais,
  só a compilação/estrutura do código.

## 2026-08-20

- Estruturação inicial do projeto: repositório Git criado, pastas `docs/`,
  `firmware/` (PlatformIO) e `desktop-app/` criadas.
- Biblioteca [HelloDrum-arduino-Library](https://github.com/RyoKosaka/HelloDrum-arduino-Library)
  (v0.7.7) clonada e vendorizada em `firmware/lib/HelloDrum-arduino-Library`.
- Análise inicial do código-fonte da lib: confirmado suporte nativo a até 8x
  CD4051 (64 canais) via `rawValue[64]` + `muxNum` sequencial — 4x CD4051 (32
  canais) não exige modificação na lib, apenas cálculo manual do índice do pad
  (`muxNum * 8 + canal_local`).
- Decisões tomadas: placa ESP32-S3, toolchain PlatformIO, lib base vendorizada
  (fork local, não dependência externa). Detalhes em
  [01-decisoes-arquiteturais.md](01-decisoes-arquiteturais.md).
- Identificada lacuna: a lib não tem exemplo de USB-MIDI nativo para ESP32 (só
  BLE-MIDI ou MIDI serial) — vai precisar de integração própria com a stack USB
  (TinyUSB) do core arduino-esp32. Ver
  [03-biblioteca-hellodrum.md](03-biblioteca-hellodrum.md).
- Nota de ambiente: PlatformIO CLI ainda não instalado na máquina de dev.
