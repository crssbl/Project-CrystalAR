#!/usr/bin/env python3
"""Report-only plausibility checks for the gallery crystals (never filters anything).

(a) geometry: any interatomic distance below 0.7 × the sum of covalent radii, isolated atoms,
    or an abnormal density;
(b) relaxation: the space group changes after the stored MLIP relaxation, or RMSD > 0.5 Å;
(e) composition: noble-gas or radioactive elements (Tc, Pm, actinides, ...).

Reads the exported traces and the stored relaxation endpoints of the S.S.U.N. assessment
(no MLIP or relaxation is run). Writes a Markdown report to --out (an unpublished location).
    python tools/check_crystals.py --out <report.md> [--assessment-dir <dir>]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
TRACE_DIR = REPO / "data" / "crystals"
MLIPS = ("orb", "mace", "uma")
NOBLE = {"He", "Ne", "Ar", "Kr", "Xe", "Rn", "Og"}
RADIOACTIVE = {"Tc", "Pm", "Po", "At", "Rn", "Fr", "Ra"} | {
    "Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr"}
SHORT_FACTOR = 0.7       # (a) d < 0.7 (r_i + r_j)
ISOLATED_FACTOR = 1.5    # (a) nearest neighbour farther than 1.5 (r_i + r_j)
DENSITY_RANGE = (1.5, 14.0)  # (a) g/cm³, outside → flag
VOLUME_CHANGE = 10.0     # (a) |ΔV| on relaxation above 10 % → density flag
RMSD_LIMIT = 0.5         # (b) Å


def structure_of(trace):
    from pymatgen.core import Lattice, Structure
    return Structure(Lattice(trace["lattice"]["matrix"]), [a["element"] for a in trace["atoms"]],
                     [a["frac"] for a in trace["atoms"]])


def geometry_check(structure):
    from pymatgen.analysis.molecule_structure_comparator import CovalentRadius
    radii = np.array([CovalentRadius.radius[s.specie.symbol] for s in structure])
    centres, neighbours, _, distances = structure.get_neighbor_list(8.0)
    ratio = distances / (radii[centres] + radii[neighbours])
    worst = int(np.argmin(ratio))
    nearest = np.full(len(structure), np.inf)
    for c, r in zip(centres, ratio):
        nearest[c] = min(nearest[c], r)
    iso = int(np.argmax(nearest))
    return {
        "min_ratio": float(ratio[worst]), "min_distance": float(distances[worst]),
        "min_pair": f"{structure[int(centres[worst])].specie.symbol}–{structure[int(neighbours[worst])].specie.symbol}",
        "max_nn_ratio": float(nearest[iso]), "loneliest": structure[iso].specie.symbol,
        "density": float(structure.density), "volume_per_atom": float(structure.volume / len(structure)),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", required=True)
    parser.add_argument("--assessment-dir")
    parser.add_argument("--config", default=str(REPO / "tools" / "local_config.json"))
    args = parser.parse_args(argv)
    assessment_dir = args.assessment_dir or json.loads(Path(args.config).read_text()).get("assessment_dir")
    if not assessment_dir:
        sys.exit("pass --assessment-dir or set it in tools/local_config.json")
    audit = {r["sample_id"]: r for r in json.loads((Path(assessment_dir) / "local_audit.json").read_text())["records"]}
    index = json.loads((TRACE_DIR / "index.json").read_text())["crystals"]
    rows, details = [], []
    flagged = {"a": [], "b": [], "e": []}
    for entry in index:
        trace = json.loads((REPO / entry["trace"]).read_text())
        s = structure_of(trace)
        sg = trace["spaceGroup"]["number"]
        g = geometry_check(s)
        rec = audit[trace["id"]]
        relax = {}
        for m in MLIPS:
            model = rec["models"][m]
            geo = model["relaxed_geometry"]["spacegroup_by_symprec_A"]
            relax[m] = {"sg001": geo["0.01"]["number"], "sg01": geo["0.1"]["number"], "rmsd": model["relaxation_rmsd_A"],
                        "dv": model["volume_change_percent"], "status": model["status"]}
        a_hits = []
        if g["min_ratio"] < SHORT_FACTOR:
            a_hits.append(f"short contact {g['min_pair']} {g['min_distance']:.2f} Å = {g['min_ratio']:.2f}×(r+r)")
        if g["max_nn_ratio"] > ISOLATED_FACTOR:
            a_hits.append(f"isolated {g['loneliest']}: nearest neighbour at {g['max_nn_ratio']:.2f}×(r+r)")
        if not DENSITY_RANGE[0] <= g["density"] <= DENSITY_RANGE[1]:
            a_hits.append(f"density {g['density']:.2f} g/cm³ outside {DENSITY_RANGE}")
        big_dv = [f"{m} {relax[m]['dv']:+.1f}%" for m in MLIPS if abs(relax[m]["dv"]) > VOLUME_CHANGE]
        if big_dv:
            a_hits.append("volume changes on relaxation: " + ", ".join(big_dv))
        b_hits = []
        for m in MLIPS:
            r = relax[m]
            if r["sg001"] != sg or r["sg01"] != sg:
                b_hits.append(f"{m}: #{sg} → #{r['sg001']} (symprec 0.01 Å), #{r['sg01']} (0.1 Å)")
            if r["rmsd"] > RMSD_LIMIT:
                b_hits.append(f"{m}: RMSD {r['rmsd']:.3f} Å > {RMSD_LIMIT} Å")
        elements = sorted({a["element"] for a in trace["atoms"]})
        e_hits = [el for el in elements if el in NOBLE | RADIOACTIVE]
        for key, hits in (("a", a_hits), ("b", b_hits), ("e", e_hits)):
            if hits:
                flagged[key].append(trace["id"])
        flag = lambda hits: "⚠ " + "; ".join(hits) if hits else "ok"
        rmsd = " / ".join("%.3f" % relax[m]["rmsd"] for m in MLIPS)
        sg001 = " / ".join(str(relax[m]["sg001"]) for m in MLIPS)
        sg01 = " / ".join(str(relax[m]["sg01"]) for m in MLIPS)
        marks = ("a" if a_hits else "") + ("b" if b_hits else "") + ("e" if e_hits else "")
        rows.append(f"| {trace['id']} | {trace['formula']} | #{sg} | {g['min_ratio']:.2f} ({g['min_pair']}) | "
                    f"{g['max_nn_ratio']:.2f} | {g['density']:.2f} | {rmsd} | {sg001} | {sg01} | {marks or '—'} |")
        details.append(f"- **{trace['id']} {trace['formula']}** — (a) {flag(a_hits)}; (b) {flag(b_hits)}; (e) {flag(e_hits) if e_hits else 'ok'}")
    lines = [
        "# 13 颗 S.S.U.N. 晶体的检查报告（仅提示，不删除任何晶体，不发布）",
        "",
        "由 `tools/check_crystals.py` 生成。输入：导出的生成结构（data/crystals/*.json）和 S.S.U.N. 评估中存档的 MLIP 弛豫终点（local_audit.json）。没有运行任何模型、MLIP 或弛豫。",
        "",
        "判据：",
        f"- (a) 原子间距 < {SHORT_FACTOR}×两原子共价半径之和（pymatgen/Cordero 共价半径）；孤立原子 = 最近邻 > {ISOLATED_FACTOR}×(r_i+r_j)；"
        f"密度不在 {DENSITY_RANGE[0]}–{DENSITY_RANGE[1]} g/cm³，或任一 MLIP 弛豫体积变化 > {VOLUME_CHANGE:.0f}%。",
        f"- (b) 弛豫后空间群（symprec 0.01 Å 与 0.1 Å 两档）与生成时不同，或弛豫 RMSD > {RMSD_LIMIT} Å（Orb / MACE / UMA 各自的存档终点）。",
        "- (e) 含稀有气体或放射性元素（Tc、Pm、Po、At、Rn、Fr、Ra、锕系）。",
        "",
        "## 汇总",
        "",
        f"- (a) 提示 {len(flagged['a'])} 颗：{', '.join(flagged['a']) or '无'}",
        f"- (b) 提示 {len(flagged['b'])} 颗：{', '.join(flagged['b']) or '无'}",
        f"- (e) 提示 {len(flagged['e'])} 颗：{', '.join(flagged['e']) or '无'}",
        "",
        "## 数值",
        "",
        "| 样本 | 化学式 | SG | 最小 d/(r+r) | 最大最近邻比 | 密度 g/cm³ | RMSD Å (Orb/MACE/UMA) | 弛豫 SG @0.01 | 弛豫 SG @0.1 | 提示 |",
        "|---|---|---|---|---|---|---|---|---|---|",
        *rows,
        "",
        "## 逐颗说明",
        "",
        *details,
        "",
    ]
    Path(args.out).write_text("\n".join(lines))
    print(f"wrote {args.out}: a={flagged['a']} b={flagged['b']} e={flagged['e']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
