//@version=1
// Ported from the "Killzone" section of the "I'm Duy" Pine Script v5
// mega-indicator: named session range boxes. Each is redrawn (delete +
// recreate with grown bounds) every tick while inside its session, then
// left exactly as last drawn once the session ends — the same net effect
// as Pine's box.set_top/set_rightbottom mutation, since a Run computes one
// final batch result rather than a live-updating stream.

init = () => {
  indicator({ onMainPanel: true, format: 'inherit' });

  input.bool('Show Asia', true, 'show_asia', 'Sessions');
  input.session('Asia Session', '2000-0000', 'session_asia', undefined, 'Sessions');
  input.color('Asia Color', { r: 0, g: 0, b: 0, a: 0.15 }, 'color_asia', 'Sessions', undefined);

  input.bool('Show London', true, 'show_london', 'Sessions');
  input.session('London Session', '0200-0500', 'session_london', undefined, 'Sessions');
  input.color('London Color', { r: 0, g: 0, b: 0, a: 0.15 }, 'color_london', 'Sessions', undefined);

  input.bool('Show NY AM', true, 'show_nyam', 'Sessions');
  input.session('NY AM Session', '0830-1100', 'session_nyam', undefined, 'Sessions');
  input.color('NY AM Color', { r: 0, g: 0, b: 0, a: 0.15 }, 'color_nyam', 'Sessions', undefined);

  input.bool('Show NY Lunch', false, 'show_nylunch', 'Sessions');
  input.session('NY Lunch Session', '1200-1300', 'session_nylunch', undefined, 'Sessions');
  input.color('NY Lunch Color', { r: 0, g: 0, b: 0, a: 0.15 }, 'color_nylunch', 'Sessions', undefined);

  input.bool('Show NY PM', true, 'show_nypm', 'Sessions');
  input.session('NY PM Session', '1300-1600', 'session_nypm', undefined, 'Sessions');
  input.color('NY PM Color', { r: 0, g: 0, b: 0, a: 0.15 }, 'color_nypm', 'Sessions', undefined);
};

// A session string is a constant input, so its parse result is cached rather
// than recomputed. Without this, a 1500-tick run re-split and re-parseInt'd
// the same five strings 7,500 times.
const sessionCache = {};

const parseSession = (s) => {
  const cached = sessionCache[s];
  if (cached !== undefined) return cached;
  const parts = s.split('-');
  const parsed = {
    start: parseInt(parts[0].slice(0, 2), 10) * 60 + parseInt(parts[0].slice(2, 4), 10),
    end: parseInt(parts[1].slice(0, 2), 10) * 60 + parseInt(parts[1].slice(2, 4), 10),
  };
  sessionCache[s] = parsed;
  return parsed;
};

// Takes the already-resolved NY minute-of-day rather than the bar timestamp:
// every session on a given tick shares one wall-clock reading, so building a
// _moment and doing a tzdata lookup per session (five per tick) was four
// fifths waste.
const inSession = (sessionStr, nowMinute) => {
  const sess = parseSession(sessionStr);
  if (sess.end <= sess.start) return nowMinute >= sess.start || nowMinute < sess.end;
  return nowMinute >= sess.start && nowMinute < sess.end;
};

let state = {};

const processSession = (key, show, sessionStr, color, nowMinute, t0, h, l) => {
  if (!show) return;
  if (!state[key]) state[key] = { prev: false, boxId: null, high: 0, low: 0, startT: 0 };
  const s = state[key];
  const active = inSession(sessionStr, nowMinute);

  if (active) {
    if (!s.prev) {
      s.high = h;
      s.low = l;
      s.startT = t0;
    } else {
      if (h > s.high) s.high = h;
      if (l < s.low) s.low = l;
    }
    if (s.boxId !== null) deleteDrawingById(s.boxId);
    s.boxId = rectangle(s.startT, s.high, t0, s.low, { color: color, backgroundColor: color, linewidth: 1 });
  }
  s.prev = active;
};

onTick = (length, _moment, _, ta, inputs) => {
  const t0 = time(0);
  const h = high(0);
  const l = low(0);
  const nyTime = _moment(t0).tz('America/New_York');
  const nowMinute = nyTime.hour() * 60 + nyTime.minute();

  processSession('asia', inputs.show_asia, inputs.session_asia, inputs.color_asia, nowMinute, t0, h, l);
  processSession('london', inputs.show_london, inputs.session_london, inputs.color_london, nowMinute, t0, h, l);
  processSession('nyam', inputs.show_nyam, inputs.session_nyam, inputs.color_nyam, nowMinute, t0, h, l);
  processSession('nylunch', inputs.show_nylunch, inputs.session_nylunch, inputs.color_nylunch, nowMinute, t0, h, l);
  processSession('nypm', inputs.show_nypm, inputs.session_nypm, inputs.color_nypm, nowMinute, t0, h, l);
};
