---
name: Market Replay
description: A chart-first historical trading practice workstation.
fontFamilies: [Roboto Variable, JetBrains Mono Variable]
colors: ["#131722", "#1e222d", "#2a2e39", "#434651", "#d1d4dc", "#898c96", "#2962ff", "#5b8cff", "#089981", "#22ab94", "#f23645", "#ff5563"]
---

# Design System: Market Replay

## Overview

**Creative North Star: "The Replay Desk"**

Market Replay is a purpose-built replay desk used during long, focused market-review sessions: charts are the work surface, controls form a compact perimeter, and every state is communicated with precise, low-noise signals. Its density, interaction vocabulary, and dark blue-black palette should feel immediately familiar to TradingView users without copying proprietary assets, icons, or chrome.

The visual grammar is flat, compact, and operational. Data earns the highest contrast; navigation and secondary metadata recede. Motion is reserved for cursor/replay state, order feedback, panel transitions, and one restrained startup reveal. Decorative effects never compete with price action.

**Key Characteristics:**

- Chart-first hierarchy with minimal chrome.
- Dense, aligned controls with generous target sizes.
- Restrained blue-black surfaces with one blue interaction accent and sparse semantic trading color.
- Numeric data uses tabular figures and stable widths.
- Responsive composition preserves the chart before secondary panels.

## Colors

Use a restrained strategy: blue-black neutrals form the workstation, electric blue identifies focus and active tools, and trading state uses distinct profit/loss colors with text or icons as redundant cues.

- `surface-0` / `chart` `#131722`: page and uninterrupted plotting surface.
- `surface-1` `#1e222d`: persistent panels, menus, and transport chrome.
- `surface-2` `#252934`: fields and raised controls.
- `surface-3` / `line` `#2a2e39`: hover state, separators, and default grid.
- `line-strong` `#434651`: focused-adjacent borders and strong dividers.
- `ink` `#d1d4dc`, `muted` `#a3a6af`, `dim` `#898c96`: AA-calibrated text hierarchy. `#787b86` is reserved for disabled/non-text chrome, never meaningful small text.
- `active` `#2962ff` is the selected fill/focus blue; `active-bright` `#5b8cff` is its AA-safe foreground-text counterpart.
- Candle/area semantics keep `profit` `#089981` and `loss` `#f23645`; small foreground text uses `profit-bright` `#22ab94` and `loss-bright` `#ff5563`.
- `active` `#2962ff`: focus, active tool, selected tab, and replay-live signal.
- `profit` `#089981`, `loss` `#f23645`: directional and P&L states.

**The Sparse Signal Rule.** Accent color identifies action or live state, never decoration.

## Typography

Use the self-hosted **Roboto Variable** face for every interface and chart-canvas label, with the platform UI stack only as fallback. JetBrains Mono Variable is reserved for timestamps, prices, P&L, shortcuts, and stable numeric fields. The role scale stays compact without sacrificing long-session readability: **12/17px metadata**, **13/20px body**, **14/20px controls**, and **15/22px titles/symbols**. Avoid one-off 9px and 10px labels; hierarchy comes from role, weight, tone, and spacing rather than shrinking important information. Body uses 400, interactive controls 500, and headings 600; 700 is reserved for evaluation outcomes or similarly exceptional emphasis.

**The Stable Number Rule.** Price, time, quantity, and money always use tabular figures so the interface does not jitter as values change.

## Layout

Desktop uses a three-part workstation: a dominant chart and drawing rail, a fixed-width right operations panel, and a full-width replay transport. At tablet sizes the operations panel becomes a collapsible rail. At 375px the chart remains primary, replay controls stay reachable at the bottom, and secondary tools move into tabs or sheets rather than shrinking into unusable columns.

Spacing is compact inside control groups and visibly larger between unrelated workflows. Touch targets remain at least 44px even when their visual glyph is smaller.

## Elevation & Depth

The system is flat by default. Depth comes from adjacent tonal surfaces and hairline separators; shadows appear only for transient overlays that must sit above the chart.

**The Work-Surface Rule.** Persistent panels never float over the chart on desktop; overlays are reserved for temporary tasks.

## Shapes

Corners are modest and mechanical, with small radii on controls and slightly larger radii only on transient overlays. Pills are reserved for compact state or filter controls. Dividers are thin and low contrast.

## Components

