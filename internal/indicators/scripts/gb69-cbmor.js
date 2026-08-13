//@version=1

init = () => {
  indicator({ onMainPanel: true, format: 'inherit' });
  // ========================================================================
  // SESSION CONFIGURATION
  // ========================================================================
  input.session('Asia Session', '2000-0200', 't_asia', undefined, 'Session Configuration');
  input.session('London Session', '0200-0800', 't_london', undefined, 'Session Configuration');
  input.session(
    'NY Open Trigger Time',
    '0800-0815',
    't_ny_open',
    undefined,
    'Session Configuration',
  );
  input.session(
    'Base NY Session (For SD/ATR)',
    '0600-0900',
    'i_session1',
    undefined,
    'Session Configuration',
  );

  input.time(
    'NY Equity Open',
    930,
    'ny_equity_open',
    0,
    2359,
    'Cash equity open reference',
    'Session Configuration',
  );

  // ========================================================================
  // PROJECTION CALCULATION METHOD
  // ========================================================================
  input.str(
    'Calculation Method',
    'Base Fibo (Range)',
    'i_calc_type',
    ['Base Fibo (Range)', 'Std Dev', 'ATR'],
    undefined,
    'Projection Calculation Method',
  );

  input.float(
    'Std Dev Value / Multiplier',
    0.2,
    'i_std_value',
    0.0,
    100.0,
    0.1,
    undefined,
    'Projection Calculation Method',
  );

  input.int('ATR Length', 14, 'i_atr_len', 1, 500, 1, undefined, 'Projection Calculation Method');

  input.float(
    'ATR Multiplier',
    0.7,
    'i_atr_mult',
    0.0,
    100.0,
    0.1,
    undefined,
    'Projection Calculation Method',
  );

  // ========================================================================
  // DISPLAY CONFIG (RANGE 69)
  // ========================================================================
  input.bool('Show Projection Labels', true, 'show_labels', 'Display Config (Range 69)');
  input.bool('Show Projection Lines', true, 'show_lines', 'Display Config (Range 69)');
  input.bool('Show NY EQ Line', true, 'show_eq', 'Display Config (Range 69)');
  input.bool('Show NY Open Line (09:30)', true, 'show_open', 'Display Config (Range 69)');
  input.bool('Show POC Line', true, 'show_poc', 'Display Config (Range 69)');

  input.bool('Show Range Box', true, 'show_range_box', 'Display Config (Range 69)');
  input.bool('Show SD Boxes', true, 'show_sd_boxes', 'Display Config (Range 69)');

  // ========================================================================
  // DEVIATION LEVELS
  // ========================================================================
  input.bool('±0.5 Level (Order Control Zone)', true, 'use_sd_05', 'Deviation Levels (Range 69)');

  input.bool('±1.0 Level', false, 'use_sd_10', 'Deviation Levels (Range 69)');

  input.bool(
    '±1.33 Level (Distribution Exhaustion)',
    true,
    'use_sd_133',
    'Deviation Levels (Range 69)',
  );

  input.bool(
    '±1.66 Level (Distribution Exhaustion)',
    true,
    'use_sd_166',
    'Deviation Levels (Range 69)',
  );

  input.bool('±2.0 Level', false, 'use_sd_20', 'Deviation Levels (Range 69)');

  // ========================================================================
  // COLORS
  // ========================================================================
  input.color('GB High/Low (100/0)', color.gray, 'c_gb_highlow', 'Goldbach Colors', undefined);
  input.color(
    'GB Equilibrium (50)',
    { r: 0, g: 0, b: 255, a: 0.3 },
    'c_gb_mid',
    'Goldbach Colors',
    undefined,
  );
  input.color(
    'GB GIP Target Nodes (83/17)',
    { r: 255, g: 80, b: 0, a: 1.0 },
    'c_gb_gip',
    'Goldbach Colors',
    undefined,
  );
  input.color(
    'GB Liquidity Levels (89/11)',
    { r: 23, g: 102, b: 25, a: 1 },
    'c_gb_liq',
    'Goldbach Colors',
    undefined,
  );

  // ========================================================================
  // GOLDBACH LEVEL VISIBILITY
  // ========================================================================
  input.bool('Show GB High/Low (100/0)', true, 'show_gb_highlow', 'Goldbach Level Visibility');
  input.bool('Show GB Equilibrium (50)', true, 'show_gb_eq', 'Goldbach Level Visibility');
  input.bool('Show GB GIP Target Nodes (83/17)', true, 'show_gb_gip', 'Goldbach Level Visibility');
  input.bool('Show GB Liquidity Levels (89/11)', false, 'show_gb_liq', 'Goldbach Level Visibility');

  input.color(
    'Range Box Fill',
    { r: 128, g: 128, b: 128, a: 0.18 },
    'c_range_box_fill',
    'System Colors',
    'Base session range box fill',
  );
  input.color(
    'SD Box Fill',
    { r: 128, g: 128, b: 128, a: 0.18 },
    'c_sd_box_fill',
    'System Colors',
    'SD zone fill',
  );
  input.color(
    'Outer SD Box Fill',
    { r: 128, g: 128, b: 128, a: 0.18 },
    'c_outer_sd_box_fill',
    'System Colors',
    'Outer SD zone fill',
  );
  input.color(
    'Box Border Color',
    { r: 128, g: 128, b: 128, a: 0.5 },
    'c_border',
    'System Colors',
    'Box border color',
  );
  input.color(
    'NY Open 09:30 Line Color',
    color.black,
    'c_open',
    'System Colors',
    'NY open line color',
  );
  input.color(
    'EQ (Mid) Line Color',
    { r: 0, g: 188, b: 212, a: 1.0 },
    'c_eq',
    'System Colors',
    'EQ line color',
  );
  input.color(
    'Point of Control Line Color',
    { r: 255, g: 23, b: 68, a: 1.0 },
    'c_poc',
    'System Colors',
    'POC line color',
  );

  // ========================================================================
  // GOLDBACH RANGE 1
  // ========================================================================
  input.bool(
    'Display GB Range 1',
    true,
    'enableRange1',
    // 'Enable Goldbach range 1',
    'Goldbach Range 1',
  );
  input.int(
    'GB Range 1 Size',
    243,
    'po3_1',
    3,
    59049,
    1,
    'Goldbach range 1 size',
    'Goldbach Range 1',
  );
  input.float(
    'Shift GB 1 (max ±3)',
    0.0,
    'shift_range_1',
    -3.0,
    3.0,
    0.5,
    'Shift range 1 center',
    'Goldbach Range 1',
  );

  // ========================================================================
  // GOLDBACH RANGE 2
  // ========================================================================
  input.bool(
    'Display GB Range 2',
    true,
    'enableRange2',
    'Enable Goldbach range 2',
    'Goldbach Range 2',
  );
  input.int(
    'GB Range 2 Size',
    729,
    'po3_2',
    3,
    59049,
    1,
    'Goldbach range 2 size',
    'Goldbach Range 2',
  );
  input.float(
    'Shift GB 2 (max ±3)',
    0.0,
    'shift_range_2',
    -3.0,
    3.0,
    0.5,
    'Shift range 2 center',
    'Goldbach Range 2',
  );

  // ========================================================================
  // CB MOR PERCENTAGE LEVELS CONFIGURATION
  // ========================================================================
  input.bool('Show CB MOR Levels', true, 'show_cbmor', 'CB MOR Percentage Levels Configuration');

  input.bool('0.4375% Level', true, 'use_cbmor_p1', 'CB MOR Percentage Levels Configuration');
  input.bool('0.875% Level', true, 'use_cbmor_p2', 'CB MOR Percentage Levels Configuration');
  input.bool('1.75% Level', true, 'use_cbmor_p3', 'CB MOR Percentage Levels Configuration');
  input.bool('3.50% Level', true, 'use_cbmor_p4', 'CB MOR Percentage Levels Configuration');
  input.bool('7.00% Level', true, 'use_cbmor_p5', 'CB MOR Percentage Levels Configuration');

  // ========================================================================
  // CB MOR STYLE & COLORS
  // ========================================================================
  input.color(
    'Anchor Price Line (Open)',
    { r: 0, g: 0, b: 0, a: 0.5 },
    'c_cbmor_anchor',
    'CB MOR Style & Colors',
    'CB MOR 00:00 anchor line color',
  );
  input.color(
    '0.4375% Level Color',
    { r: 26, g: 148, b: 122, a: 1.0 },
    'c_cbmor_p1',
    'CB MOR Style & Colors',
    undefined,
  );
  input.color(
    '0.875% Level Color',
    { r: 230, g: 126, b: 34, a: 1.0 },
    'c_cbmor_p2',
    'CB MOR Style & Colors',
    undefined,
  );
  input.color(
    '1.75% Level Color',
    { r: 255, g: 80, b: 0, a: 1.0 },
    'c_cbmor_p3',
    'CB MOR Style & Colors',
    undefined,
  );
  input.color(
    '3.50% Level Color',
    { r: 255, g: 80, b: 0, a: 1.0 },
    'c_cbmor_p4',
    'CB MOR Style & Colors',
    undefined,
  );
  input.color(
    '7.00% Level Color',
    { r: 125, g: 0, b: 0, a: 1.0 },
    'c_cbmor_p5',
    'CB MOR Style & Colors',
    undefined,
  );
};

