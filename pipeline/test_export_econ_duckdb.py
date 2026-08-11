import json
from datetime import datetime

import duckdb

from export_econ_duckdb import export_calendar


def test_export_calendar_preserves_utc_raw_values_and_non_economic(tmp_path):
    database = tmp_path / "calendar.duckdb"
    output = tmp_path / "econ" / "economic_events.jsonl"
    connection = duckdb.connect(str(database))
    connection.execute(
        """
        CREATE TABLE economic_events (
            event_id VARCHAR,
            scheduled_utc TIMESTAMP,
            country VARCHAR,
            currency VARCHAR,
            event_name VARCHAR,
            impact_level SMALLINT,
            raw_actual VARCHAR,
            raw_forecast VARCHAR,
            raw_previous VARCHAR,
            source VARCHAR
        )
        """
    )
    connection.executemany(
        "INSERT INTO economic_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            ("holiday", datetime(2026, 8, 10, 0, 0), "UK", "GBP", "Bank Holiday", 0, "", "", "", "fixture"),
            ("cpi", datetime(2026, 8, 12, 12, 30), "US", "USD", "CPI m/m", 3, "0.4%", "0.2%", "0.3%", "fixture"),
        ],
    )
    connection.close()

    assert export_calendar(database, output) == 2
    records = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]

    assert records[0] == {
        "id": "holiday",
        "ts": 1786320000,
        "country": "UK",
        "currency": "GBP",
        "title": "Bank Holiday",
        "importance": "none",
        "source": "fixture",
    }
    assert records[1]["ts"] == 1786537800
    assert records[1]["actual"] == "0.4%"
    assert records[1]["forecast"] == "0.2%"
    assert records[1]["previous"] == "0.3%"
