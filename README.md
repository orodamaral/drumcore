# DRUMCORE — Módulo MIDI-USB para Bateria Eletrônica (ESP32-S3)

Módulo de disparo MIDI para bateria eletrônica, baseado em ESP32-S3, com suporte a
32 entradas analógicas (via 4x multiplexador CD4051), tela OLED e botões de
configuração, e uma interface desktop para configuração do módulo.

Projeto construído sobre a biblioteca [HelloDrum-arduino-Library](https://github.com/RyoKosaka/HelloDrum-arduino-Library)
de Ryo Kosaka (vendorizada e adaptada em [firmware/lib/HelloDrum-arduino-Library](firmware/lib/HelloDrum-arduino-Library)).

## Estrutura do projeto

```
DrumCore/
├── docs/                 Documentação do projeto (decisões, hardware, progresso)
├── firmware/             Firmware ESP32-S3 (PlatformIO)
│   ├── platformio.ini
│   ├── src/              Código-fonte do módulo
│   ├── include/
│   └── lib/
│       └── HelloDrum-arduino-Library/   Biblioteca base, vendorizada e modificada
└── desktop-app/          Interface desktop de configuração do módulo (stack a definir)
```

## Documentação

Todo o histórico de decisões, aprendizados sobre a biblioteca base e notas de
hardware está em [docs/](docs/). Comece por [docs/00-visao-geral.md](docs/00-visao-geral.md).

## Status

Projeto em fase inicial de estruturação. Veja [docs/CHANGELOG.md](docs/CHANGELOG.md).
