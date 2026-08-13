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

const parseSession = (s) => {
  const parts = s.split('-');
  return {
    startH: parseInt(parts[0].slice(0, 2), 10),
    startM: parseInt(parts[0].slice(2, 4), 10),
    endH: parseInt(parts[1].slice(0, 2), 10),
    endM: parseInt(parts[1].slice(2, 4), 10),
  };
};

const inSession = (sessionStr, _moment, t0) => {
  const sess = parseSession(sessionStr);
  const nyTime = _moment(t0).tz('America/New_York');
  const now = nyTime.hour() * 60 + nyTime.minute();
  const start = sess.startH * 60 + sess.startM;
  const end = sess.endH * 60 + sess.endM;
  if (end <= start) return now >= start || now < end;
  return now >= start && now < end;
};

let state = {};

const processSession = (key, show, sessionStr, color, _moment, t0, h, l) => {
  if (!show) return;
  if (!state[key]) state[key] = { prev: false, boxId: null, high: 0, low: 0, startT: 0 };
  const s = state[key];
  const active = inSession(sessionStr, _moment, t0);

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

  processSession('asia', inputs.show_asia, inputs.session_asia, inputs.color_asia, _moment, t0, h, l);
  processSession('london', inputs.show_london, inputs.session_london, inputs.color_london, _moment, t0, h, l);
  processSession('nyam', inputs.show_nyam, inputs.session_nyam, inputs.color_nyam, _moment, t0, h, l);
  processSession('nylunch', inputs.show_nylunch, inputs.session_nylunch, inputs.color_nylunch, _moment, t0, h, l);
  processSession('nypm', inputs.show_nypm, inputs.session_nypm, inputs.color_nypm, _moment, t0, h, l);
};
