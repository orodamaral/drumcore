# Injeta a versao do firmware via build_flags, lendo a env var FW_VERSION
# (setada pelo workflow de release a partir da tag git, ex: "fw-v1.2.0").
# Fora da CI (build local), usa "dev" como fallback - mesmo default do
# guard "#ifndef FW_VERSION" em main.cpp, so' que esse aqui e' o caminho
# normal (roda sempre); o guard em main.cpp e' so' seguranca extra.
#
# So' o env principal (esp32-s3-devkitc-1) carrega este script
# (extra_scripts em platformio.ini) - os envs de teste isolado nao
# precisam de versao real.

Import("env")
import os

version = os.environ.get("FW_VERSION", "dev")
env.Append(BUILD_FLAGS=[f'-D FW_VERSION=\\"{version}\\"'])
