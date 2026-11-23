#!/usr/bin/env python3
"""Generate the v2.4 figures from the archived experiment JSON."""
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PAPER = os.path.dirname(os.path.dirname(HERE))          # .../dsh-oswyn/paper
DATA = os.path.join(PAPER, "data", "v24")
FIGS = os.path.join(PAPER, "figures")
os.makedirs(FIGS, exist_ok=True)

plt.rcParams.update({
    "font.size": 10,
    "axes.grid": True,
    "grid.alpha": 0.25,
    "figure.dpi": 150,
    "savefig.bbox": "tight",
})


def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return json.load(f)


# ── Fig 1: real cache survival curve vs the TTL assumption ──────────────────
def fig_survival():
    a = load("expA-billing-cache-survival.json")
    buckets = [b for b in a["idleGapSurvival"] if b["n"] > 0]

    def human(sec):
        if sec is None:
            return "+"
        if sec < 60:
            return f"{int(sec)}s"
        if sec < 3600:
            return f"{int(sec/60)}m"
        if sec < 86400:
            return f"{int(sec/3600)}h"
        return f"{int(sec/86400)}d"

    labels, hits, misses, ns = [], [], [], []
    for b in buckets:
        hi = b["hi"] if b["hi"] is not None else 86400 * 2
        lo = b["lo"]
        labels.append(f"{human(lo)}-{human(hi) if b['hi'] is not None else 'end'}")
        hits.append(b["meanHit"])
        misses.append(b["fullMissRate"])
        ns.append(b["n"])

    fig, ax1 = plt.subplots(figsize=(9.2, 4.4))
    x = np.arange(len(labels))
    ax1.plot(x, hits, "o-", color="#1f77b4", lw=1.8, label="mean cache-hit ratio")
    ax1.set_ylabel("Mean cache-hit ratio", color="#1f77b4")
    ax1.tick_params(axis="y", labelcolor="#1f77b4")
    ax1.set_ylim(0, 1.08)
    ax1.set_xticks(x)
    ax1.set_xticklabels(labels, rotation=40, ha="right", fontsize=8.5)

    ax2 = ax1.twinx()
    ax2.bar(x, misses, alpha=0.22, color="#d62728", label="full-miss rate")
    ax2.set_ylabel("Full-miss rate", color="#d62728")
    ax2.tick_params(axis="y", labelcolor="#d62728")
    ax2.set_ylim(0, 1.08)
    ax2.grid(False)

    for xi, n in zip(x, ns):
        ax2.text(xi, 0.02, f"n={n}", ha="center", va="bottom", fontsize=7, color="#7a1c1c")

    ax1.set_xlabel("Idle gap since the previous call (real production ledger)")
    ax1.set_title(
        f"Real KV-cache survival: {a['calls']:,} calls across {a['sessions']} sessions, "
        f"{a['tokens']['cacheHitRatioByTokens']*100:.1f}% of prompt tokens served from cache",
        fontsize=9.5,
    )
    fig.savefig(os.path.join(FIGS, "fig-v24-cache-survival.svg"))
    fig.savefig(os.path.join(FIGS, "fig-v24-cache-survival.png"))
    plt.close(fig)

# ── Fig 2: parameter sweeps (cost / attention / disruption) ─────────────────
def fig_sweeps():
    e = load("expE-param-sweep.json")
    rows = e["rows"]
    origin = next(r for r in rows if r["cfg"]["policy"] == "none")

    def series(policy, key):
        sel = [r for r in rows if r["cfg"]["policy"] == policy]
        xs, usd, surf, res = [], [], [], []
        for r in sel:
            xs.append(r["cfg"][key])
            usd.append(r["usd"])
            surf.append(r["meanSurfaceMTok"])
            res.append(r["resetsPer100Turns"])
        order = np.argsort(xs)
        return (np.array(xs)[order], np.array(usd)[order],
                np.array(surf)[order], np.array(res)[order])

    fig, axes = plt.subplots(2, 3, figsize=(12.6, 6.6))
    specs = (("volume", "V", "#2ca02c", "o", "volume threshold V (removable tokens)"),
             ("rounds", "R", "#ff7f0e", "s", "round threshold R (undistilled rounds)"))

    for row, (policy, key, color, marker, xlabel) in enumerate(specs):
        xs, usd, surf, res = series(policy, key)
        panels = (
            (usd, "(a) Cost: total uncached prefill", "USD", origin["usd"]),
            (surf, "(b) Attention burden: mean surface per call", "MTok", origin["meanSurfaceMTok"]),
            (res, "(c) Disruption: prefix resets", "resets / 100 turns", 0.0),
        )
        for col, (vals, title, ylab, baseline) in enumerate(panels):
            ax = axes[row][col]
            ax.plot(xs, vals, marker + "-", color=color)
            ax.axhline(baseline, ls="--", color="grey", lw=1,
                       label="Origin Replay" if col < 2 else "no reset")
            if col == 0:
                ax.set_title(f"{policy.upper()} sweep", fontsize=10)
                ax.set_ylabel(ylab)
            else:
                ax.set_title(title, fontsize=9)
                ax.set_ylabel(ylab)
            ax.set_xlabel(xlabel, fontsize=8.5)
            ax.set_xscale("log")
            ax.legend(fontsize=7.5)

    fig.suptitle(
        "v2.4 trigger sweeps on 293 real session trajectories:\n"
        "cost saturates near -55% for every sticky threshold, so the threshold must be"
        " chosen on attention burden and disruption, not on cost",
        fontsize=10)
    fig.tight_layout(rect=(0, 0, 1, 0.94))
    fig.savefig(os.path.join(FIGS, "fig-v24-trigger-sweeps.svg"))
    fig.savefig(os.path.join(FIGS, "fig-v24-trigger-sweeps.png"))
    plt.close(fig)


