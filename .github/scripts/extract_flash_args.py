#!/usr/bin/env python3
"""
Extrai os parametros de flash reais que o PlatformIO usaria pra gravar o
firmware (via esptool.py write_flash), lendo o log verboso de
`pio run -t upload -v`. Usado pela CI de release do firmware pra montar o
comando `esptool.py merge_bin` sem hardcodar nada - se a partition table ou
o flash_mode/flash_freq mudar no futuro (ou se a suposicao "flash_mode=qio"
que um comentario do platformio.ini fazia estiver errada - CONFIRMADO
errado em 2026-09: o board base usa dio, nao qio, apesar do comentario),
isso se adapta sozinho em vez de gerar um binario mesclado com cabecalho
errado silenciosamente. Um flash_mode/flash_freq errado no binario mesclado
grava sem erro (esptool nao valida isso) mas pode nao bootar direito -
especialmente sensivel aqui por causa da PSRAM octal (qio_opi).

Nao tenta gravar de verdade: a porta passada pra `pio run -t upload` nao
existe de proposito (roda em CI, sem placa conectada) - o objetivo e' so'
capturar a linha de comando que o PlatformIO monta ANTES de tentar abrir a
porta serial. Se o log verboso nao trouxer essa linha (mudanca de
comportamento numa versao futura do PlatformIO), o script falha alto e
claro em vez de publicar um binario com parametros errados.

Uso: python3 extract_flash_args.py <caminho_do_log.txt>
Saida (stdout):
  flash_mode <valor>
  flash_freq <valor>
  flash_size <valor>
  <offset> <caminho_do_arquivo>   (uma linha por par, repetido)
"""

import re
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("uso: extract_flash_args.py <log.txt>", file=sys.stderr)
        return 2

    with open(sys.argv[1], "r", encoding="utf-8", errors="replace") as f:
        log = f.read()

    # Acha a linha de comando do esptool que contem "write_flash". PlatformIO
    # imprime isso como uma unica linha longa (as vezes com aspas ao redor de
    # cada argumento). Procuramos a partir do token "write_flash" em diante.
    match = re.search(r"write_flash.*", log)
    if not match:
        print(
            "ERRO: nao encontrei uma linha 'write_flash' no log verboso do "
            "'pio run -t upload -v'. O formato de log do PlatformIO pode ter "
            "mudado - ajustar este script antes de confiar no binario "
            "mesclado.",
            file=sys.stderr,
        )
        return 1

    tail = match.group(0)

    def find_flag(name: str) -> str:
        m = re.search(rf"--{name}\s+(\S+)", tail)
        if not m:
            print(
                f"ERRO: nao encontrei --{name} na linha write_flash:\n{tail}",
                file=sys.stderr,
            )
            raise SystemExit(1)
        return m.group(1)

    flash_mode = find_flag("flash_mode")
    flash_freq = find_flag("flash_freq")
    flash_size = find_flag("flash_size")

    # Pares "0xNNNN <arquivo>" - arquivo pode vir entre aspas ou nao. So'
    # depois de "write_flash" mesmo (a linha inteira que capturamos ja
    # comeca la), pra nao pegar offsets de outras flags por engano.
    pairs = re.findall(r"(0x[0-9A-Fa-f]+)\s+\"?([^\s\"]+\.bin)\"?", tail)
    if not pairs:
        print(
            "ERRO: encontrei a linha 'write_flash' mas nenhum par "
            "offset/arquivo .bin dentro dela:\n" + tail,
            file=sys.stderr,
        )
        return 1

    print(f"flash_mode {flash_mode}")
    print(f"flash_freq {flash_freq}")
    print(f"flash_size {flash_size}")
    for offset, path in pairs:
        print(f"{offset} {path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
