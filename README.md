# DRUMCORE — Módulo MIDI-USB/BLE para Bateria Eletrônica (ESP32-S3)

Módulo de disparo MIDI para bateria eletrônica, baseado em ESP32-S3, com suporte a
32 canais analógicos (via 2x multiplexador CD4067, uma "jackboard" de 16 canais
cada — ver [hardware/jackboard/](hardware/jackboard/)), tela TFT ST7735 (SPI) e
1 encoder rotativo com chave para navegação, e uma interface desktop (Electron +
React) para configuração do módulo.

Projeto construído sobre a biblioteca [HelloDrum-arduino-Library](https://github.com/RyoKosaka/HelloDrum-arduino-Library)
de Ryo Kosaka (vendorizada e adaptada em [firmware/lib/HelloDrum-arduino-Library](firmware/lib/HelloDrum-arduino-Library)).

## Estrutura do projeto

```
DrumCore/
├── docs/                 Documentação do projeto (decisões, hardware, progresso)
├── design/               Especificação de UI, identidade visual (logo, paleta)
├── firmware/             Firmware ESP32-S3 (PlatformIO)
│   ├── platformio.ini
│   ├── src/              Código-fonte do módulo
│   ├── include/
│   └── lib/
│       └── HelloDrum-arduino-Library/   Biblioteca base, vendorizada e modificada
├── hardware/             Projetos KiCad (jackboard — placa de conectores TRS + rede de proteção)
├── desktop-app/          Interface desktop de configuração do módulo (Electron + React/TS)
└── site/                 Site estático de apresentação do projeto (GitHub Pages)
```

## Documentação

Todo o histórico de decisões, aprendizados sobre a biblioteca base e notas de
hardware está em [docs/](docs/). Comece por [docs/00-visao-geral.md](docs/00-visao-geral.md).

## Status

Veja [docs/CHANGELOG.md](docs/CHANGELOG.md) para o histórico completo do que já
foi feito.