# ── Fig 3: ablation waterfall ───────────────────────────────────────────────
def fig_ablation():
    g = load("expG-ablation.json")
    rows = g["rows"]
    origin = g["origin"]
    pick = ["origin", "v2.3 ttl24h", "v2.3 ttl5m", "volume V=16000",
            "rounds R=5", "hybrid REC", "hybrid no-coalesce"]
    sel = [r for name in pick for r in rows if r["label"] == name]

    labels = [r["label"] for r in sel]
    usd = [r["usd"] for r in sel]
    surf = [r["meanSurfaceMTok"] for r in sel]
    j = [r["score"] for r in sel]

    fig, axes = plt.subplots(1, 3, figsize=(13.2, 4.0))
    colors = ["#7f7f7f", "#bcbd22", "#bcbd22", "#2ca02c", "#ff7f0e", "#1f77b4", "#d62728"]

    for ax, vals, title, fmt in zip(
        axes,
        [usd, surf, j],
        ["(a) Total uncached-prefill cost (USD)",
         "(b) Mean surface carried per call (MTok)",
         "(c) Composite objective J (lower is better)"],
        ["{:.0f}", "{:.3f}", "{:.3f}"],
    ):
        bars = ax.bar(range(len(vals)), vals, color=colors)
        ax.set_xticks(range(len(vals)))
        ax.set_xticklabels(labels, rotation=40, ha="right", fontsize=8)
        ax.set_title(title, fontsize=9.5)
        for b, v in zip(bars, vals):
            ax.text(b.get_x() + b.get_width() / 2, v, fmt.format(v),
                    ha="center", va="bottom", fontsize=7)
        ax.grid(axis="x", visible=False)

    fig.suptitle("Signal ablation on 293 real session trajectories", fontsize=10.5)
    fig.savefig(os.path.join(FIGS, "fig-v24-ablation.svg"))
    fig.savefig(os.path.join(FIGS, "fig-v24-ablation.png"))
    plt.close(fig)


# ── Fig 4: real session surface trajectories ────────────────────────────────
def fig_trajectories():
    b = load("expB-transcript-curves.json")
    curves = sorted(b["curves"], key=lambda c: -c["turns"])[:6]

    fig, ax = plt.subplots(figsize=(8.4, 4.2))
    for c in curves:
        turns = [p["turn"] for p in c["points"]]
        raw = [p["rawTokens"] / 1e3 for p in c["points"]]
        dist = [(p["distHistTokens"] + p["turnTokens"]) / 1e3 for p in c["points"]]
        ax.plot(turns, raw, "-", lw=1.2, alpha=0.85)
        ax.plot(turns, dist, "--", lw=1.0, alpha=0.7)

    ax.set_yscale("log")
    ax.set_xlabel("turn index")
    ax.set_ylabel("surface tokens (thousands, log)")
    ax.set_title("Six deepest real sessions: raw surface (solid) vs distilled surface (dashed)",
                 fontsize=9.5)
    ax.plot([], [], "-", color="grey", label="raw (Origin Replay)")
    ax.plot([], [], "--", color="grey", label="distilled")
    ax.legend(fontsize=8)
    fig.savefig(os.path.join(FIGS, "fig-v24-trajectories.svg"))
    fig.savefig(os.path.join(FIGS, "fig-v24-trajectories.png"))
    plt.close(fig)


if __name__ == "__main__":
    fig_survival()
    fig_sweeps()
    fig_ablation()
    fig_trajectories()
    print("figures written to", FIGS)