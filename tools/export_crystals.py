#!/usr/bin/env python3
"""Export CrystalAR generation traces for the project page.

For each sample id this reads the stored generation record of the final model (native
sampling with SGBS coordinate search), checks it against the evaluated raw structure, recovers
every site's free Wyckoff parameters from the stored level-9 cell centres, and writes

    data/crystals/<slug>.json   the trace used by the story engine and the gallery replay
    assets/cif/<slug>.cif       the generated structure as a P1 CIF

Nothing is re-generated: no model, MLIP or relaxation is run. Source paths come from CLI
arguments or tools/local_config.json (git-ignored), so no local path is committed.

Run it in a Python environment that can import pymatgen and the generator's Wyckoff tables:
    python tools/export_crystals.py --ids denovo:75 --print-regions
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
import sys
from fractions import Fraction
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
LEVELS = 9
GALLERY_IDS = [f"denovo:{i}" for i in (75, 2219, 1798, 1431, 2006, 53, 570, 766, 1559, 2435, 143, 1190, 2002)]
STORY_ID = "denovo:75"
PARAM_NAMES = ("x", "y", "z")
MLIP_KEYS = ("orb", "mace", "uma")
OCTREE = None  # the generator's octree decoder, imported with the Wyckoff tables when available

# Active lattice variables per crystal family, in the paper's (V, b/a, c/a, alpha, beta, gamma).
FAMILY_ACTIVE = {
    "triclinic": ("V", "b/a", "c/a", "alpha", "beta", "gamma"),
    "monoclinic": ("V", "b/a", "c/a", "beta"),
    "orthorhombic": ("V", "b/a", "c/a"),
    "tetragonal": ("V", "c/a"),
    "hexagonal": ("V", "c/a"),
    "cubic": ("V",),
}


def crystal_family(sg: int) -> str:
    if sg <= 2:
        return "triclinic"
    if sg <= 15:
        return "monoclinic"
    if sg <= 74:
        return "orthorhombic"
    if sg <= 142:
        return "tetragonal"
    if sg <= 194:
        return "hexagonal"
    return "cubic"


def slug(sample_id: str) -> str:
    return sample_id.replace(":", "-")


def snap(value: float, max_den: int = 24, tol: float = 1e-6) -> float:
    """Snap float32-rounded table entries such as 0.3333333432674408 back to 1/3."""
    frac = Fraction(float(value)).limit_denominator(max_den)
    return float(frac) if abs(float(frac) - float(value)) <= tol else float(value)


def snap_array(values) -> np.ndarray:
    arr = np.asarray(values, dtype=float)
    return np.array([snap(v) for v in arr.ravel()], dtype=float).reshape(arr.shape)


def frac_text(value: float) -> str:
    frac = Fraction(value).limit_denominator(24)
    if abs(float(frac) - value) > 1e-9:
        return f"{value:.4f}"
    return str(frac.numerator) if frac.denominator == 1 else f"{frac.numerator}/{frac.denominator}"


def form_text(B: np.ndarray, b: np.ndarray, names: tuple[str, ...]) -> str:
    """Human-readable Wyckoff representative, e.g. (x, 0, 1/4) or (x, 2x, z)."""
    parts = []
    for row in range(3):
        terms = []
        for col, name in enumerate(names):
            coef = B[row, col]
            if abs(coef) < 1e-9:
                continue
            mag = abs(coef)
            body = name if abs(mag - 1) < 1e-9 else f"{frac_text(mag)}{name}"
            terms.append(("-" if coef < 0 else "+", body))
        offset = b[row] % 1.0
        if abs(offset) > 1e-9 and abs(offset - 1) > 1e-9:
            terms.append(("+", frac_text(offset)))
        if not terms:
            parts.append("0")
            continue
        text = ("-" if terms[0][0] == "-" else "") + terms[0][1]
        for sign, body in terms[1:]:
            text += f" {sign} {body}"
        parts.append(text)
    return f"({', '.join(parts)})"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_config(args) -> dict:
    config = {}
    path = Path(args.config) if args.config else REPO / "tools" / "local_config.json"
    if path.exists():
        config.update(json.loads(path.read_text()))
    for key in ("artifacts_root", "attempts", "raw_structures", "assessment_dir", "generator_root", "provenance_manifest"):
        value = getattr(args, key)
        if value:
            config[key] = value
    missing = [k for k in ("attempts", "raw_structures", "assessment_dir", "generator_root", "provenance_manifest") if not config.get(k)]
    if missing:
        sys.exit(f"missing source paths: {', '.join(missing)} (pass them or create tools/local_config.json)")
    if Path(config["provenance_manifest"]).resolve().is_relative_to(REPO):
        sys.exit("provenance_manifest must be outside the published repository")
    return config


def import_generator_tables(generator_root: str):
    """The generator's own Wyckoff tables: (sg, site symmetry, coordinate form) -> affine form."""
    sys.dont_write_bytecode = True
    os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
    sys.path.insert(0, str(generator_root))
    from crystalformer.src.coord_minimal import form_from_tokens  # noqa: E402
    from crystalformer.src.wyckoff import sg_ss_enum_to_wyckoff  # noqa: E402
    global OCTREE
    try:
        from csp_grid_bench.octree import AffineManifold, GlobalOctreeCodec  # noqa: E402
        OCTREE = {"codec": GlobalOctreeCodec, "manifold": AffineManifold}
    except Exception as error:  # the cross-check is optional
        print(f"octree cross-check unavailable: {error}", file=sys.stderr)
    return form_from_tokens, sg_ss_enum_to_wyckoff