- **Tool button:** 32px visual control with a 44px accessible target on touch layouts; neutral by default and blue when pressed.
- **Brand mark:** a counter-clockwise replay loop wraps three compact candlesticks. The loop leads in interaction blue while profit, active, and loss candles identify the market context; it remains legible as a 32px app mark and favicon without decorative effects.
- **Trade button:** 40px minimum height, label and shortcut aligned at opposite edges, always includes BUY/SELL text in addition to color.
- **Secondary button:** bordered graphite control for reversible actions; disabled state remains legible and non-interactive.
- **Field:** dark inset surface with mono numeric content, explicit label, and blue focus border.
- **Replay transport:** Replay is absent from the chart layout while inactive. Pressing the top Replay command enters a direct chart-selection mode: the pointer snaps to the nearest candle, a blue selection guide and future wash preview the cut, and Left/Right + Enter provides the same selection without a mouse. The guide disappears after commit so the active replay start does not leave a permanent blue line over price. A 48px chart-scoped bottom dock appears while selecting or active, never as a permanent app footer. Playback controls remain disabled until a candle is committed; active replay keeps Bar replay, a 1x–16x speed slider, previous interval, Play/Pause, the 1m–4h replay interval, and next interval in one centered flat group. Play/Pause is the only filled transport control. Status/time sit quietly at left and the date control at right; account equity belongs to Evaluation rather than transport. Session lifecycle belongs to the Sessions panel, so the transport has no ambiguous close icon. Secondary metadata disappears before controls compress on narrow screens.
- **Layout menu:** one icon-only control at the far-right end of the top command strip. Its transient panel owns preset selection, add/remove, and named local snapshots. A snapshot restores the split tree, splitter ratios, active pane, per-pane timeframe, and chart settings as one unit.
- **Interval menu:** starred intervals stay directly visible on the command strip and are always ordered from shortest to longest; a compact chevron opens the complete categorized interval list, with numeric values ascending inside each unit group. The portal must be positioned before its first paint so opening never flashes at a fallback viewport corner. Custom intervals are created in a focused Type + Interval dialog, never in a crowded inline toolbar field.
- **Chart reset:** every timeframe commit and the chart-scoped right-click **Reset chart view** action share one reset path: price returns to auto-scale, candle spacing returns to 7px with 12 bars of right breathing room, and the visible range targets 60–160 candles based on pane width. Reset never fits the complete history.
- **Operations panel:** fixed desktop rail and scrollable mobile tab surface; it never overlays the chart persistently. Sessions is the replay registry, Evaluation owns eval accounts, and Review is the shared per-trade review workspace for both source types.
- **Trade Review:** Review is a contextual action shown only for the active replay session or live evaluation, never a permanent workspace tab. It opens in the standard-width operations rail, becomes a contained sheet on narrow screens, and can detach into a separate browser window for extended writing. It uses real closed trades ordered newest first, a compact two-line trade row without redundant size copy, search, a month-navigable activity list, Markdown notes, current-chart screenshots, compact reusable tag groups, and a complete execution Details view. User-authored review metadata persists independently from the immutable trade ledger and is keyed by source type, source ID, and trade ID.
- **Trade history table:** Sessions and Evaluation use the same semantic, fixed-layout table ordered newest first. The four stable columns are Trade, Time, MFE/MAE, and P&L/R; trade dates always include the year, numeric cells use tabular mono figures, direction and result pair color with text/sign, and loading or empty histories preserve the same section frame.
- **Closed position visual:** the risk/reward fills preserve the original SL/TP range without drawing initial Stop, Entry, or Target reference lines or labels. The execution connector, actual exit, fitted trailing/actual-TP marks, LONG/SHORT direction, and R:R summary remain visible above the fills.
- **Replay sessions:** a replay session is created only after a start bar is committed, never during workspace boot. The Sessions tab is a flat registry with a stable six-character display hash, exactly one `ACTIVE` session, resumable `PAUSED` sessions, terminal `STOPPED` sessions, core equity/performance statistics, and closed-trade history. Selecting a row only inspects it; Resume is explicit and checkpoints the previously active session first. Active sessions are checkpointed to `PAUSED` on exit or reload. Deleting an inactive session requires confirmation and removes its private trades and replay-scoped drawings. Timeline Play/Pause controls playback only and never change the session lifecycle. Trading actions and trade-ledger writes are accepted only for the active replay session (or a live evaluation). Session metrics stay inside the Sessions tab; the bottom replay dock remains transport-only.
- **Evaluation accounts:** the Evaluation tab owns a flat account registry, ready/live/paused/pass/fail state, balance and equity metrics, rule buffers, and closed-trade history. Creating an account through the dedicated setup route leaves it `READY`: no metrics or history start until the user explicitly presses **Start Eval**. Reloading or switching away from an in-progress account restores it as `PAUSED` and requires **Resume Eval**, preserving the saved replay boundary and evaluation runtime without silently advancing the account. Only a `LIVE` account receives the flat, full-width information strip at the bottom of the workspace with equity, target, loss buffers, trading days, and an explicit **Exit Eval** action. Exit checkpoints the account as `PAUSED` in the registry and clears the current session without deleting progress. The strip is absent for `READY`, `PAUSED`, terminal, `idle`, and saved accounts that are not current; it never floats over the chart.
- **Chart annotation:** blue default line treatment; replay and analysis scope is communicated in the toolbar and persisted as separate buckets. Drawing tools are one-shot. Selecting a drawing freezes chart navigation and immediately opens a compact, workspace-bounded contextual toolbar above the chart. Its ordered actions are move, templates, color, capability-specific quick controls, properties, lock, and remove; unsupported controls are omitted through a per-drawing configuration rather than disabled. Template, palette, and line-width choices use focused popovers, while Properties opens the full inspector. The contextual toolbar is pointer-draggable and keyboard-movable, persists one shared chart-relative position across every drawing selection and reload, has no overflow/more action, and remains horizontally scrollable on narrow chart widths. Its saved position is independent from the favorites toolbar even though both drag handles use the same interaction contract. The property inspector covers geometry, stroke, fill, opacity, extension, and attached text. On desktop and tablet the inspector is workspace-bounded, keyboard-movable, draggable from its title bar, and layered above chart splitters; property groups appear as tabs with only one group open at a time. Narrow screens keep the inspector as a contained sheet instead of exposing freeform drag.
- **Drawing rail and favorites:** one workspace-level drawing rail stays fixed to the full chart grid's left edge and remains visible while market data loads; individual panes never mount their own copy. It always targets the active pane. Starred drawing tools persist locally and appear in one compact floating bar that can be dragged across the full chart workspace; its last position is restored and clamped when the workspace resizes. Destructive actions remain behind an explicit selected/all choice. On narrow screens its inspector becomes a workspace-contained bottom sheet.
- **Chart settings:** pane-owned dialog/sheet with live preview, explicit Apply/Cancel/Reset, paired picker + hex input for every color, candle/grid/volume controls, and display timezone. User settings override defaults; reset returns to this design system.
- **Chart identity and OHLC legend:** the symbol/timeframe chip at the upper-left of every pane is interactive and opens a compact symbol + interval selector. Symbol changes apply to the shared workspace instrument; interval changes apply to that pane. Beside it, a compact per-pane readout uses tabular figures. Hovering a candle reveals its full date including year plus minute-precision time and OHLC values. Timezone abbreviations and seconds stay hidden; whitespace falls back to the last replay bar in a muted state.
- **Icons:** one Lucide outline family, 16px inline and 18px primary toolbar, stroke 1.5–1.75. Never copy TradingView SVGs or mix icon families.

