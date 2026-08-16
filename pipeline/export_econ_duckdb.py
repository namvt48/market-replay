#!/usr/bin/env python3
"""Export the normalized DuckDB economic calendar to Market Replay JSONL.

The source database stores scheduled_utc as a timezone-normalized UTC
TIMESTAMP. Market Replay uses epoch seconds everywhere, so this exporter makes
that conversion once and preserves the feed's raw display values verbatim.
The destination is replaced atomically; a concurrent SIGHUP can therefore
load either the previous complete shard or the next complete shard, never a
partial export.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Sequence

import duckdb

from _pipeline_config import load_pipeline_config, resolve_repo_path

IMPORTANCE_BY_LEVEL = {0: "none", 1: "low", 2: "medium", 3: "high"}
EXPORT_QUERY = """
SELECT
    event_id,
    scheduled_utc,
    country,
    currency,
    event_name,
    impact_level,
    raw_actual,
    raw_forecast,
    raw_previous,
    source
FROM economic_events
ORDER BY scheduled_utc, event_id
"""


def utc_epoch_seconds(value: datetime) -> int:
    """Convert a normalized DuckDB TIMESTAMP to epoch seconds as UTC."""
    aware = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    return int(aware.astimezone(timezone.utc).timestamp())


def event_record(row: Sequence[Any]) -> dict[str, Any]:
    (
        event_id,
        scheduled_utc,
        country,
        currency,
        title,
        impact_level,
        actual,
        forecast,
        previous,
        source,
    ) = row
    importance = IMPORTANCE_BY_LEVEL.get(int(impact_level))
    if importance is None:
        raise ValueError(
            f"unsupported impact_level {impact_level!r} for event {event_id!r}"
        )
    record: dict[str, Any] = {
        "id": str(event_id),
        "ts": utc_epoch_seconds(scheduled_utc),
        "country": str(country),
        "currency": str(currency),
        "title": str(title),
        "importance": importance,
        "source": str(source),
    }
    for key, value in (
        ("actual", actual),
        ("forecast", forecast),
        ("previous", previous),
    ):
        if value is not None and str(value) != "":
            record[key] = str(value)
    return record


def rows(
    connection: duckdb.DuckDBPyConnection, batch_size: int = 5_000
) -> Iterator[Sequence[Any]]:
    cursor = connection.execute(EXPORT_QUERY)
    while batch := cursor.fetchmany(batch_size):
        yield from batch


def export_calendar(database: Path, output: Path) -> int:
    if not database.is_file():
        raise FileNotFoundError(f"DuckDB calendar not found: {database}")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    count = 0
    connection = duckdb.connect(str(database), read_only=True)
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=output.parent,
            prefix=f".{output.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            for row in rows(connection):
                temporary.write(
                    json.dumps(
                        event_record(row), ensure_ascii=False, separators=(",", ":")
                    )
                )
                temporary.write("\n")
                count += 1
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_path, output)
        temporary_path = None
    finally:
        connection.close()
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
    return count


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--db",
        type=Path,
        help="source econ_calendar.duckdb (default: config.yaml pipeline.econ_duckdb)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        help="destination Market Replay JSONL shard (default: config.yaml pipeline.econ_jsonl)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    cfg = load_pipeline_config()

    database = args.db.resolve() if args.db else None
    if database is None and cfg.get("econ_duckdb"):
        database = resolve_repo_path(cfg["econ_duckdb"])
    output = args.out.resolve() if args.out else None
    if output is None and cfg.get("econ_jsonl"):
        output = resolve_repo_path(cfg["econ_jsonl"])
    if database is None or output is None:
        raise SystemExit(
            "error: --db/--out not given, and not found in config.yaml "
            "(pipeline.econ_duckdb / pipeline.econ_jsonl)"
        )

    count = export_calendar(database, output)
    print(json.dumps({"events": count, "output": str(output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
