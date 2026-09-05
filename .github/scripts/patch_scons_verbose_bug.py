#!/usr/bin/env python3
"""
Corrige um bug real do SCons (visto em upstream 4.11.1, instalado pela CI
como tool-scons ~4.41101.0) que faz o modo verbose do PlatformIO
(`pio run -v`) quebrar com:

    TypeError: unsupported operand type(s) for +: '_Null' and 'str'

em SCons/Action.py, funcao print_cmd_line:
    sys.stdout.write(s + "\n")

`s` as vezes chega como o sentinela interno `_Null` do SCons em vez de
uma string (quando uma variavel de ambiente usada na acao de build - aqui,
os placeholders de flash_mode/flash_freq usados na conversao elf2image -
nao resolve por algum motivo). O fix e' so' coagir pra string antes de
escrever, igual ao que versoes mais novas/antigas do SCons ja fazem em
outros pontos do mesmo arquivo.

So' precisamos do modo verbose pra CI conseguir descobrir os parametros
reais de flash (ver firmware-release.yml) - sem esse patch, a CI nao
consegue rodar `pio run -t upload -v` nenhuma vez com essa combinacao de
plataforma/SCons.

Idempotente e seguro: so mexe se encontrar a linha exata esperada: no
primeiro uso (script roda de novo em runs futuros) e' um no-op silencioso
se o arquivo ja estiver corrigido, e falha alto e claro se a linha nao for
encontrada em NENHUMA forma (nem original nem ja corrigida) - sinal de que
a versao do SCons mudou de novo e o patch precisa ser revisto.

Uso: python3 patch_scons_verbose_bug.py
(acha o arquivo sozinho procurando em ~/.platformio/packages/tool-scons/)
"""

import glob
import os
import sys

ORIGINAL = 'sys.stdout.write(s + "\\n")'
PATCHED = 'sys.stdout.write(str(s) + "\\n")'


def main() -> int:
    home = os.path.expanduser("~")
    candidates = glob.glob(
        os.path.join(home, ".platformio", "packages", "tool-scons", "*", "SCons", "Action.py")
    )
    if not candidates:
        print(
            "ERRO: nao encontrei nenhum SCons/Action.py em "
            "~/.platformio/packages/tool-scons/*/SCons/Action.py - o "
            "PlatformIO ainda nao instalou o tool-scons? Rodar um `pio run` "
            "antes deste script.",
            file=sys.stderr,
        )
        return 1

    patched_any = False
    for path in candidates:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()

        if PATCHED in content:
            print(f"OK (ja corrigido): {path}")
            patched_any = True
            continue

        if ORIGINAL not in content:
            print(
                f"AVISO: {path} nao tem nem a linha original nem a corrigida - "
                "o SCons pode ter mudado de novo, revisar este patch.",
                file=sys.stderr,
            )
            continue

        content = content.replace(ORIGINAL, PATCHED)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Corrigido: {path}")
        patched_any = True

    return 0 if patched_any else 1


if __name__ == "__main__":
    raise SystemExit(main())