## Interaction & Motion

Transitions are 100–120ms ease-out for state feedback. The only repeating motion is the replay-state pulse. Pointer drawing, draggable drawing anchors, draggable order lines, Shift-click limits, Ctrl-click stops, and keyboard trading shortcuts remain subordinate to semantic buttons so every primary action has a discoverable, accessible path. Activating a drawing tool pauses replay and locks chart navigation until the one-shot drawing completes; selecting an existing drawing locks navigation until deselection so anchor edits never pan the chart. Reduced-motion preferences collapse animations and transitions to effectively zero.

**The Replay Selection Rule.** Replay owns an explicit `inactive → selecting → active` state machine outside React. Selecting locks chart pan/scale and drawing placement, broadcasts the preview mode to every pane, and commits the first real raw bar at or after the selected display-candle boundary. Escape restores the previous active replay start when one exists. Replay session exit/pause/stop is explicit in the Sessions panel rather than an unlabeled transport-edge icon. Timeframe switches project the canonical timestamp into the containing candle without recreating chart infrastructure.

**The Multi-Pane Synchronization Rule.** Crosshair time/price and visible time/price ranges are shared across every mounted pane. Horizontal view synchronization uses epoch time rather than logical candle indexes, so each timeframe renders the appropriate number of bars for the same real-world interval. Programmatic fan-out excludes the source pane and is guarded against feedback loops.

**The Timeframe Continuity Rule.** Timeframe controls acknowledge the user's latest selection immediately, while rapid consecutive selections are coalesced at the chart-engine boundary. The existing chart shell and candles remain mounted until the final history is ready; switching timeframe must never flash an empty plot, recreate canvas infrastructure, refetch unchanged drawings, or process superseded selections.

**The Historical Viewport Rule.** Panning loads bounded pages into a timeframe-specific display history without moving or pruning the replay cursor's raw window. A candle is immutable for a given timestamp once rendered; overlapping pages may add older/newer candles but never replace an existing candle with a partial bucket. New pan intent cancels stale requests across both directions.

**The Edge-Load Rule.** A pane hydrates at most 240 display candles when its current raw replay window cannot provide a useful view. After that, idle and programmatic reset issue no history requests; only user movement into a logical edge asks for another 240-candle page. Display history is capped at 6,000 candles per pane. Daily, weekly, and monthly candles are aligned to the symbol session calendar rather than fixed-duration approximations.

## Do's and Don'ts

### Do:

- **Do** keep the current symbol, timeframe, replay time, position, and transport state discoverable within one glance.
- **Do** pair profit/loss and buy/sell colors with labels, arrows, or signs.
- **Do** preserve familiar keyboard and chart interactions while giving Market Replay its own visual identity.

### Don't:

- **Don't** add gradients, glow, glass, generic metric cards, or decorative market imagery.
- **Don't** use color as the only signal for order or replay state.
- **Don't** let side panels reduce the chart below a usable plotting area.