def read_jsonl_for(path: Path, ids: set[str]) -> dict[str, list]:
    found: dict[str, list] = {sid: [] for sid in ids}
    with open(path) as handle:
        for line_number, line in enumerate(handle):
            head = line[:200]
            if not any(f'"{sid}"' in head for sid in ids):
                continue
            record = json.loads(line)
            if record.get("sample_id") in found:
                found[record["sample_id"]].append((line_number, record))
    return found
def periodic_close(a, b, tol: float = 1e-6) -> bool:
    d = np.asarray(a, float) - np.asarray(b, float)
    d -= np.round(d)
    return bool(np.max(np.abs(d)) <= tol)


def same_atoms_exact(s1, s2, tol: float = 1e-6) -> bool:
    """Same lattice and the same atoms (order-free; CIF readers regroup sites by species)."""
    # A CIF stores cell parameters, not the matrix, so compare parameters (the reader may
    # orient the cell differently) and fractional coordinates (orientation-free).
    if len(s1) != len(s2) or not np.allclose(s1.lattice.parameters, s2.lattice.parameters, atol=1e-4):
        return False
    unmatched = list(range(len(s2)))
    for a in s1:
        hit = next((i for i in unmatched if s2[i].specie.symbol == a.specie.symbol
                    and periodic_close(a.frac_coords, s2[i].frac_coords, tol)), None)
        if hit is None:
            return False
        unmatched.remove(hit)
    return True


def choose_record(candidates, evaluated):
    """Pick the generation record whose structure is the evaluated raw structure."""
    from pymatgen.analysis.structure_matcher import StructureMatcher
    from pymatgen.core import Structure

    matcher = StructureMatcher(ltol=0.2, stol=0.3, angle_tol=5, primitive_cell=False, scale=False)
    for line_number, record in candidates:
        structure = Structure.from_dict(record["structure"])
        if same_atoms_exact(structure, evaluated) and matcher.fit(structure, evaluated):
            return line_number, record, structure
    raise ValueError("no generation record matches the evaluated raw structure")