// ==========================================================================
// PERSISTENT STATE
// ==========================================================================
let prevInBaseSession = false;
let hasDrawnForSession = false;

let rangeHigh = null;
let rangeLow = null;
let nyOpenPrice = null;
let nyMarketOpenPrice = null;
let midnightOpenPrice = null;

let barPrices = [];
let barVolumes = [];

let sessionStartTime = null;
let sessionEndTime = null;

let sessionDrawingIds = [];
let cbmorDrawingIds = [];

// ==========================================================================
// HELPERS
// ==========================================================================
const mean = (arr) => {
  if (!arr || arr.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
};

const stdev = (arr) => {
  if (!arr || arr.length < 2) return 0;
  const m = mean(arr);
  let ss = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - m;
    ss += d * d;
  }
  return Math.sqrt(ss / arr.length);
};

const parseSession = (s) => {
  const parts = s.split('-');
  const start = parts[0];
  const end = parts[1];
  return {
    startH: parseInt(start.slice(0, 2), 10),
    startM: parseInt(start.slice(2, 4), 10),
    endH: parseInt(end.slice(0, 2), 10),
    endM: parseInt(end.slice(2, 4), 10),
  };
};

// NY-local hour/minute via proper IANA timezone conversion instead of manual
// UTC-offset math — handles EST/EDT transitions automatically, no more
// remembering to flip the offset input twice a year.
const getNyHourMinute = (_moment, t0) => {
  const nyTime = _moment(t0).tz('America/New_York');
  return { hour: nyTime.hour(), minute: nyTime.minute() };
};

