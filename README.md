# market-replay

Self-hosted market replay and trading journal platform.

[![Go Version](https://img.shields.io/github/go-mod/go-version/namvt48/market-replay)](https://go.dev/)
[![Release](https://img.shields.io/github/v/release/namvt48/market-replay)](https://github.com/namvt48/market-replay/releases/tag/v0.1.0)

market-replay replays pre-compiled bar data bar by bar on your own machine. It never calls an external market data API at runtime; everything is served from `.bin` files mapped into memory and from a local SQLite database. The server is a single static Go binary (CGO_ENABLED=0, pure-Go SQLite) with the React web UI embedded. It bundles a multi-chart replay workspace with drawing tools, a JavaScript indicator engine, a trading journal, analytics with trade simulations, and an economic calendar synced to the chart.

## Features

- **Bar-by-bar market replay** over pre-compiled OHLCV bar data, with no live feed and no external data dependency.
- **Multi-chart workspace** per working session.
- **Drawing tools** from a vendored fork of `lightweight-charts-drawing` (`web/vendor/lightweight-charts-drawing`, wired in as a `file:` dependency with its build output committed, so no extra build step).
- **Indicator engine** that runs JS scripts on [goja](https://github.com/dop251/goja), with builtin indicators, an LRU cache of run results (default 64 entries), and a 5-second wall-clock timeout per script run.
- **Sub-minute timeframes** from 5s to 55s in 5s steps, aggregated on request from the base dataset via `BaseTimeframe` routing (seconds-unit timeframes read the `5s` dataset; everything else rolls up from `1m`).
- **Workspace-level timezone** selection, including fixed UTC offsets alongside named zones.
- **Economic calendar synced to the chart**, fed by a DuckDB to JSONL export pipeline.
- **Trading journal**: sessions, trades, and a watchlist, with restore, delete, and permanent-delete lifecycle for sessions.
- **Analytics**: performance, drawdown, stop-loss / risk-reward / Monte-Carlo simulations, edge, and execution discipline.
- **Symbol browser** dialog, openable with the `/` keyboard shortcut.
- **Zero-downtime data reload via SIGHUP**: copy new `.bin` files (and calendar data) in place, signal the process, and it reloads without restarting. A failed reload keeps serving the previously loaded data.
- **Single static binary** with the built web UI embedded via `go:embed`; the only runtime state is the data directory and the SQLite database.

## Getting Started

### Quick start with Docker Compose

```sh
docker compose up --build
```

Then open http://localhost:8080.

Two things to know before the first run:

- The container bind-mounts `./data` to `/srv/replay/data`, so it serves the same dataset as local development. That directory must already contain `data/meta/symbols.json` and your `data/bin/*.bin` bar files; the server fails fast at startup if `meta/symbols.json` is missing. `config.yaml` is bind-mounted read-only as well.
- The host port is overridable: `HOST_PORT=9090 docker compose up --build` maps port 9090 instead of the default 8080. The service runs as UID/GID 1000 to match host-owned `data/` files.

After dropping new bar files into `data/bin/`, hot-reload them without a rebuild or restart:

```sh
docker compose kill -s HUP app
```

### Local development

Prerequisites:

- Go 1.26+ (`go.mod` targets 1.26.1)
- Node.js with pnpm, for building the web frontend (the Docker build uses Node 22)

Build and run:

```sh
make build   # builds web/dist first, then embeds it into the binary via web/embed.go
make run     # builds (if needed) and serves on :8080
```

The build order matters: `make build` runs the frontend build (`pnpm install` + `pnpm build` in `web/`) before `go build`, because the Go binary embeds `web/dist` through `web/embed.go`.

Quality gates:

```sh
make vet
make test
make test-race
make clean
```

## Configuration

`config.yaml` is the single runtime tuning point. Changes take effect on the next server restart; there is no live reload of configuration.

### `server:`

| Key | Default | Notes |
| --- | --- | --- |
| `http_addr` | `":8080"` | Listen address. Overridden by the `HTTP_ADDR` env var. |
| `data_dir` | `"data"` | Directory with `meta/symbols.json`, `bin/*.bin`, and the economic calendar. Overridden by `DATA_DIR`. |
| `db_path` | `"data/app.db"` | SQLite database path. Overridden by `DB_PATH`. |

The three env vars (`HTTP_ADDR`, `DATA_DIR`, `DB_PATH`) always win over the `server:` section, which is how `docker-compose.yml` and `deploy/replay.service` configure the server without editing the file.

### `limits:`

| Key | Default | Meaning |
| --- | --- | --- |
| `gzip_min_bytes` | `1024` | Response bodies at or under this size (bytes) skip gzip. |
| `preference_payload_bytes` | `262144` (256 KiB) | Request-body cap for preference writes. |
| `indicator_run_payload_bytes` | `65536` (64 KiB) | Request-body cap for indicator runs. |
| `drawing_template_payload_bytes` | `65536` (64 KiB) | Request-body cap for drawing template writes. |
| `workspace_snapshot_payload_bytes` | `4194304` (4 MiB) | Request-body cap for workspace snapshot writes. |
| `simulation_payload_bytes` | `65536` (64 KiB) | Request-body cap for analytics simulations. |
| `econ_line_bytes` | `65536` (64 KiB) | Max size of one JSONL calendar record line. |
| `max_journal_trades` | `10000` | Trades accepted per `PUT .../trades` write. |
| `indicator_cache_size` | `64` | Number of LRU-cached indicator run results. |
| `indicator_run_timeout_seconds` | `5` | Wall-clock budget per indicator script run. |

Every key under `limits:` is optional. A key left out, or set to `0`, keeps its hardcoded default, so overriding one limit never resets the others.

### `pipeline:`

Defaults for the Python ingest scripts under `pipeline/`, which read this section directly (the Go binary does not):

- `econ_duckdb`: source DuckDB file for `make econ-import` / `pipeline/export_econ_duckdb.py` (default `../data-engineering/economic-calendar/data/econ_calendar.duckdb`).
- `econ_jsonl`: JSONL output consumed by the server (default `data/econ/economic_events.jsonl`).
- `ingest.jobs`: worker process count for `stitch.py`; `0` means use the CPU count.
- `ingest.symbols`: per-symbol ingest defaults for `pipeline/stitch.py`, keyed by `--symbol`. Preconfigured: ES, GC, NQ, and YM futures (each with `tick_size`, `point_value`, `commission`, `slippage_ticks`) and QQQ and SPY stocks. Explicit CLI flags always win over these defaults; add a new entry here before ingesting a symbol for the first time.

## API Overview

The server exposes a JSON REST API under `/api/v1` using Go 1.22+ method-and-path routing patterns (e.g. `GET /api/v1/symbols`), plus the embedded static frontend at `/`. All routes below are registered in `internal/httpapi/server.go`.

| Resource | Method | Path | Purpose |
| --- | --- | --- | --- |
| Health | `GET` | `/healthz` | Liveness probe (used by the Docker healthcheck). |
| Symbols | `GET` | `/api/v1/symbols` | Symbol metadata from `meta/symbols.json`. |
| Bars | `GET` | `/api/v1/bars` | Bar range query (`symbol`, `tf`, `from`, `to`, `limit`, `fmt`). |
| Bars | `GET` | `/api/v1/bars/at` | One seek: bars around a timestamp (`at`, `before`, `after`). |
| Bars | `GET` | `/api/v1/chart-bars/at` | Display-timeframe candles aggregated from the base dataset. |
| Bars | `GET` | `/api/v1/calendar` | Trading calendar entries for a symbol/timeframe range. |
| Sessions | `POST` | `/api/v1/sessions` | Create a working session. |
| Sessions | `GET` | `/api/v1/sessions` | List sessions. |
| Sessions | `GET` | `/api/v1/sessions-deleted` | List deleted sessions. |
| Sessions | `DELETE` | `/api/v1/sessions` | Delete empty sessions. |
| Sessions | `PATCH` | `/api/v1/sessions/{id}` | Update a session. |
| Sessions | `DELETE` | `/api/v1/sessions/{id}` | Delete a session. |
| Sessions | `POST` | `/api/v1/sessions/{id}/restore` | Restore a deleted session. |
| Sessions | `DELETE` | `/api/v1/sessions/{id}/permanent` | Permanently delete a session. |
| Trades | `PUT` | `/api/v1/sessions/{id}/trades` | Replace the session's trade list. |
| Trades | `GET` | `/api/v1/sessions/{id}/trades` | List the session's trades. |
| Watchlist | `GET` | `/api/v1/watchlist` | Get the watchlist. |
| Watchlist | `PUT` | `/api/v1/watchlist` | Replace the watchlist. |
| Drawings | `POST` | `/api/v1/drawings` | Upsert chart drawings. |
| Drawings | `GET` | `/api/v1/drawings` | List chart drawings. |
| Econ | `GET` | `/api/v1/econ/meta` | Economic calendar metadata. |
| Econ | `GET` | `/api/v1/econ/week` | Economic events for a week. |
| Analytics | `GET` | `/api/v1/analytics/sources` | Available analytics data sources. |
| Analytics | `GET` | `/api/v1/analytics/performance` | Performance metrics. |
| Analytics | `GET` | `/api/v1/analytics/drawdown` | Drawdown analytics. |
| Analytics | `POST` | `/api/v1/analytics/simulations/stop-loss` | Stop-loss simulation. |
| Analytics | `POST` | `/api/v1/analytics/simulations/risk-reward` | Risk-reward simulation. |
| Analytics | `POST` | `/api/v1/analytics/simulations/monte-carlo` | Monte-Carlo simulation. |
| Analytics | `GET` | `/api/v1/analytics/edge` | Edge analytics. |
| Analytics | `GET` | `/api/v1/analytics/execution-discipline` | Execution discipline analytics. |
| Preferences | `GET` | `/api/v1/preferences` | List stored preferences. |
| Preferences | `PUT` | `/api/v1/preferences/{key}` | Set one preference. |
| Preferences | `DELETE` | `/api/v1/preferences/{key}` | Delete one preference. |
| Drawing templates | `GET` | `/api/v1/drawing-templates` | List drawing templates. |
| Drawing templates | `PUT` | `/api/v1/drawing-templates/{id}` | Create or replace a template. |
| Drawing templates | `DELETE` | `/api/v1/drawing-templates/{id}` | Delete a template. |
| Workspace snapshots | `PUT` | `/api/v1/workspace-snapshots/{ownerType}/{ownerId}` | Save a workspace snapshot. |
| Workspace snapshots | `GET` | `/api/v1/workspace-snapshots/{ownerType}/{ownerId}` | Fetch a workspace snapshot. |
| Workspace snapshots | `DELETE` | `/api/v1/workspace-snapshots/{ownerType}/{ownerId}` | Delete a workspace snapshot. |
| Indicators | `GET` | `/api/v1/indicators` | List registered indicator scripts. |
| Indicators | `POST` | `/api/v1/indicators/run` | Run an indicator script against bar data. |

## Project Structure

```text
market-replay/
├── cmd/server/           # HTTP server entrypoint
├── internal/
│   ├── analytics/        # Performance, drawdown, simulations, edge, discipline
│   ├── bars/             # mmap bar data registry (.bin/.idx datasets, rollups)
│   ├── config/           # config.yaml loading + env overrides
│   ├── econ/             # Economic calendar store
│   ├── httpapi/          # REST routes and request limits
│   ├── indicators/       # JS indicator engine (goja, LRU cache, run timeout)
│   ├── model/            # Shared domain types
│   └── storage/sqlite/   # SQLite persistence (sessions, trades, watchlist, more)
├── pipeline/             # Python ingest: stitch.py, export_econ_duckdb.py
├── web/                  # React/Vite frontend, embedded via web/embed.go
├── data/                 # Runtime data: bars, calendar, app.db
├── deploy/               # systemd unit
├── config.yaml           # Runtime configuration (server, limits, pipeline)
├── Dockerfile            # Multi-stage build: web, Go binary, slim runtime
└── docker-compose.yml    # One-command local deployment
```

## Development

Build, run, and test with the Makefile targets listed in Getting Started: `make build`, `make run`, `make vet`, `make test`, `make test-race`, `make clean`. While iterating on the frontend alone, `make web-dev` starts the Vite dev server in `web/`.

### Loading new bar data

1. Ingest new data with `pipeline/stitch.py` (per-symbol defaults like tick size and commission come from the `pipeline.ingest.symbols` section of `config.yaml`).
2. Copy or rsync the resulting `data/bin/*.bin` files into place.
3. Reload without downtime: send SIGHUP to the running process, or `docker compose kill -s HUP app` under Compose.

The economic calendar has its own refresh path: `make econ-import` exports the normalized UTC DuckDB calendar into the spoiler-safe JSONL file the server reads, and `make econ-reload` does the import plus the Compose hot-reload (`docker compose kill -s HUP app`) in one step.

### Deployment

- **Docker Compose**: `docker compose up --build` (see Getting Started). Includes a `/healthz` healthcheck and `HOST_PORT` override.
- **systemd**: `deploy/replay.service` runs `/srv/replay/replay-server` as its own `replay` user with `HTTP_ADDR=127.0.0.1:8080`, `DATA_DIR=/srv/replay/data`, `DB_PATH=/srv/replay/data/app.db`, and a hardened sandbox: `NoNewPrivileges=true`, `ProtectSystem=strict` (with `ReadWritePaths=/srv/replay/data`), and `PrivateTmp=true`.

## Contributing

Contributions are welcome. Fork the repository, create a branch for your change, and open a pull request describing what the change does and why.

Commit messages follow Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`). Please keep changes focused and update tests and documentation alongside code.