def recover_sites(record, structure, form_from_tokens, wyckoff_names, lattice_matrix):
    """Rebuild each template site: its Wyckoff form, free parameters, orbit and atoms."""
    sg = int(record["template"]["space_group"])
    sites, problems, cursor = [], [], 0
    for src in record["template"]["template"]:
        form = form_from_tokens(sg, src["site_symmetry"], int(src["coordinate_form"]))
        mult = int(src["multiplicity"])
        block = list(range(cursor, cursor + mult))
        cursor += mult
        rep = np.asarray(structure[block[0]].frac_coords, float)
        B = snap_array(form.B).reshape(3, form.rank)
        b = snap_array(form.b)
        orbit = [snap_array(op).reshape(3, 4) for op in form.all_affines]
        names = tuple(PARAM_NAMES[i] for i in form.basis_cols)
        u, residual = form.encode(rep)
        u = [float(v) for v in np.asarray(u, float).reshape(-1)]
        index9, centres = [], []
        for value in u:
            k = value * 2 ** LEVELS - 0.5
            if abs(k - round(k)) > 1e-6:
                problems.append(f"site {src['order']}: u={value!r} is not a level-9 centre")
            index9.append(int(round(k)))
            centres.append((round(k) + 0.5) / 2 ** LEVELS)
        mapped = (B @ np.asarray(centres, float) + b) % 1.0 if form.rank else b % 1.0
        if residual > 1e-6 or not periodic_close(mapped, rep):
            problems.append(f"site {src['order']}: Wyckoff map of the level-9 centre != stored representative")
        expanded = []
        for op in orbit:
            p = (op[:, :3] @ rep + op[:, 3]) % 1.0
            if not any(periodic_close(p, q) for q in expanded):
                expanded.append(p)
        stored_block = [structure[i] for i in block]
        if len(expanded) != mult or any(s.specie.symbol != src["element"] for s in stored_block) or not all(
            any(periodic_close(p, s.frac_coords) for s in stored_block) for p in expanded
        ):
            problems.append(f"site {src['order']}: symmetry expansion does not reproduce the stored orbit")
        if form.rank != int(src["dof"]):
            problems.append(f"site {src['order']}: rank {form.rank} != dof {src['dof']}")
        if OCTREE is not None:
            # Cross-check with the generator's own decoder: the stored point must be the
            # representative of its level-9 leaf in the shared fractional octree.
            codec = OCTREE["codec"](LEVELS)
            leaf = codec.decode(OCTREE["manifold"].from_minimal_form(form), codec.encode(rep))
            if not periodic_close(leaf, rep):
                problems.append(f"site {src['order']}: not the generator's level-9 leaf representative")
        lengths = [float(np.linalg.norm(B[:, j] @ lattice_matrix)) for j in range(form.rank)]
        sites.append({
            "order": int(src["order"]),
            "element": src["element"],
            "wyckoff": wyckoff_names.get((sg, src["site_symmetry"], int(src["coordinate_form"])), ""),
            "siteSymmetry": src["site_symmetry"],
            "coordinateForm": int(src["coordinate_form"]),
            "multiplicity": mult,
            "dof": int(src["dof"]),
            "form": {"B": B.tolist(), "b": b.tolist(), "params": list(names), "text": form_text(B, b, names)},
            "u": centres,
            "index9": index9,
            "paramLengthsA": lengths,
            "representative": rep.tolist(),
            "orbit": [op.tolist() for op in orbit],
            "atoms": block,
        })
    if cursor != len(structure):
        problems.append("template multiplicities do not add up to the stored atom count")
    return sites, problems


def lattice_block(structure, sg: int) -> dict:
    lat = structure.lattice
    family = crystal_family(sg)
    values = {"V": lat.volume, "b/a": lat.b / lat.a, "c/a": lat.c / lat.a,
              "alpha": lat.alpha, "beta": lat.beta, "gamma": lat.gamma}
    units = {"V": "Å³", "alpha": "°", "beta": "°", "gamma": "°"}
    return {
        "matrix": lat.matrix.tolist(),
        "a": lat.a, "b": lat.b, "c": lat.c, "alpha": lat.alpha, "beta": lat.beta, "gamma": lat.gamma,
        "volume": lat.volume,
        "family": family,
        "active": [{"name": n, "value": values[n], "unit": units.get(n, "")} for n in FAMILY_ACTIVE[family]],
    }


def load_assessment(assessment_dir: Path) -> dict:
    data = json.loads((assessment_dir / "assessment.json").read_text())
    out = {r["sample_id"]: r for r in data["records"]}
    with open(assessment_dir / "candidate_screening.csv", newline="") as handle:
        for row in csv.DictReader(handle):
            rec = out[row["sample_id"]]
            for key, col in zip(MLIP_KEYS, ("Orb_raw_meV_atom", "MACE_raw_meV_atom", "UMA_raw_meV_atom")):
                if abs(float(row[col]) - rec["raw_E_hull_meV_atom"][key]) > 1e-3:
                    raise ValueError(f"{row['sample_id']}: CSV and JSON disagree on {key}")
    return out