const inSessionFromBar = (sessionStr, _moment, t0) => {
  const sess = parseSession(sessionStr);
  const hm = getNyHourMinute(_moment, t0);

  const now = hm.hour * 60 + hm.minute;
  const start = sess.startH * 60 + sess.startM;
  const end = sess.endH * 60 + sess.endM;

  if (end <= start) return now >= start || now < end;
  return now >= start && now < end;
};

const isExactBarTime = (hhmm, _moment, t0) => {
  const hm = getNyHourMinute(_moment, t0);
  const hh = Math.floor(hhmm / 100);
  const mm = hhmm % 100;
  return hm.hour === hh && hm.minute === mm;
};

// Computes an exact "today at session-start" timestamp from the current bar's
// own date, instead of relying on whichever bar happens to first be seen as
// "in session" — keeps the range box's left edge anchored at the true start
// time even if the platform's history buffer for this timeframe is shallow.
// Using moment's startOf('day') (rather than fixed 86400000ms math) also
// makes this correct on DST-transition days, when a "day" isn't 24 hours.
const getSessionStartTimestamp = (_moment, t0, sess) => {
  const nyTime = _moment(t0).tz('America/New_York');
  const sessionStart = nyTime
    .clone()
    .startOf('day')
    .add(sess.startH, 'hours')
    .add(sess.startM, 'minutes');
  return sessionStart.valueOf();
};

const trueRangeAt = (i) => {
  const hi = high(i);
  const lo = low(i);
  const prevClose = closeC(i + 1);

  const tr1 = hi - lo;
  const tr2 = Math.abs(hi - prevClose);
  const tr3 = Math.abs(lo - prevClose);

  return Math.max(tr1, Math.max(tr2, tr3));
};

