# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is the owner: a discretionary trader in Vietnam who practices historical market sessions, reviews decisions, and builds execution discipline without connecting a live broker. This is a single-user product.

## Product Purpose

Market Replay turns local historical OHLCV data into a responsive bar-by-bar practice environment with manual paper trading. Success means the user can jump to a historical session, replay it without future-data leakage, place deterministic simulated orders, annotate the chart, and review the resulting journal.

## Positioning

The product combines a chart-first replay workstation, deterministic one-minute fill simulation, and spoiler-safe drawings. Unlike a generic chart viewer, every visible bar, order fill, and in-replay annotation is constrained by the replay cursor.

## Operating Context

The user works primarily on a desktop trading workstation with keyboard-first controls, often for long focused sessions. The product consumes only files already loaded into the owner's backend and never calls a market-data provider or broker at runtime. It should remain usable for replay and simulated trading after the active symbol has loaded, even if persistence is temporarily offline.

## Capabilities and Constraints

- Symbols: NQ, ES, YM, QQQ, SPY, and VIX, driven by backend metadata rather than frontend constants.
- Timeframes: 1m, 5m, 15m, 1h, and 1d.
- Replay: play, pause, step, rewind, speed control, date seek, and session resume.
- Trading: market, limit, and stop orders; bracket SL/TP; pyramiding; flatten; reverse; integer tick and cent math.
- Analysis: drawing tools, Analysis/Replay buckets, study list, watchlist, indicators, and trade statistics.
- No realtime market feed, broker API, auth, subscriptions, multi-user behavior, or automated strategies in the MVP.
- Frontend communicates only with the project's Go backend.

Open decisions retained from the approved architecture plan: whether eager mode is always enabled on metered connections, the practical drawing-count cap, and whether tick/L2 replay belongs in a future roadmap.

## Brand Commitments

The product name is Market Replay. The interface should feel like a serious trading workstation: chart-first, dense but legible, keyboard-driven, and free of gamification or promotional language. Functional familiarity with TradingView is useful, but the product must not use or imitate proprietary TradingView assets or libraries.

## Evidence on Hand

- The approved architecture and implementation plan live under `.omo/plans/`.
- Backend contracts and persistence are implemented under `internal/httpapi`, `internal/model`, and `internal/storage`.
- The frontend scaffold lives under `web/`.
- No customer claims, performance claims beyond the plan's explicit gates, testimonials, or external brand assets are available and none should be fabricated.

## Product Principles

- Never reveal market data or replay annotations beyond the current cursor.
- Keep replay simulation outside React and chart rendering to at most one mutation per series per animation frame.
- Prefer truthful deterministic behavior over invented market realism.
- Make primary replay and trading actions fully keyboard-operable.
- Fail visibly and recoverably when local data or persistence is unavailable.

## Accessibility & Inclusion

Meet WCAG AA. All controls require semantic labels, visible keyboard focus, non-color state cues, reduced-motion behavior, and usable layouts at 375px, 768px, and 1440px widths.