def cif_text(structure, sample_id: str) -> str:
    from pymatgen.io.cif import CifWriter

    header = (
        f"# CrystalAR generated structure, sample {sample_id} (final model, de novo sampling).\n"
        "# Exactly as generated, before any relaxation. No DFT or experimental validation.\n"
    )
    return header + str(CifWriter(structure))


def relative_to(path: Path, base: str | None) -> str:
    if base:
        return os.path.relpath(Path(path).resolve(), Path(base).resolve())
    return Path(path).name


def relaxation_note(space_group: dict, models: dict) -> str | None:
    """Only one common new group across all three archived endpoints and both tolerances."""
    groups = [models.get(m, {}).get(tol) for m in MLIP_KEYS for tol in ("0.01", "0.1")]
    if any(not g for g in groups):
        return None
    numbers = {g["number"] for g in groups}
    if len(numbers) != 1 or space_group["number"] in numbers:
        return None
    sub = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")
    plain = lambda s: re.sub(r"_(\d)", lambda m: m[1].translate(sub), s)
    target = groups[0]
    return ("With each of the three MLIPs, relaxation raises the symmetry of this structure "
            f"from {plain(space_group['symbol'])} (No. {space_group['number']}) "
            f"to {plain(target['symbol'])} (No. {target['number']}).")


def archived_relaxations(config, ids):
    """Read stored endpoint structures; compare their symmetry with the existing local audit."""
    from pymatgen.core import Structure
    from pymatgen.symmetry.analyzer import SpacegroupAnalyzer

    audit = {r["sample_id"]: r for r in json.loads(
        (Path(config["assessment_dir"]) / "local_audit.json").read_text())["records"]}
    groups, sources, lines = {sid: {} for sid in ids}, {}, {sid: {} for sid in ids}
    for model in MLIP_KEYS:
        source = Path(config["raw_structures"]).parent / "mlip" / model / "results" / "rows.jsonl"
        sources[f"relaxed_{model}"] = source
        records = read_jsonl_for(source, set(ids))
        for sid in ids:
            line, record = records[sid][-1]
            if record["status"] != "ok":
                raise ValueError(f"{sid}: {model} has no successful archived relaxation")
            structure = Structure.from_dict(record["relaxed_structure"])
            groups[sid][model] = {}
            lines[sid][model] = {"source": f"relaxed_{model}", "line": line + 1}
            for tol in ("0.01", "0.1"):
                analyzer = SpacegroupAnalyzer(structure, symprec=float(tol))
                group = {"number": analyzer.get_space_group_number(), "symbol": analyzer.get_space_group_symbol()}
                expected = audit[sid]["models"][model]["relaxed_geometry"]["spacegroup_by_symprec_A"][tol]
                if group["number"] != expected["number"]:
                    raise ValueError(f"{sid}: {model} endpoint and local audit disagree at {tol} Å")
                groups[sid][model][tol] = group
    return groups, sources, lines


