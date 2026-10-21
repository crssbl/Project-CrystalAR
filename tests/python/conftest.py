"""Shared fixtures for the exporter tests.

The tests read the exported traces in data/crystals/ and check them against the read-only
source artefacts. Source paths come from $CRYSTALAR_EXPORT_CONFIG or tools/local_config.json
(git-ignored); without them the source-dependent tests are skipped.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
TRACE_DIR = REPO / "data" / "crystals"
sys.path.insert(0, str(REPO / "tools"))


def _config_path() -> Path:
    env = os.environ.get("CRYSTALAR_EXPORT_CONFIG")
    return Path(env) if env else REPO / "tools" / "local_config.json"


@pytest.fixture(scope="session")
def config() -> dict:
    path = _config_path()
    if not path.exists():
        pytest.skip(f"no exporter config at {path.name}; source checks skipped")
    data = json.loads(path.read_text())
    for key in ("attempts", "raw_structures", "assessment_dir"):
        if not Path(data.get(key, "")).exists():
            pytest.skip(f"source artefact for {key!r} not available")
    return data


@pytest.fixture(scope="session")
def traces() -> dict:
    out = {}
    for path in sorted(TRACE_DIR.glob("denovo-*.json")):
        trace = json.loads(path.read_text())
        out[trace["id"]] = trace
    return out


@pytest.fixture(scope="session")
def source_records(config, traces) -> dict:
    """sample_id -> list of (line_number, record) for every exported crystal."""
    wanted = set(traces) or {"denovo:75"}
    found: dict[str, list] = {sid: [] for sid in wanted}
    with open(config["attempts"]) as handle:
        for line_number, line in enumerate(handle):
            head = line[:200]
            if not any(f'"{sid}"' in head for sid in wanted):
                continue
            record = json.loads(line)
            if record["sample_id"] in found:
                found[record["sample_id"]].append((line_number, record))
    return found


@pytest.fixture(scope="session")
def provenance(config) -> dict:
    path = Path(os.environ.get("CRYSTALAR_PROVENANCE_MANIFEST", config["provenance_manifest"]))
    return json.loads(path.read_text())


@pytest.fixture(scope="session")
def chosen_records(source_records, provenance) -> dict:
    return {sid: next((line, record) for line, record in entries
                      if line + 1 == provenance["records"][sid]["generation"]["line"])
            for sid, entries in source_records.items()}


@pytest.fixture(scope="session")
def raw_evaluated(config, traces) -> dict:
    """sample_id -> evaluated raw structure entry (with its CIF path)."""
    wanted = set(traces) or {"denovo:75"}
    out = {}
    raw_path = Path(config["raw_structures"])
    with open(raw_path) as handle:
        for line in handle:
            head = line[:200]
            if not any(f'"{sid}"' in head for sid in wanted):
                continue
            record = json.loads(line)
            if record["sample_id"] in wanted:
                record["_cif_path"] = str(raw_path.parent / record["cif"])
                out[record["sample_id"]] = record
    return out
