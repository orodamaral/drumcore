"""
Analisa capturas do `rawpad` (captures/rawpad/<sessao>/) de um pad dual
(c0 = tip/piezo central, c1 = ring/piezo da borda).

Por rótulo, mostra:
  - razão pico ring / pico tip nos 10 primeiros ms e na janela de 5-10 ms
    (separa aro x pele);
  - razão tardio/cedo do tip: pico em 3,5-9 ms / pico em 0-2,5 ms
    (separa borda da pele x centro);
e simula a classificação de 3 zonas (centro / pele-borda / aro) lendo cada
canal só a cada N ms, como o firmware faz varrendo o MUX.

Uso:
    python tools/rawpad_analyze.py sessao3
    python tools/rawpad_analyze.py sessao2 sessao3 --rim 0.30 --edge 0.80
"""

import argparse
import glob
import os
import random
import re
import statistics as st

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "captures", "rawpad")


def load(session):
    hits = []
    for f in sorted(glob.glob(os.path.join(ROOT, session, "[0-9]*.csv"))):
        label = re.sub(r"^\d+_", "", os.path.basename(f))[:-4]
        rows = []
        with open(f) as fh:
            for line in fh:
                if line.startswith("#") or line.startswith("t_ms"):
                    continue
                t, h, r = line.strip().split(",")
                rows.append((float(t), int(h), int(r)))
        hits.append((label, rows))
    return hits


def sample(rows, t0, t1, step=None, phase=0.0):
    sel = [x for x in rows if t0 <= x[0] <= t1]
    if step:
        sel = [x for x in sel if ((x[0] - t0 - phase) % step) < 0.21]
    return sel


def rim_ratio(sel):
    h = max((x[1] for x in sel), default=0)
    r = max((x[2] for x in sel), default=0)
    return r / h if h > 0 else None


def late_early(sel):
    e = max((x[1] for x in sel if x[0] <= 2.5), default=0)
    l = max((x[1] for x in sel if 3.5 <= x[0] <= 9), default=0)
    return l / e if e > 0 else None


def classify(rows, rim_thr, edge_thr, step=None, phase=0.0):
    sel = sample(rows, 0, 10, step, phase)
    if not sel:
        return None
    rr = rim_ratio(sel)
    if rr is None or rr >= rim_thr:
        return "aro"
    le = late_early(sel)
    if edge_thr > 0 and le is not None and le >= edge_thr:
        return "pele-borda"
    return "centro"


def truth(label):
    return "centro" if label.startswith("centro") else label


def fmt(xs):
    xs = [x for x in xs if x is not None]
    if not xs:
        return "       -"
    return f"{min(xs):5.2f}..{max(xs):5.2f} (med {st.median(xs):.2f})"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sessions", nargs="+")
    ap.add_argument("--rim", type=float, default=0.30, help="limiar da razão ring/tip pro aro")
    ap.add_argument("--edge", type=float, default=0.80, help="limiar da razão tardio/cedo pra borda da pele (0 = desliga)")
    args = ap.parse_args()

    for session in args.sessions:
        hits = load(session)
        labels = list(dict.fromkeys(l for l, _ in hits))
        print(f"\n=== {session} ({len(hits)} batidas) ===")
        print(f"{'rotulo':14} {'n':>2}  {'ring/tip 0-10ms':>28}  {'ring/tip 5-10ms':>28}  {'tip tardio/cedo':>28}")
        for l in labels:
            rows_l = [rows for lab, rows in hits if lab == l]
            print(f"{l:14} {len(rows_l):2}  {fmt([rim_ratio(sample(r, 0, 10)) for r in rows_l]):>28}"
                  f"  {fmt([rim_ratio(sample(r, 5, 10)) for r in rows_l]):>28}"
                  f"  {fmt([late_early(sample(r, 0, 10)) for r in rows_l]):>28}")

        print(f"\nClassificação 3 zonas (aro: ring/tip >= {args.rim}; borda: tardio/cedo >= {args.edge}):")
        random.seed(2)
        for step in (None, 0.5, 1.0, 2.0, 3.0):
            ok = tot = 0
            per = {}
            for lab, rows in hits:
                if lab == "rimshot":
                    continue
                for _ in range(1 if step is None else 200):
                    c = classify(rows, args.rim, args.edge, step, random.uniform(0, step) if step else 0.0)
                    good = c == truth(lab)
                    ok += good
                    tot += 1
                    a, b = per.get(lab, (0, 0))
                    per[lab] = (a + good, b + 1)
            name = "contínua" if step is None else f"a cada {step} ms"
            detail = "  ".join(f"{k} {a / b * 100:.0f}%" for k, (a, b) in per.items())
            print(f"  leitura {name:13}: {ok / tot * 100:5.1f}%   {detail}")


if __name__ == "__main__":
    main()