def export_one(sample_id, candidates, raw_entry, raw_dir, tables, assessment, protocol):
    from pymatgen.core import Structure
    from pymatgen.symmetry.analyzer import SpacegroupAnalyzer
    from pymatgen.symmetry.groups import SpaceGroup

    form_from_tokens, wyckoff_names = tables
    evaluated = Structure.from_file(raw_dir / raw_entry["cif"])
    line_number, record, structure = choose_record(candidates, evaluated)
    sg = int(record["template"]["space_group"])
    sites, problems = recover_sites(record, structure, form_from_tokens, wyckoff_names, structure.lattice.matrix)
    found_sg = SpacegroupAnalyzer(structure, symprec=0.01).get_space_group_number()
    if found_sg != sg:
        problems.append(f"space group of the structure is {found_sg}, template says {sg}")
    general = form_from_tokens(sg, "1", 0)
    formula = structure.composition.reduced_formula
    mlip = assessment.get(sample_id)
    if mlip is None:
        raise ValueError(f"{sample_id} is not in the S.S.U.N. assessment")
    if mlip["formula"] != formula or int(mlip["spacegroup"]["number"]) != sg:
        raise ValueError(f"{sample_id}: assessment says {mlip['formula']} #{mlip['spacegroup']['number']}")
    levels = record["search_stats"]["levels"]
    trace = {
        "schema": "crystalar-trace/1",
        "id": sample_id,
        "slug": slug(sample_id),
        "formula": formula,
        "formulaFull": structure.composition.formula.replace(" ", ""),
        "nAtoms": len(structure),
        "spaceGroup": {
            "number": sg,
            # Short international symbol (e.g. Pm rather than P1m1), as spglib reports it.
            "symbol": SpacegroupAnalyzer(structure, symprec=0.01).get_space_group_symbol(),
            "fullSymbol": SpaceGroup.from_int_number(sg).full_symbol,
            "operations": len(general.all_affines),
            "generalPosition": [snap_array(op).reshape(3, 4).tolist()
                                for op in general.all_affines],
        },
        "lattice": lattice_block(structure, sg),
        "sites": sites,
        "atoms": [{"element": s.specie.symbol, "frac": [float(v) for v in s.frac_coords]} for s in structure],
        "search": {
            "beamWidth": protocol.get("beam_width"),
            "levels": [{"level": int(lv["level"]) + 1, "jointCandidates": int(lv["candidate_prefixes"]),
                        "keptInBeam": int(lv["kept"]), "completeRollouts": int(lv["complete_rollouts"])}
                       for lv in levels],
        },
        "mlip": {
            "hullMeVPerAtom": {k: float(mlip["raw_E_hull_meV_atom"][k]) for k in MLIP_KEYS},
            "ssunModels": [m for m in MLIP_KEYS if m in mlip["ssun_models"]],
            "ssunCount": len(mlip["ssun_models"]),
        },
        "replay": {"enabled": not problems, "reason": "; ".join(problems) or None},
        "cif": f"assets/cif/{slug(sample_id)}.cif",
        "provenance": f"CrystalAR final model · de novo sample {sample_id} of 2,500",
    }
    return trace, cif_text(structure, sample_id), line_number


