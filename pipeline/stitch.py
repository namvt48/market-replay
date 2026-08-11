#!/usr/bin/env python3
"""Stitch raw Databento NQ futures contracts (NQ.FUT, ohlcv-1m) into a single
continuous NQ series using the volume rollover rule, written as the RBR1
serving format the market-replay server loads (docs §6.1/§6.2, §4.5 — this is
the owner-side ingest pipeline, outside the server's architecture scope).

Performance design (decode is C-fast ~40s for 7.2M rows; Python row loops were
the real bottleneck):

  * ONE decode pass only, `price_type="fixed"` (i64 1e-9 fixed-point — the
    default "float" returns real prices and would zero out every tick).
    Chunks are kept in memory as compact numpy arrays.
  * Global symbol->code dict (159 distinct contracts); per-chunk codes are
    int32 arrays, cheap to pickle to workers.
  * Pass A (daily-volume aggregation) and Pass B (front filtering + tick
    conversion + validation) both run on a ProcessPoolExecutor with
    `--jobs N`; every worker is fully vectorized numpy, no Python row loops.
  * `--progress` prints per-chunk lines + per-stage timings (tail -f friendly).
  * `--max-chunks N` limits decode for smoke tests.

Rollover rule (volume): front contract per CME session date = the contract
with the highest daily volume, restricted to contracts that (a) still trade
the WHOLE session that day (max_ts >= end-of-day, so a contract expiring
mid-day is never picked -> no partial-day hole), and (b) expire at-or-after
the current front (never roll backwards).

RBR1 layout (docs §6.2): 24-byte header (magic "RBR1", version 1, flags bit0
prices-as-ticks, count, tickNum=1, tickDen=4 for NQ) then six column-major
arrays: ts uint32 epoch-seconds, open/high/low/close int32 ticks, volume
uint32. DBN prices are fixed-point 1e-9; ticks = price / tickSize.

Usage:
    python3 pipeline/stitch.py \
        --input data/raw/NQ/glbx-mdp3-*.ohlcv-1m.dbn.zst \
        --out data --symbol NQ --tf 1m --jobs 12 --progress
"""

from __future__ import annotations

import argparse
import glob
import json
import multiprocessing
import os
import struct
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from fractions import Fraction
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from databento import read_dbn

ET = ZoneInfo("America/New_York")
NS_PER_SEC = 1_000_000_000

# RBR1 constants (docs §6.2, mirrored from internal/bars/format.go)
RBR1_MAGIC = b"RBR1"
RBR1_VERSION = 1
RBR1_FLAG_PRICE_AS_TICKS = 1 << 0
RBR1_HEADER_SIZE = 24

CHUNK = 1_000_000  # rows per DataFrame from store.to_df


def _tick_frac(tick_size: float) -> tuple[int, int]:
    """Reduced (numerator, denominator) for a tick size, e.g. 0.25 -> (1,4),
    0.01 -> (1,100), 1.0 -> (1,1). Written into the RBR1 header so the server's
    checkTickSize (TickNum/TickDen == symbols.json tickSize) passes for futures
    (0.25, 1.0) and stocks (0.01) alike."""
    f = Fraction(str(tick_size)).limit_denominator(1_000_000)
    return f.numerator, f.denominator


# ---------------------------------------------------------------------------
# Worker helpers (picklable, top-level)
# ---------------------------------------------------------------------------


def _day_codes(ts_ns: np.ndarray[Any, np.dtype[Any]]) -> np.ndarray[Any, np.dtype[Any]]:
    """CME session date per bar (docs §6.1): a session runs 18:00 ET the
    prior day to 17:00 ET that day, so bars at/after 18:00 ET belong to the
    NEXT calendar day's session. Returns int32 YYYYMMDD codes."""
    s = pd.Series(pd.to_datetime(ts_ns, unit="ns", utc=True)).dt.tz_convert(ET)
    day = s.dt.normalize() + pd.to_timedelta((s.dt.hour >= 18).astype(int), unit="D")
    return (
        day.dt.year.astype(np.int32) * 10000
        + day.dt.month.astype(np.int32) * 100
        + day.dt.day.astype(np.int32)
    ).to_numpy(dtype=np.int32)


def _fmt_day(code: int) -> str:
    return f"{code // 10000:04d}-{code // 100 % 100:02d}-{code % 100:02d}"