const simpleAtr = (period, length) => {
  if (length <= period + 1) return 0;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trueRangeAt(i);
  return sum / period;
};

// Returns the created ray's id so the caller can delete it before redrawing —
// avoids stacking a fresh ray on top of every previous day's.
const makeLine = (t, y, colorValue, style, labelText, show_lines, show_labels) => {
  if (!show_lines) return null;
  return horizontalRay(
    t,
    y,
    {
      linecolor: colorValue,
      linewidth: 1,
      linestyle: style,
      showLabel: show_labels,
      textcolor: colorValue,
    },
    labelText,
  );
};

const drawGbRange = (
  startT,
  labelEndT,
  m_eq,
  po3,
  shift,
  prefix,
  c_gb_mid,
  c_gb_gip,
  c_gb_highlow,
  c_gb_liq,
  show_lines,
  show_labels,
  show_gb_highlow,
  show_gb_eq,
  show_gb_gip,
  show_gb_liq,
) => {
  const gb_center = m_eq + shift * po3;
  const r_h = gb_center + po3 * 0.5;
  const r_l = gb_center - po3 * 0.5;

  const gb_rels = [1.111, 1.0, 0.89, 0.83, 0.5, 0.17, 0.11, 0.0, -0.111];
  const gb_names = [
    'EXIT (1.1111)',
    'HIGH (1)',
    'LIQ (0.89)',
    'GIP (0.83)',
    'EQ',
    'GIP (0.17)',
    'LIQ (0.11)',
    'LOW (0)',
    'EXIT (-1.1111)',
  ];

  const ids = [];
  for (let i = 0; i < gb_rels.length; i++) {
    const rel = gb_rels[i];
    const name = gb_names[i];

    const isEq = rel === 0.5;
    const isGip = rel === 0.83 || rel === 0.17;
    const isLiq = rel === 0.89 || rel === 0.11;
    const shouldShow = isEq
      ? show_gb_eq
      : isGip
        ? show_gb_gip
        : isLiq
          ? show_gb_liq
          : show_gb_highlow;
    if (!shouldShow) continue;

    const level_p = r_l + (r_h - r_l) * rel;
    const col = isEq ? c_gb_mid : isGip ? c_gb_gip : isLiq ? c_gb_liq : c_gb_highlow;
    const style = isEq ? 1 : 0;
    ids.push(makeLine(startT, level_p, col, style, prefix + '-' + name, show_lines, show_labels));
  }
  return ids;
};

// Draws a base line at `basePrice` plus/minus each enabled percentage level,
// each level using its own configured color
const drawCbMorLevels = (t, basePrice, pctLevels, show_lines, show_labels) => {
  const ids = [];
  for (let i = 0; i < pctLevels.length; i++) {
    const { pct, enabled, colorValue } = pctLevels[i];
    if (!enabled) continue;
    const upPrice = basePrice * (1 + pct / 100);
    const downPrice = basePrice * (1 - pct / 100);
    ids.push(makeLine(t, upPrice, colorValue, 2, `CB MOR +${pct}%`, show_lines, show_labels));
    ids.push(makeLine(t, downPrice, colorValue, 2, `CB MOR -${pct}%`, show_lines, show_labels));
  }
  return ids;
};

