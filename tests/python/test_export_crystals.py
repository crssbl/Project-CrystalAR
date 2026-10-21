"""Round-trip tests for the exported generation traces (written before the exporter).

Every exported crystal must reproduce its stored generation record exactly:
level-9 centres, Wyckoff maps, symmetry expansion, formula and space group.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest
from pymatgen.analysis.structure_matcher import StructureMatcher
from pymatgen.core import Lattice, Structure
from pymatgen.symmetry.analyzer import SpacegroupAnalyzer

from conftest import REPO, TRACE_DIR

STORY_ID = "denovo:75"
LEVELS = 9
TOL = 1e-6


def periodic_close(a, b, tol=TOL) -> bool:
    d = np.asarray(a, float) - np.asarray(b, float)
    d -= np.round(d)
    return bool(np.max(np.abs(d)) <= tol)


def wyckoff_map(site: dict, u) -> np.ndarray:
    B = np.asarray(site["form"]["B"], float).reshape(3, len(u))
    b = np.asarray(site["form"]["b"], float)
    return (B @ np.asarray(u, float) + b) % 1.0


def expand(site: dict) -> list[np.ndarray]:
    rep = np.asarray(site["representative"], float)
    out: list[np.ndarray] = []
    for op in site["orbit"]:
        m = np.asarray(op, float).reshape(3, 4)
        p = (m[:, :3] @ rep + m[:, 3]) % 1.0
        if not any(periodic_close(p, q) for q in out):
            out.append(p)
    return out


def record_structure(record: dict) -> Structure:
    return Structure.from_dict(record["structure"])


# --------------------------------------------------------------------------- story crystal

def test_story_crystal_is_exported(traces):
    assert STORY_ID in traces, "data/crystals/denovo-75.json is missing"


def test_story_template_in_generation_order(traces):
    trace = traces[STORY_ID]
    sites = trace["sites"]
    assert [s["dof"] for s in sites] == [0, 0, 1, 1]
    assert [(s["element"], s["wyckoff"]) for s in sites] == [("Cl", "2b"), ("La", "4d"), ("La", "6g"), ("Bi", "6g")]
    assert [s["order"] for s in sites] == [0, 1, 2, 3]
    # Fixed points 2b (0,0,0) and 4d (1/3,2/3,0); 6g is the line (x, 0, 1/4).
    assert periodic_close(sites[0]["representative"], [0, 0, 0])
    assert periodic_close(sites[1]["representative"], [1 / 3, 2 / 3, 0], tol=1e-6)
    for s in sites[2:]:
        assert np.allclose(np.asarray(s["form"]["B"], float).reshape(3, 1)[:, 0], [1, 0, 0])
        assert np.allclose(s["form"]["b"], [0, 0, 0.25])
        assert s["form"]["text"] == "(x, 0, 1/4)"


def test_story_formula_space_group_and_lattice(traces):
    trace = traces[STORY_ID]
    assert trace["formula"] == "La5Bi3Cl"
    assert trace["spaceGroup"]["number"] == 193
    assert trace["spaceGroup"]["symbol"] == "P6_3/mcm"
    assert trace["spaceGroup"]["operations"] == 24
    assert trace["lattice"]["family"] == "hexagonal"
    assert [v["name"] for v in trace["lattice"]["active"]] == ["V", "c/a"]
    assert trace["nAtoms"] == 18


# --------------------------------------------------------------------------- the gallery

GALLERY = [f"denovo:{i}" for i in (75, 2219, 1798, 1431, 2006, 53, 570, 766, 1559, 2435, 143, 1190, 2002)]


def test_all_thirteen_candidates_are_exported(traces):
    assert sorted(traces) == sorted(GALLERY)


def test_ids_formulas_and_space_groups_match_the_assessment(traces, config):
    records = {r["sample_id"]: r for r in json.loads((Path(config["assessment_dir"]) / "assessment.json").read_text())["records"]}
    assert sorted(records) == sorted(GALLERY)
    for sid in GALLERY:
        trace, rec = traces[sid], records[sid]
        assert trace["formula"] == rec["formula"], sid
        assert trace["spaceGroup"]["number"] == rec["spacegroup"]["number"], sid
        # The page uses the short Hermann–Mauguin symbol (Pm); the assessment may use the full one (P1m1).
        short = trace["spaceGroup"]["symbol"].replace("1", "") if trace["spaceGroup"]["number"] in range(3, 16) else trace["spaceGroup"]["symbol"]
        assert rec["spacegroup"]["symbol"].replace("1", "") in {trace["spaceGroup"]["symbol"], short} or rec["spacegroup"]["symbol"] == trace["spaceGroup"]["symbol"], sid
        for key in ("orb", "mace", "uma"):
            assert math.isclose(trace["mlip"]["hullMeVPerAtom"][key], rec["raw_E_hull_meV_atom"][key], abs_tol=1e-9)
        assert sorted(trace["mlip"]["ssunModels"]) == sorted(rec["ssun_models"])
        assert trace["mlip"]["ssunCount"] == len(rec["ssun_models"])


def test_gallery_index_matches_the_traces(traces):
    index = json.loads((TRACE_DIR / "index.json").read_text())
    assert [e["id"] for e in index["crystals"]] == GALLERY
    counts = {}
    for entry in index["crystals"]:
        trace = traces[entry["id"]]
        assert entry["formula"] == trace["formula"]
        assert entry["spaceGroup"]["number"] == trace["spaceGroup"]["number"]
        assert entry["hull"] == trace["mlip"]["hullMeVPerAtom"]
        assert entry["ssunCount"] == trace["mlip"]["ssunCount"]
        assert (REPO / entry["cif"]).exists() and (REPO / entry["trace"]).exists()
        counts[entry["ssunCount"]] = counts.get(entry["ssunCount"], 0) + 1
    # 3 judged S.S.U.N. by all three MLIPs, 2 by Orb and UMA, 8 by MACE alone.
    assert counts == {3: 3, 2: 2, 1: 8}


# --------------------------------------------------------------------------- every crystal

def all_ids(traces):
    return sorted(traces) or [STORY_ID]


def test_traces_have_no_absolute_paths():
    for path in TRACE_DIR.glob("*.json"):
        text = path.read_text()
        assert "/public/" not in text and "/home/" not in text and "/tmp/" not in text, path.name


def test_free_parameters_are_level9_centres(traces):
    for sid in all_ids(traces):
        for site in traces[sid]["sites"]:
            assert len(site["u"]) == site["dof"]
            for u, index in zip(site["u"], site["index9"]):
                k = u * 2 ** LEVELS - 0.5
                assert abs(k - round(k)) <= TOL, (sid, site["order"], u)
                assert round(k) == index


def test_wyckoff_map_of_level9_centre_is_stored_representative(traces):
    for sid in all_ids(traces):
        for site in traces[sid]["sites"]:
            assert periodic_close(wyckoff_map(site, site["u"]), site["representative"]), (sid, site["order"])


def test_region_width_halves_and_regions_nest(traces):
    for sid in all_ids(traces):
        for site in traces[sid]["sites"]:
            for u, index9 in zip(site["u"], site["index9"]):
                prev = (0.0, 1.0)
                for level in range(1, LEVELS + 1):
                    k = index9 >> (LEVELS - level)
                    lo, hi = k / 2 ** level, (k + 1) / 2 ** level
                    assert math.isclose(hi - lo, (prev[1] - prev[0]) / 2)
                    assert prev[0] - 1e-12 <= lo and hi <= prev[1] + 1e-12
                    assert lo <= u < hi
                    assert k == math.floor(u * 2 ** level)
                    prev = (lo, hi)


def test_symmetry_expansion_reproduces_stored_atoms(traces, chosen_records):
    for sid in all_ids(traces):
        trace = traces[sid]
        line, record = chosen_records[sid]
        stored = record_structure(record)
        expanded = []
        for site in trace["sites"]:
            orbit = expand(site)
            assert len(orbit) == site["multiplicity"], (sid, site["order"])
            expanded += [(site["element"], p) for p in orbit]
        assert len(expanded) == len(stored)
        unmatched = list(range(len(stored)))
        for element, p in expanded:
            hit = next(i for i in unmatched if stored[i].specie.symbol == element and periodic_close(stored[i].frac_coords, p))
            unmatched.remove(hit)
        assert not unmatched
        # The trace's own atom list is the same set, in the stored order.
        assert [a["element"] for a in trace["atoms"]] == [s.specie.symbol for s in stored]
        for atom, s in zip(trace["atoms"], stored):
            assert periodic_close(atom["frac"], s.frac_coords)


def test_formula_space_group_and_template_match_source(traces, chosen_records):
    for sid in all_ids(traces):
        trace = traces[sid]
        line, record = chosen_records[sid]
        structure = record_structure(record)
        assert trace["formula"] == structure.composition.reduced_formula
        assert trace["spaceGroup"]["number"] == record["template"]["space_group"]
        assert SpacegroupAnalyzer(structure, symprec=0.01).get_space_group_number() == trace["spaceGroup"]["number"]
        for site, src in zip(trace["sites"], record["template"]["template"]):
            for key in ("element", "multiplicity", "dof", "order"):
                assert site[key] == src[key], (sid, key)
            assert site["siteSymmetry"] == src["site_symmetry"]
            assert site["coordinateForm"] == src["coordinate_form"]


def test_record_matches_evaluated_raw_structure(traces, chosen_records, raw_evaluated):
    matcher = StructureMatcher(ltol=0.2, stol=0.3, angle_tol=5, primitive_cell=False, scale=False)
    for sid in all_ids(traces):
        trace = traces[sid]
        evaluated = Structure.from_file(raw_evaluated[sid]["_cif_path"])
        line, record = chosen_records[sid]
        stored = record_structure(record)
        assert matcher.fit(stored, evaluated), sid
        assert len(stored) == len(evaluated)
        assert np.allclose(stored.lattice.parameters, evaluated.lattice.parameters, atol=1e-4)
        # Exact same atoms; the CIF reader regroups sites by species, so compare as sets.
        unmatched = list(range(len(evaluated)))
        for a in stored:
            hit = next(i for i in unmatched if evaluated[i].specie.symbol == a.specie.symbol
                       and periodic_close(a.frac_coords, evaluated[i].frac_coords, tol=1e-6))
            unmatched.remove(hit)
        assert not unmatched


def test_lattice_matches_record(traces, chosen_records):
    for sid in all_ids(traces):
        trace = traces[sid]
        line, record = chosen_records[sid]
        lattice = Lattice(record["structure"]["lattice"]["matrix"])
        assert np.allclose(trace["lattice"]["matrix"], lattice.matrix, atol=1e-9)
        assert math.isclose(trace["lattice"]["volume"], lattice.volume, rel_tol=1e-9)
        active = {v["name"]: v["value"] for v in trace["lattice"]["active"]}
        assert math.isclose(active["V"], lattice.volume, rel_tol=1e-9)
        if "c/a" in active:
            assert math.isclose(active["c/a"], lattice.c / lattice.a, rel_tol=1e-9)


def test_search_statistics_come_from_the_record(traces, chosen_records):
    for sid in all_ids(traces):
        trace = traces[sid]
        line, record = chosen_records[sid]
        levels = record["search_stats"]["levels"]
        exported = trace["search"]["levels"]
        assert [lv["level"] for lv in exported] == [lv["level"] + 1 for lv in levels]
        for mine, src in zip(exported, levels):
            assert mine["jointCandidates"] == src["candidate_prefixes"]
            assert mine["keptInBeam"] == src["kept"]


def test_cif_round_trips(traces, chosen_records):
    for sid in all_ids(traces):
        trace = traces[sid]
        cif = REPO / trace["cif"]
        assert cif.exists(), trace["cif"]
        parsed = Structure.from_file(cif)
        line, record = chosen_records[sid]
        assert StructureMatcher().fit(parsed, record_structure(record)), sid
        assert parsed.composition.reduced_formula == trace["formula"]


def test_replay_flag_reflects_round_trip(traces):
    for sid in all_ids(traces):
        replay = traces[sid]["replay"]
        assert replay["enabled"] is True, (sid, replay.get("reason"))