# CME quarterly contract cycle: H=Mar, M=Jun, U=Sep, Z=Dec.
_MONTH_Q = {"H": 0, "M": 1, "U": 2, "Z": 3}
_Q_MONTH = "HMUZ"
_SYM_RE = __import__("re").compile(r"^([A-Z]+?)([HMUZ])([0-9]{1,2})$")


def _sym_quarter(sym: str) -> tuple[str, int] | None:
    """Return (root, quarter_index) for a contract symbol like "ESM8" or
    "NQZ26", or None if it doesn't parse."""
    m = _SYM_RE.match(sym)
    if not m:
        return None
    root, mcode, year = m.group(1), m.group(2), int(m.group(3))
    return root, _MONTH_Q[mcode] + year * 4


def _sym_from_quarter(root: str, qi: int) -> str:
    return f"{root}{_Q_MONTH[qi % 4]}{qi // 4 % 10}"


def resolve_symbol(mappings: Any, iid: int, date) -> str:
    """Resolve an instrument_id to its single contract symbol at a given date,
    expanding Databento's range entries (e.g. "ESM8-ESU8" maps consecutive
    instrument_ids to consecutive quarterly contracts)."""
    for key, entries in mappings.items():
        parts = key.split("-")
        for e in entries:
            base = int(e["symbol"])
            if not (e["start_date"] <= date <= e["end_date"]):
                continue
            if len(parts) == 1:
                if iid == base:
                    return key
                continue
            s0 = _sym_quarter(parts[0])
            s1 = _sym_quarter(parts[1])
            if not s0 or not s1 or s0[0] != s1[0]:
                continue
            off = iid - base
            if 0 <= off <= s1[1] - s0[1]:
                return _sym_from_quarter(s0[0], s0[1] + off)
    return "?"


def worker_pass_a(payload: dict[str, Any]) -> dict[str, Any]:
    """Aggregate one chunk: daily volume per (day, contract code), max ts per
    contract, end-of-session ts per day. Pure numpy."""
    day = payload["day"]
    code = payload["code"]
    vol = payload["v"]
    ts = payload["ts"]

    # composite key must cleanly separate day and instrument_id: instrument
    # ids reach 42M+, so a 1e6 multiplier collides. Use (day << 32) | code.
    key = (day.astype(np.int64) << 32) | code.astype(np.int64)
    uniq, inv = np.unique(key, return_inverse=True)
    sums = np.zeros(len(uniq), dtype=np.int64)
    np.add.at(sums, inv, vol)

    vol_by_day: dict[int, dict[int, int]] = {}
    for i, k in enumerate(uniq):
        d, s = int(k >> 32), int(k & 0xFFFFFFFF)
        vol_by_day.setdefault(d, {})[s] = int(sums[i])

    max_ts: dict[int, int] = {}
    for s in np.unique(code):
        max_ts[int(s)] = int(ts[code == s].max())

    day_end: dict[int, int] = {}
    for d in np.unique(day):
        day_end[int(d)] = int(ts[day == d].max())

    return {"vol": vol_by_day, "max_ts": max_ts, "day_end": day_end}


def worker_pass_b(payload: dict[str, Any]) -> dict[str, Any]:
    """Filter one chunk to the front contract per day, convert fixed-point
    prices to ticks, validate. Returns kept column arrays."""
    day = payload["day"]
    code = payload["code"]
    front = payload["front"]  # ndarray: front contract code per row
    keep = code == front
    if not keep.any():
        return {"n": 0}
    t = payload["ts"][keep]
    tick_inv = payload["tick_inv"]
    o = np.rint(payload["o"][keep] / 1e9 * tick_inv).astype(np.int64)
    h = np.rint(payload["h"][keep] / 1e9 * tick_inv).astype(np.int64)
    lo = np.rint(payload["l"][keep] / 1e9 * tick_inv).astype(np.int64)
    c = np.rint(payload["c"][keep] / 1e9 * tick_inv).astype(np.int64)
    v = payload["v"][keep].astype(np.int64)
    bad = (lo > o) | (lo > c) | (h < o) | (h < c)
    if bad.any():
        i = int(np.argmax(bad))
        raise ValueError(
            f"OHLC violation ts={t[i]}: o={o[i]} h={h[i]} l={lo[i]} c={c[i]}"
        )
    if (v < 0).any():
        raise ValueError("negative volume")
    return {
        "n": int(keep.sum()),
        "ts": t.astype(np.uint32),
        "o": o.astype(np.int32),
        "h": h.astype(np.int32),
        "l": lo.astype(np.int32),
        "c": c.astype(np.int32),
        "v": v.astype(np.uint32),
        "day": day[keep],
    }