// ==========================================================================
// MAIN
// ==========================================================================
onTick = (length, _moment, _, ta, inputs) => {
  const t0 = time(0);
  const o = openC(0);
  const h = high(0);
  const l = low(0);
  const c = closeC(0);
  const v = volume(0);
  const price4 = (o + h + l + c) / 4.0;

  const inNyOpenTrigger = inSessionFromBar(inputs.t_ny_open, _moment, t0);
  const inBaseSession = inSessionFromBar(inputs.i_session1, _moment, t0);

  const sessionChanged = inBaseSession && !prevInBaseSession;
  const sessionEnded = !inBaseSession && prevInBaseSession;
  prevInBaseSession = inBaseSession;

  if (isExactBarTime(inputs.ny_equity_open, _moment, t0)) {
    nyMarketOpenPrice = o;
  }

  if (isExactBarTime(0, _moment, t0)) {
    midnightOpenPrice = o;
  }

  if (inNyOpenTrigger && nyOpenPrice === null) {
    nyOpenPrice = o;
  }

  if (sessionChanged) {
    rangeHigh = h;
    rangeLow = l;
    barPrices = [];
    barVolumes = [];
    sessionStartTime = getSessionStartTimestamp(_moment, t0, parseSession(inputs.i_session1));
    sessionEndTime = null;
    hasDrawnForSession = false;
  } else if (inBaseSession) {
    rangeHigh = rangeHigh === null ? h : Math.max(rangeHigh, h);
    rangeLow = rangeLow === null ? l : Math.min(rangeLow, l);
    barPrices.push(price4);
    barVolumes.push(v);
  }

  if (sessionEnded && sessionEndTime === null) {
    sessionEndTime = t0;
  }

  if (sessionEnded && inputs.show_cbmor && midnightOpenPrice !== null) {
    for (let i = 0; i < cbmorDrawingIds.length; i++) {
      if (cbmorDrawingIds[i] !== null && cbmorDrawingIds[i] !== undefined) {
        deleteDrawingById(cbmorDrawingIds[i]);
      }
    }
    cbmorDrawingIds = [];

    cbmorDrawingIds.push(
      makeLine(
        t0,
        midnightOpenPrice,
        inputs.c_cbmor_anchor,
        0,
        'CB MOR Open (00:00)',
        inputs.show_lines,
        inputs.show_labels,
      ),
    );

    cbmorDrawingIds = cbmorDrawingIds.concat(
      drawCbMorLevels(
        t0,
        midnightOpenPrice,
        [
          { pct: 0.4375, enabled: inputs.use_cbmor_p1, colorValue: inputs.c_cbmor_p1 },
          { pct: 0.875, enabled: inputs.use_cbmor_p2, colorValue: inputs.c_cbmor_p2 },
          { pct: 1.75, enabled: inputs.use_cbmor_p3, colorValue: inputs.c_cbmor_p3 },
          { pct: 3.5, enabled: inputs.use_cbmor_p4, colorValue: inputs.c_cbmor_p4 },
          { pct: 7.0, enabled: inputs.use_cbmor_p5, colorValue: inputs.c_cbmor_p5 },
        ],
        inputs.show_lines,
        inputs.show_labels,
      ),
    );
  }

  const readyToDraw =
    !inBaseSession &&
    rangeHigh !== null &&
    rangeLow !== null &&
    sessionStartTime !== null &&
    sessionEndTime !== null &&
    !hasDrawnForSession;

  if (readyToDraw) {
    for (let i = 0; i < sessionDrawingIds.length; i++) {
      if (sessionDrawingIds[i] !== null && sessionDrawingIds[i] !== undefined) {
        deleteDrawingById(sessionDrawingIds[i]);
      }
    }
    sessionDrawingIds = [];

    const baseRange = rangeHigh - rangeLow;

    let devSize = baseRange;
    if (inputs.i_calc_type === 'Std Dev') {
      devSize = stdev(barPrices) * inputs.i_std_value * 100.0;
    } else if (inputs.i_calc_type === 'ATR') {
      devSize = simpleAtr(inputs.i_atr_len, length) * inputs.i_atr_mult;
    }

    const m_eq = rangeLow + baseRange * 0.5;
    const sd_p05 = rangeHigh + devSize * 0.5;
    const sd_n05 = rangeLow - devSize * 0.5;
    const sd_p10 = rangeHigh + devSize * 1.0;
    const sd_n10 = rangeLow - devSize * 1.0;
    const sd_p133 = rangeHigh + devSize * 1.33;
    const sd_n133 = rangeLow - devSize * 1.33;
    const sd_p166 = rangeHigh + devSize * 1.66;
    const sd_n166 = rangeLow - devSize * 1.66;
    const sd_p20 = rangeHigh + devSize * 2.0;
    const sd_n20 = rangeLow - devSize * 2.0;

    const rangeStartT = sessionStartTime;
    const projStartT = sessionEndTime;
    const labelEndT = t0;

    if (inputs.show_range_box) {
      sessionDrawingIds.push(
        rectangle(rangeStartT, rangeHigh, projStartT, rangeLow, {
          color: inputs.c_border,
          backgroundColor: inputs.c_range_box_fill,
          linewidth: 0,
        }),
      );
    }

    if (inputs.show_sd_boxes) {
      if (inputs.use_sd_05) {
        sessionDrawingIds.push(
          rectangle(projStartT, sd_p05, projStartT, rangeHigh, {
            color: inputs.c_border,
            backgroundColor: inputs.c_sd_box_fill,
            linewidth: 0,
            extendRight: true,
          }),
        );

        sessionDrawingIds.push(
          rectangle(projStartT, rangeLow, projStartT, sd_n05, {
            color: inputs.c_border,
            backgroundColor: inputs.c_sd_box_fill,
            linewidth: 0,
            extendRight: true,
          }),
        );
      }

      if (inputs.use_sd_133 && inputs.use_sd_166) {
        sessionDrawingIds.push(
          rectangle(projStartT, sd_p166, projStartT, sd_p133, {
            color: inputs.c_border,
            backgroundColor: inputs.c_outer_sd_box_fill,
            linewidth: 0,
            extendRight: true,
          }),
        );

        sessionDrawingIds.push(
          rectangle(projStartT, sd_n133, projStartT, sd_n166, {
            color: inputs.c_border,
            backgroundColor: inputs.c_outer_sd_box_fill,
            linewidth: 0,
            extendRight: true,
          }),
        );
      }
    }

    if (inputs.show_eq) {
      sessionDrawingIds.push(
        makeLine(projStartT, m_eq, inputs.c_eq, 0, 'NY EQ', inputs.show_lines, inputs.show_labels),
      );
    }

    if (inputs.show_open && nyMarketOpenPrice !== null) {
      sessionDrawingIds.push(
        makeLine(
          projStartT,
          nyMarketOpenPrice,
          inputs.c_open,
          0,
          'NY OPEN',
          inputs.show_lines,
          inputs.show_labels,
        ),
      );
    }

    if (inputs.use_sd_10) {
      sessionDrawingIds.push(
        makeLine(projStartT, sd_p10, inputs.c_border, 0, '', inputs.show_lines, false),
      );
      sessionDrawingIds.push(
        makeLine(projStartT, sd_n10, inputs.c_border, 0, '', inputs.show_lines, false),
      );
    }

    if (inputs.use_sd_20) {
      sessionDrawingIds.push(
        makeLine(projStartT, sd_p20, inputs.c_border, 0, '', inputs.show_lines, false),
      );
      sessionDrawingIds.push(
        makeLine(projStartT, sd_n20, inputs.c_border, 0, '', inputs.show_lines, false),
      );
    }

    if (inputs.show_poc && barVolumes.length > 0) {
      let maxVol = -1;
      let maxIdx = 0;
      for (let i = 0; i < barVolumes.length; i++) {
        if (barVolumes[i] > maxVol) {
          maxVol = barVolumes[i];
          maxIdx = i;
        }
      }

      const pocPrice = barPrices[maxIdx];
      sessionDrawingIds.push(
        makeLine(
          projStartT,
          pocPrice,
          inputs.c_poc,
          0,
          'POC',
          inputs.show_lines,
          inputs.show_labels,
        ),
      );
    }

    if (inputs.enableRange1) {
      sessionDrawingIds = sessionDrawingIds.concat(
        drawGbRange(
          projStartT,
          labelEndT,
          m_eq,
          inputs.po3_1,
          inputs.shift_range_1,
          'GB1',
          inputs.c_gb_mid,
          inputs.c_gb_gip,
          inputs.c_gb_highlow,
          inputs.c_gb_liq,
          inputs.show_lines,
          inputs.show_labels,
          inputs.show_gb_highlow,
          inputs.show_gb_eq,
          inputs.show_gb_gip,
          inputs.show_gb_liq,
        ),
      );
    }

    if (inputs.enableRange2) {
      sessionDrawingIds = sessionDrawingIds.concat(
        drawGbRange(
          projStartT,
          labelEndT,
          m_eq,
          inputs.po3_2,
          inputs.shift_range_2,
          'GB2',
          inputs.c_gb_mid,
          inputs.c_gb_gip,
          inputs.c_gb_highlow,
          inputs.c_gb_liq,
          inputs.show_lines,
          inputs.show_labels,
          inputs.show_gb_highlow,
          inputs.show_gb_eq,
          inputs.show_gb_gip,
          inputs.show_gb_liq,
        ),
      );
    }

    hasDrawnForSession = true;
    nyOpenPrice = null;
  }
};