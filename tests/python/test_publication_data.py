"""Public metadata and private lineage, checked against archived data without inference."""
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from conftest import REPO, TRACE_DIR
from export_crystals import load_config, relaxation_note


EXPECTED = ("With each of the three MLIPs, relaxation raises the symmetry of this structure "
            "from Amm2 (No. 38) to P6₃/mcm (No. 193).")
FROM = {"number": 38, "symbol": "Amm2"}
TO = {"number": 193, "symbol": "P6_3/mcm"}
MODELS = ("orb", "mace", "uma")
TOLERANCES = ("0.01", "0.1")


def agreeing_endpoints():
    return {m: {tol: dict(TO) for tol in TOLERANCES} for m in MODELS}


def test_note_formats_the_agreement_of_all_six_space_group_checks():
    assert relaxation_note(FROM, agreeing_endpoints()) == EXPECTED


@pytest.mark.parametrize("model,tol", [(m, t) for m in MODELS for t in TOLERANCES])
def test_one_unchanged_check_suppresses_the_note(model, tol):
    endpoints = agreeing_endpoints()
    endpoints[model][tol] = FROM
    assert relaxation_note(FROM, endpoints) is None


def test_missing_or_different_endpoint_suppresses_the_common_group_note():
    endpoints = agreeing_endpoints()
    del endpoints["uma"]["0.1"]
    assert relaxation_note(FROM, endpoints) is None
    endpoints = agreeing_endpoints()
    endpoints["uma"]["0.1"] = {"number": 63, "symbol": "Cmcm"}
    assert relaxation_note(FROM, endpoints) is None
    assert relaxation_note(TO, agreeing_endpoints()) is None


def test_only_the_verified_candidate_has_a_note_and_the_index_matches(traces, provenance):
    assert {sid for sid, trace in traces.items() if trace["relaxationNote"]} == {"denovo:143"}
    assert traces["denovo:143"]["relaxationNote"] == EXPECTED
    index = json.loads((TRACE_DIR / "index.json").read_text())
    for entry in index["crystals"]:
        trace = traces[entry["id"]]
        groups = provenance["records"][entry["id"]]["relaxedSpaceGroups"]
        assert entry["relaxationNote"] == trace["relaxationNote"] == relaxation_note(trace["spaceGroup"], groups)


def test_published_provenance_is_a_single_short_line(traces):
    for sid, trace in traces.items():
        assert trace["provenance"] == f"CrystalAR final model · de novo sample {sid} of 2,500"


def test_local_manifest_records_relative_paths_line_numbers_and_source_hashes(config, provenance, traces):
    manifest_path = Path(os.environ.get("CRYSTALAR_PROVENANCE_MANIFEST", config["provenance_manifest"]))
    assert not manifest_path.resolve().is_relative_to(REPO)
    assert provenance["lineNumberBase"] == 1
    assert set(provenance["records"]) == set(traces)
    for source in provenance["sources"].values():
        assert not Path(source["path"]).is_absolute()
        path = Path(config["artifacts_root"]) / source["path"]
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1 << 20), b""):
                digest.update(block)
        assert digest.hexdigest() == source["sha256"]
    for record in provenance["records"].values():
        assert record["generation"]["line"] >= 1
        assert record["rawStructure"]["line"] >= 1
        for model in MODELS:
            assert record["relaxationEndpoints"][model]["line"] >= 1


def test_exporter_refuses_a_manifest_in_the_published_site(config):
    keys = ("artifacts_root", "attempts", "raw_structures", "assessment_dir", "generator_root", "provenance_manifest")
    args = SimpleNamespace(config=None, **{key: None for key in keys})
    args.provenance_manifest = str(REPO / "data" / "private.json")
    with pytest.raises(SystemExit, match="outside the published repository"):
        load_config(args)
