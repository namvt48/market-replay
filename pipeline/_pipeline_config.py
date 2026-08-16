"""Shared config.yaml reader for the ingest pipeline scripts (stitch.py,
export_econ_duckdb.py) — both need the same pipeline: section, resolved
relative to the repo root regardless of the caller's working directory."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent


def load_pipeline_config() -> dict[str, Any]:
    """Return config.yaml's pipeline: section, or {} if the file (or that
    section) is absent — every caller already has its own hardcoded
    fallback for a fresh checkout with no config.yaml."""
    config_path = REPO_ROOT / "config.yaml"
    if not config_path.is_file():
        return {}
    with config_path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data.get("pipeline", {}) or {}


def resolve_repo_path(value: str) -> Path:
    """Resolve a config.yaml path value relative to the repo root, so it
    means the same thing regardless of the invoking shell's cwd."""
    return (REPO_ROOT / value).resolve()