def print_regions(trace) -> None:
    print(f"{trace['id']}  {trace['formula']}  {trace['spaceGroup']['symbol']} (#{trace['spaceGroup']['number']})")
    for site in trace["sites"]:
        label = f"{site['element']} {site['wyckoff']} {site['form']['text']}"
        if not site["dof"]:
            print(f"  {label}: fixed, no refinement")
            continue
        for name, index9, length in zip(site["form"]["params"], site["index9"], site["paramLengthsA"]):
            print(f"  {label}: {name}")
            for level in range(1, LEVELS + 1):
                k = index9 >> (LEVELS - level)
                lo, hi = k / 2 ** level, (k + 1) / 2 ** level
                stats = trace["search"]["levels"][level - 1] if level - 1 < len(trace["search"]["levels"]) else None
                beam = f"  {stats['jointCandidates']:>3} scored · {stats['keptInBeam']} kept" if stats else ""
                print(f"    level {level}: [{lo:.10f}, {hi:.10f})  width 1/{2 ** level:<3} = {length / 2 ** level:7.4f} Å{beam}")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--ids", nargs="+", default=[STORY_ID], help="sample ids, or 'gallery' for all 13")
    parser.add_argument("--config", help="JSON file with source paths (default tools/local_config.json)")
    for key in ("artifacts_root", "attempts", "raw_structures", "assessment_dir", "generator_root", "provenance_manifest"):
        parser.add_argument(f"--{key.replace('_', '-')}", dest=key)
    parser.add_argument("--out", default=str(REPO / "data" / "crystals"))
    parser.add_argument("--cif-dir", default=str(REPO / "assets" / "cif"))
    parser.add_argument("--print-regions", action="store_true", help="print the level-by-level regions")
    args = parser.parse_args(argv)
    ids = GALLERY_IDS if args.ids == ["gallery"] else args.ids
    config = load_config(args)
    tables = import_generator_tables(config["generator_root"])
    attempts = Path(config["attempts"])
    raw_path = Path(config["raw_structures"])
    records = read_jsonl_for(attempts, set(ids))
    raw_records = read_jsonl_for(raw_path, set(ids))
    raw = {sid: entries[-1][1] for sid, entries in raw_records.items() if entries}
    protocol_path = attempts.parent / "protocol.json"
    protocol = json.loads(protocol_path.read_text()).get("F_search", {}) if protocol_path.exists() else {}
    assessment = load_assessment(Path(config["assessment_dir"]))
    relaxations, endpoint_sources, endpoint_lines = archived_relaxations(config, ids)
    assessment_dir = Path(config["assessment_dir"])
    source_paths = {
        "attempts": attempts, "raw_structures": raw_path,
        "assessment": assessment_dir / "assessment.json",
        "screening": assessment_dir / "candidate_screening.csv",
        "relaxation_audit": assessment_dir / "local_audit.json",
        **endpoint_sources,
    }
    if protocol_path.exists():
        source_paths["protocol"] = protocol_path
    for name in ("coord_minimal.py", "wyckoff.py"):
        source_paths[name] = Path(config["generator_root"]) / "crystalformer" / "src" / name
    manifest_path = Path(config["provenance_manifest"])
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {
        "schema": "crystalar-local-provenance/1", "lineNumberBase": 1, "records": {}}
    manifest["sources"] = {key: {"path": relative_to(p, config.get("artifacts_root")), "sha256": sha256(p)}
                           for key, p in source_paths.items()}
    out_dir, cif_dir = Path(args.out), Path(args.cif_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cif_dir.mkdir(parents=True, exist_ok=True)
    failures = 0
    for sid in ids:
        if not records.get(sid) or sid not in raw:
            print(f"{sid}: not found in the sources", file=sys.stderr)
            failures += 1
            continue
        trace, cif, line = export_one(sid, records[sid], raw[sid], raw_path.parent, tables, assessment, protocol)
        trace["relaxationNote"] = relaxation_note(trace["spaceGroup"], relaxations[sid])
        evaluated = raw_path.parent / raw[sid]["cif"]
        assessment_records = json.loads((assessment_dir / "assessment.json").read_text())["records"]
        manifest["records"][sid] = {
            "generation": {"source": "attempts", "line": line + 1},
            "rawStructure": {"source": "raw_structures", "line": raw_records[sid][-1][0] + 1},
            "evaluatedCif": {"path": relative_to(evaluated, config.get("artifacts_root")), "sha256": sha256(evaluated)},
            "assessment": {"source": "assessment", "pointer": f"/records/{next(i for i, r in enumerate(assessment_records) if r['sample_id'] == sid)}"},
            "relaxationEndpoints": endpoint_lines[sid],
            "relaxedSpaceGroups": relaxations[sid],
            "givenFromPrior": "space group and size controls are sampled from the empirical training prior",
            "coordinates": "fractional coordinates are the centers of the level-9 regions",
            "generatorDecoderCheck": OCTREE is not None,
        }
        (out_dir / f"{trace['slug']}.json").write_text(json.dumps(trace, ensure_ascii=False, separators=(",", ":")) + "\n")
        (cif_dir / f"{trace['slug']}.cif").write_text(cif)
        status = "replay ok" if trace["replay"]["enabled"] else f"REPLAY DISABLED: {trace['replay']['reason']}"
        print(f"{sid}: {trace['formula']} #{trace['spaceGroup']['number']}  {len(trace['atoms'])} atoms  {status}")
        if args.print_regions:
            print_regions(trace)
    write_index(out_dir)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return 1 if failures else 0


def write_index(out_dir: Path) -> None:
    """data/crystals/index.json: the gallery list, rebuilt from every exported gallery trace."""
    entries = []
    for sid in GALLERY_IDS:
        path = out_dir / f"{slug(sid)}.json"
        if not path.exists():
            continue
        t = json.loads(path.read_text())
        entries.append({
            "id": t["id"], "slug": t["slug"], "formula": t["formula"], "nAtoms": t["nAtoms"],
            "spaceGroup": {"number": t["spaceGroup"]["number"], "symbol": t["spaceGroup"]["symbol"]},
            "hull": t["mlip"]["hullMeVPerAtom"], "ssunModels": t["mlip"]["ssunModels"], "ssunCount": t["mlip"]["ssunCount"],
            "template": [f"{s['element']} {s['wyckoff']}" for s in t["sites"]],
            "trace": f"data/crystals/{t['slug']}.json", "cif": t["cif"],
            "poster": f"assets/img/posters/{t['slug']}.webp", "replay": t["replay"]["enabled"],
            "relaxationNote": t.get("relaxationNote"),
        })
    index = {
        "schema": "crystalar-gallery/1",
        "note": "S.S.U.N. union over three MLIPs (Orb, MACE, UMA); signed distances to a fixed MLIP reference hull in meV/atom; no DFT or experimental validation.",
        "crystals": entries,
    }
    (out_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    raise SystemExit(main())
