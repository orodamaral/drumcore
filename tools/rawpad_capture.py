"""
Captura as batidas enviadas pelo firmware de teste `rawpad`
(firmware/src/test_rawpad.cpp) e salva cada uma num CSV separado.

Uso:
    python tools/rawpad_capture.py COM5
    python tools/rawpad_capture.py COM5 --label centro-forte

Durante a captura, digite um novo rotulo e Enter pra trocar (ex.: "aro",
"centro-fraco", "borda-da-pele"). Cada batida vai pra
captures/rawpad/<sessao>/<nnn>_<rotulo>.csv, com um resumo em summary.csv.
Tambem da pra mandar comandos pro firmware prefixando com "!":
    !t 80     muda o limiar de disparo
    !w 200    janela pos-disparo de 200 ms
Ctrl+C encerra.

Requer: pip install pyserial
"""

import argparse
import csv
import datetime as dt
import os
import sys
import threading

import serial

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def summarize(frames, pre, period_us, base):
    """Metricas rapidas por canal: pico, tempo ate o pico, onset e duracao."""
    out = {}
    for c in (0, 1):
        vals = [f[c] - base[c] for f in frames]
        peak = max(vals)
        ipk = vals.index(peak)
        thr = max(20, peak * 0.1)
        onset = next((i for i, v in enumerate(vals) if v > thr), None)
        # Ultimo frame acima de 10% do pico = fim da "cauda".
        last = max((i for i, v in enumerate(vals) if v > thr), default=None)
        to_ms = lambda i: None if i is None else round((i - pre) * period_us / 1000, 2)
        out[c] = {
            "peak": peak,
            "t_peak_ms": to_ms(ipk),
            "t_onset_ms": to_ms(onset),
            "t_tail_ms": to_ms(last),
        }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("port")
    ap.add_argument("--baud", type=int, default=921600)
    ap.add_argument("--label", default="sem-rotulo")
    ap.add_argument("--count", type=int, default=0, help="encerra depois de N batidas (0 = sem limite)")
    ap.add_argument("--session", help="nome da pasta de sessao (reusa uma existente pra juntar rodadas)")
    ap.add_argument("--threshold", type=int, help="limiar de disparo enviado ao firmware no inicio")
    args = ap.parse_args()

    session = args.session or dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    outdir = os.path.join(ROOT, "captures", "rawpad", session)
    os.makedirs(outdir, exist_ok=True)
    summary_path = os.path.join(outdir, "summary.csv")
    new_summary = not os.path.exists(summary_path)
    count = 0
    if not new_summary:
        with open(summary_path, newline="") as f:
            count = sum(1 for _ in f) - 1
    with open(summary_path, "a", newline="") as f:
        if new_summary:
            csv.writer(f).writerow(
            ["n", "label", "trig", "period_us",
             "peak0", "t_onset0_ms", "t_peak0_ms", "t_tail0_ms",
             "peak1", "t_onset1_ms", "t_peak1_ms", "t_tail1_ms", "file"])

    ser = serial.Serial(args.port, args.baud, timeout=1)
    if args.threshold:
        ser.write(f"t {args.threshold}\n".encode())
    state = {"label": args.label}

    def stdin_loop():
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            if line.startswith("!"):
                ser.write((line[1:] + "\n").encode())
            else:
                state["label"] = line.replace(" ", "-")
                print(f">> rotulo agora: {state['label']}")

    threading.Thread(target=stdin_loop, daemon=True).start()
    print(f"Salvando em {outdir}")
    print(f"Rotulo atual: {state['label']} (digite outro + Enter pra trocar, '!t 80' manda comando)")

    got = 0
    try:
        while True:
            line = ser.readline().decode(errors="replace").strip()
            if not line:
                continue
            if line.startswith("#") or line.startswith("NOISE"):
                print(line, flush=True)
                continue
            if not line.startswith("HIT"):
                continue

            hdr = dict(kv.split("=") for kv in line.split()[1:])
            pre = int(hdr["pre"])
            nframes = int(hdr["frames"])
            period = float(hdr["period_us"])
            base = (int(hdr["base0"]), int(hdr["base1"]))
            frames = []
            while True:
                l = ser.readline().decode(errors="replace").strip()
                if l == "END" or not l:
                    break
                a, b = l.split(",")
                frames.append((int(a), int(b)))
            if len(frames) != nframes:
                print(f"!! batida incompleta ({len(frames)}/{nframes} frames), descartada")
                continue

            count += 1
            label = state["label"]
            fname = f"{count:03d}_{label}.csv"
            with open(os.path.join(outdir, fname), "w", newline="") as f:
                w = csv.writer(f)
                w.writerow([f"# trig={hdr['trig']} period_us={period} pre={pre} base0={base[0]} base1={base[1]}"])
                w.writerow(["t_ms", "head", "rim"])
                for i, (a, b) in enumerate(frames):
                    w.writerow([round((i - pre) * period / 1000, 2), a, b])

            s = summarize(frames, pre, period, base)
            with open(summary_path, "a", newline="") as f:
                csv.writer(f).writerow(
                    [count, label, hdr["trig"], period,
                     s[0]["peak"], s[0]["t_onset_ms"], s[0]["t_peak_ms"], s[0]["t_tail_ms"],
                     s[1]["peak"], s[1]["t_onset_ms"], s[1]["t_peak_ms"], s[1]["t_tail_ms"], fname])
            ratio = s[1]["peak"] / s[0]["peak"] if s[0]["peak"] > 0 else float("inf")
            print(f"[{count:03d} {label}] head pico={s[0]['peak']:4d} @ {s[0]['t_peak_ms']}ms | "
                  f"rim pico={s[1]['peak']:4d} @ {s[1]['t_peak_ms']}ms | rim/head={ratio:.2f}", flush=True)
            got += 1
            if args.count and got >= args.count:
                break
    except KeyboardInterrupt:
        pass
    finally:
        print(f"{got} batidas nesta rodada, {count} no total em {outdir}", flush=True)
        ser.close()


if __name__ == "__main__":
    main()