# ---------------------------------------------------------------------------
# Rollover
# ---------------------------------------------------------------------------


def pick_fronts(
    vol_by_day: dict[int, dict[int, int]],
    max_ts_contract: dict[int, int],
    day_end: dict[int, int],
) -> tuple[dict[int, int], list[dict[str, Any]]]:
    """Volume rollover: front contract (by symbol code) per session date."""
    dates = sorted(vol_by_day)
    if not dates:
        return {}, []

    front_by_day: dict[int, int] = {}
    rolls: list[dict[str, Any]] = []
    incumbent_expiry = -1
    day_index = {d: i for i, d in enumerate(dates)}

    for d in dates:
        cand = []
        for sym, v in vol_by_day[d].items():
            if v <= 0:
                continue
            expiry = max_ts_contract[sym]
            if expiry < day_end[d]:
                continue
            if expiry < incumbent_expiry:
                continue
            cand.append((sym, v, expiry))
        if not cand:
            cand = [
                (sym, v, max_ts_contract[sym])
                for sym, v in vol_by_day[d].items()
                if v > 0
            ]
        if not cand:
            continue
        sym = max(cand, key=lambda x: (x[1], x[2]))[0]
        i = day_index[d]
        if front_by_day and i > 0 and sym != front_by_day.get(dates[i - 1], -1):
            rolls.append(
                {
                    "date": _fmt_day(d),
                    "from": front_by_day.get(dates[i - 1]),
                    "to": sym,
                }
            )
        incumbent_expiry = max(incumbent_expiry, max_ts_contract[sym])
        front_by_day[d] = sym

    return front_by_day, rolls


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--input",
        action="append",
        required=True,
        help="Databento .dbn.zst (NQ.FUT/YM.FUT ohlcv-1m, or an equity raw_symbol). "
        "Repeatable; each value may be a glob. Multiple files whose date ranges "
        "overlap are merged with duplicate (ts, instrument_id) bars dropped, so "
        "separately-downloaded history chunks concatenate into one series.",
    )
    ap.add_argument(
        "--out", required=True, help="data dir (creates bin/ and meta/ inside)"
    )
    ap.add_argument("--symbol", default="NQ")
    ap.add_argument(
        "--kind",
        default="future",
        choices=["future", "stock"],
        help="instrument kind recorded in symbols.json; future rolls contracts "
        "across quarterly expiries, stock keeps the single listed instrument",
    )
    ap.add_argument("--tf", default="1m")
    ap.add_argument("--tick-size", type=float, default=0.25)
    ap.add_argument("--point-value", type=float, default=20.0)
    ap.add_argument("--name", default="E-mini Nasdaq-100")
    ap.add_argument("--commission", type=float, default=2.09)
    ap.add_argument("--slippage-ticks", type=int, default=1)
    ap.add_argument(
        "--jobs",
        type=int,
        default=max(1, os.cpu_count() or 1),
        help="worker processes for aggregation/filtering (default: cpu count)",
    )
    ap.add_argument(
        "--progress", action="store_true", help="print per-chunk progress lines"
    )
    ap.add_argument(
        "--max-chunks",
        type=int,
        default=0,
        help="stop after N chunks (smoke test; 0=all)",
    )
    args = ap.parse_args()

    inputs: list[str] = []
    for pat in args.input:
        inputs.extend(sorted(glob.glob(pat)))
    if not inputs:
        print(f"error: no input files matched {args.input}", file=sys.stderr)
        return 1

    input_path = Path(inputs[0])
    out_dir = Path(args.out)
    bin_dir, meta_dir = out_dir / "bin", out_dir / "meta"
    bin_dir.mkdir(parents=True, exist_ok=True)
    meta_dir.mkdir(parents=True, exist_ok=True)
    tick_inv = 1.0 / args.tick_size

    t0 = time.time()
    print(f"[1/4] decoding {len(inputs)} file(s) (jobs={args.jobs}) ...", flush=True)
    # Multiple stores may share instrument_ids (Databento ids are global per
    # listing), but their mappings are era-disjoint (a 2010-2014 file's
    # contracts never collide with a 2014-2026 file's), so a plain merge is
    # safe; the union is what the rollover resolver needs across the boundary.
    mappings: dict[str, Any] = {}
    payloads: list[dict[str, Any]] = []
    n_records = 0
    for input_path_str in inputs:
        store = read_dbn(input_path_str)
        mappings.update(store.mappings)
        for chunk in store.to_df(
            pretty_ts=False, map_symbols=True, price_type="fixed", count=CHUNK
        ):
            ts_ns = chunk.index.to_numpy(dtype=np.int64)
            iids = chunk["instrument_id"].to_numpy(dtype=np.int32)
            payloads.append(
                {
                    "ts": ts_ns // NS_PER_SEC,
                    "code": iids,
                    "day": _day_codes(ts_ns),
                    "o": chunk["open"].to_numpy(dtype=np.int64),
                    "h": chunk["high"].to_numpy(dtype=np.int64),
                    "l": chunk["low"].to_numpy(dtype=np.int64),
                    "c": chunk["close"].to_numpy(dtype=np.int64),
                    "v": chunk["volume"].to_numpy(dtype=np.int64),
                }
            )
            n_records += len(ts_ns)
            if args.progress:
                print(
                    f"      decoded chunk {len(payloads)} ({n_records:,} records, "
                    f"{time.time() - t0:.0f}s)",
                    flush=True,
                )
            if args.max_chunks and len(payloads) >= args.max_chunks:
                break
        if args.progress:
            print(
                f"      {Path(input_path_str).name}: {sum(len(p['ts']) for p in payloads):,} "
                f"records so far ({time.time() - t0:.0f}s)",
                flush=True,
            )
        if args.max_chunks and len(payloads) >= args.max_chunks:
            break

    # Dedupe across files: overlapping downloads (e.g. a 2010-2014 file next to
    # a 2014-2026 file sharing 2014-01-01..03) carry identical bars for the
    # same (ts, instrument_id). Keep the first occurrence so the merged series
    # stays strictly ts-increasing and never double-counts volume.
    if len(inputs) > 1:
        lengths = [len(p["ts"]) for p in payloads]
        offsets = np.concatenate([[0], np.cumsum(lengths)])
        all_keys = np.concatenate(
            [
                (p["ts"].astype(np.int64) << 32) | p["code"].astype(np.int64)
                for p in payloads
            ]
        )
        _, first_global = np.unique(all_keys, return_index=True)
        keep = np.zeros(len(all_keys), dtype=bool)
        keep[first_global] = True
        deduped: list[dict[str, Any]] = []
        for i, p in enumerate(payloads):
            sl = keep[offsets[i] : offsets[i + 1]]
            deduped.append({k: v[sl] if not sl.all() else v for k, v in p.items()})
        n_before = n_records
        n_records = int(keep.sum())
        payloads = deduped
        print(
            f"      deduped {n_before - n_records:,} overlapping bars "
            f"({n_records:,} unique, {time.time() - t0:.0f}s)",
            flush=True,
        )
    print(
        f"      records: {n_records:,} ({time.time() - t0:.0f}s)",
        flush=True,
    )

    # ---- pass A: daily volumes (parallel, order-independent) --------------
    # Skipped for stocks: a single instrument needs no rollover — ITCH even
    # re-lists the same symbol under a fresh instrument_id almost every day,
    # so the futures quarterly-contract model does not apply.
    is_stock = args.kind == "stock"
    vol_by_day: dict[int, dict[int, int]] = {}
    max_ts_contract: dict[int, int] = {}
    day_end: dict[int, int] = {}
    mp_ctx = multiprocessing.get_context("spawn")
    if not is_stock:
        print("[2/4] pass A: daily volumes per contract ...", flush=True)
        with ProcessPoolExecutor(max_workers=args.jobs, mp_context=mp_ctx) as pool:
            a_futs = [pool.submit(worker_pass_a, p) for p in payloads]
            done = 0
            for fut in as_completed(a_futs):
                r = fut.result()
                for d, m in r["vol"].items():
                    tgt = vol_by_day.setdefault(d, {})
                    for s, v in m.items():
                        tgt[s] = tgt.get(s, 0) + int(v)
                for s, t in r["max_ts"].items():
                    if t > max_ts_contract.get(s, 0):
                        max_ts_contract[s] = int(t)
                for d, t in r["day_end"].items():
                    if t > day_end.get(d, 0):
                        day_end[d] = int(t)
                done += 1
                if args.progress and done % 5 == 0:
                    print(
                        f"      pass A merged {done}/{len(a_futs)} chunks "
                        f"({time.time() - t0:.0f}s)",
                        flush=True,
                    )
        print(
            f"      session days: {len(day_end)} ({time.time() - t0:.0f}s)",
            flush=True,
        )

    # ---- rollover ---------------------------------------------------------
    if is_stock:
        front_by_day: dict[int, int] = {}
        rolls: list[dict[str, Any]] = []
        days_sorted: np.ndarray[Any, np.dtype[Any]] = np.array([], dtype=np.int32)
        fronts_sorted: np.ndarray[Any, np.dtype[Any]] = np.array([], dtype=np.int32)
        print("[2,3/4] single-instrument: skipping volume rollover", flush=True)
    else:
        print("[3/4] volume rollover ...", flush=True)
        from datetime import date as _date

        def _sym_for_roll(iid: int, dstr: str) -> str:
            y, m, d = map(int, dstr.split("-"))
            return resolve_symbol(mappings, iid, _date(y, m, d))

        front_by_day, rolls = pick_fronts(vol_by_day, max_ts_contract, day_end)
        # drop "self-rolls": two distinct instrument_ids that resolve to the same
        # contract symbol (Databento splits one contract into multiple stubs)
        rolls = [
            r
            for r in rolls
            if _sym_for_roll(r["from"], r["date"]) != _sym_for_roll(r["to"], r["date"])
        ]
        print(
            f"      fronts: {len(front_by_day)} days, rolls: {len(rolls)}", flush=True
        )
        for r in rolls[:6]:
            print(
                f"      roll {r['date']}: {_sym_for_roll(r['from'], r['date'])} "
                f"-> {_sym_for_roll(r['to'], r['date'])}",
                flush=True,
            )
        for r in rolls:
            r["from"] = _sym_for_roll(r["from"], r["date"])
            r["to"] = _sym_for_roll(r["to"], r["date"])

        # vectorized day -> front-code lookup (no Python row loop)
        days_sorted = np.array(sorted(day_end), dtype=np.int32)
        fronts_sorted = np.array(
            [front_by_day.get(d, -1) for d in days_sorted], dtype=np.int32
        )

    # ---- pass B: filter to front (keep-all for stocks), convert ticks ----
    print("[4/4] pass B: stitch bars -> RBR1 ...", flush=True)

    def front_for(
        day: np.ndarray[Any, np.dtype[Any]],
    ) -> np.ndarray[Any, np.dtype[Any]]:
        pos = np.searchsorted(days_sorted, day)
        return fronts_sorted[np.clip(pos, 0, len(days_sorted) - 1)]

    col_ts: list[np.ndarray[Any, np.dtype[Any]]] = []
    col_o: list[np.ndarray[Any, np.dtype[Any]]] = []
    col_h: list[np.ndarray[Any, np.dtype[Any]]] = []
    col_l: list[np.ndarray[Any, np.dtype[Any]]] = []
    col_c: list[np.ndarray[Any, np.dtype[Any]]] = []
    col_v: list[np.ndarray[Any, np.dtype[Any]]] = []
    session_bars: dict[int, int] = {}

    with ProcessPoolExecutor(max_workers=args.jobs, mp_context=mp_ctx) as pool:
        b_futs = []
        for i, p in enumerate(payloads):
            b_payload: dict[str, Any] = {**p, "tick_inv": tick_inv}
            if is_stock:
                b_payload["front"] = p["code"]
            else:
                b_payload["front"] = front_for(p["day"])
            b_futs.append((i, pool.submit(worker_pass_b, b_payload)))
        for idx, fut in sorted(b_futs):
            r = fut.result()
            if r["n"] == 0:
                continue
            col_ts.append(r["ts"])
            col_o.append(r["o"])
            col_h.append(r["h"])
            col_l.append(r["l"])
            col_c.append(r["c"])
            col_v.append(r["v"])
            uday, cnt = np.unique(r["day"], return_counts=True)
            for d, n in zip(uday, cnt):
                session_bars[int(d)] = session_bars.get(int(d), 0) + int(n)

    n_kept = sum(len(a) for a in col_ts)
    # Multi-input runs can leave the file-boundary overlap out of time order
    # (two downloads sharing 2014-01-01..03 keep interleaved chunks); the
    # front-series has one bar per minute, so a stable global sort by ts makes
    # the merged series strictly increasing.
    if n_kept:
        ts_all = np.concatenate(col_ts)
        if len(inputs) > 1:
            order = np.argsort(ts_all, kind="stable")
            ts_all = ts_all[order]
            col_ts = [ts_all]
            col_o = [np.concatenate(col_o)[order]]
            col_h = [np.concatenate(col_h)[order]]
            col_l = [np.concatenate(col_l)[order]]
            col_c = [np.concatenate(col_c)[order]]
            col_v = [np.concatenate(col_v)[order]]
        if np.any(np.diff(ts_all) <= 0):
            print("      !! series not strictly increasing", file=sys.stderr)
            return 1
        first_ts = int(ts_all[0])
        last_ts = int(ts_all[-1])
    else:
        first_ts = last_ts = None
    print(f"      kept {n_kept:,} bars ({time.time() - t0:.0f}s)", flush=True)

    # ---- write RBR1 .bin -------------------------------------------------
    bin_path = bin_dir / f"{args.symbol}.{args.tf}.bin"
    header = bytearray(RBR1_HEADER_SIZE)
    header[0:4] = RBR1_MAGIC
    struct.pack_into("<H", header, 4, RBR1_VERSION)
    struct.pack_into("<H", header, 6, RBR1_FLAG_PRICE_AS_TICKS)
    struct.pack_into("<I", header, 8, n_kept)
    tick_num, tick_den = _tick_frac(args.tick_size)
    struct.pack_into("<i", header, 12, tick_num)
    struct.pack_into("<i", header, 16, tick_den)
    with open(bin_path, "wb") as f:
        f.write(header)
        for col in (col_ts, col_o, col_h, col_l, col_c, col_v):
            f.write(np.concatenate(col).tobytes())
    print(
        f"      wrote {bin_path} ({n_kept:,} bars, {bin_path.stat().st_size:,} bytes)",
        flush=True,
    )

    # ---- write .idx (session date -> bar-index range, docs §6.3) ---------
    idx_map: dict[str, dict[str, int]] = {}
    off = 0
    for d in sorted(session_bars):
        cnt = session_bars[d]
        idx_map[_fmt_day(d)] = {"offset": off, "count": cnt}
        off += cnt
    idx_path = bin_dir / f"{args.symbol}.{args.tf}.idx"
    idx_path.write_text(json.dumps(idx_map, separators=(",", ":")))
    print(f"      wrote {idx_path} ({len(idx_map)} days)", flush=True)

    # ---- write rolls.json (roll markers, docs risk #11) ------------------
    rolls_path = bin_dir / f"{args.symbol}.{args.tf}.rolls.json"
    rolls_path.write_text(
        json.dumps(
            {
                "symbol": args.symbol,
                "tf": args.tf,
                "rollRule": "volume",
                "rolls": rolls,
            },
            indent=1,
        )
    )
    print(f"      wrote {rolls_path} ({len(rolls)} roll events)", flush=True)

    # ---- write meta/symbols.json (server's single source of truth, N5) ----
    sym = {
        "symbol": args.symbol,
        "name": args.name,
        "kind": args.kind,
        "tickSize": args.tick_size,
        "pointValue": args.point_value,
        "currency": "USD",
        "priceDecimals": 2,
        "sessionTz": "America/New_York",
        "rollRule": "volume",
        "commissionPerSide": args.commission,
        "defaultSlippageTicks": args.slippage_ticks,
        "ranges": {args.tf: {"from": first_ts, "to": last_ts}},
    }
    symbols_path = meta_dir / "symbols.json"
    existing = json.loads(symbols_path.read_text()) if symbols_path.exists() else []
    existing = [e for e in existing if e.get("symbol") != args.symbol]
    existing.append(sym)
    existing.sort(key=lambda e: e["symbol"])
    symbols_path.write_text(json.dumps(existing, indent=1) + "\n")
    print(f"      wrote {symbols_path}", flush=True)

    print(
        f"DONE: {n_kept:,} bars, {len(front_by_day)} sessions, "
        f"{len(rolls)} rolls, {time.time() - t0:.0f}s total",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
