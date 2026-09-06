# DRUMCORE — Módulo MIDI-USB/BLE para Bateria Eletrônica (ESP32-S3)

Módulo de disparo MIDI para bateria eletrônica, baseado em ESP32-S3, com suporte a
32 canais analógicos (via 2x multiplexador CD4067, uma "jackboard" de 16 canais
cada — ver [hardware/jackboard/](hardware/jackboard/)), tela TFT ST7735 (SPI) e
1 encoder rotativo com chave para navegação, e um app de configuração em React,
direto pelo navegador via Web Serial — sem instalar nada.

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
├── web-app/              App de configuração do módulo (React/TS), direto no navegador via
│                         Web Serial, sem instalar nada
└── site/                 Site estático de apresentação do projeto (GitHub Pages) — publica
                          o web-app/ em site/app/, ver .github/workflows/pages.yml
```

## Documentação

Todo o histórico de decisões, aprendizados sobre a biblioteca base e notas de
hardware está em [docs/](docs/). Comece por [docs/00-visao-geral.md](docs/00-visao-geral.md).

## Status

Veja [docs/CHANGELOG.md](docs/CHANGELOG.md) para o histórico completo do que já
foi feito.
