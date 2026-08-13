//@version=1
// Ported from the "Open Price" section of the "I'm Duy" Pine Script v5
// mega-indicator: a horizontal ray from a bar's open price at configurable
// NY-local time-of-day triggers (00:00/08:30/09:30 by default).

init = () => {
  indicator({ onMainPanel: true, format: 'inherit' });
  input.int('Keep Last N Days', 5, 'maxDays', 1, 30, 1, undefined, 'General');

  input.bool('Show 00:00', true, 'show_h1', 'Triggers');
  input.time('00:00 Trigger', 0, 'time_h1', 0, 2359, undefined, 'Triggers');
  input.color('00:00 Color', { r: 0, g: 0, b: 0, a: 1 }, 'color_h1', 'Triggers', undefined);

  input.bool('Show 08:30', true, 'show_h2', 'Triggers');
  input.time('08:30 Trigger', 830, 'time_h2', 0, 2359, undefined, 'Triggers');
  input.color('08:30 Color', { r: 0, g: 0, b: 0, a: 1 }, 'color_h2', 'Triggers', undefined);

  input.bool('Show 09:30', true, 'show_h3', 'Triggers');
  input.time('09:30 Trigger', 930, 'time_h3', 0, 2359, undefined, 'Triggers');
  input.color('09:30 Color', { r: 0, g: 0, b: 0, a: 1 }, 'color_h3', 'Triggers', undefined);
};

const isExactBarTime = (hhmm, _moment, t0) => {
  const nyTime = _moment(t0).tz('America/New_York');
  const hh = Math.floor(hhmm / 100);
  const mm = hhmm % 100;
  return nyTime.hour() === hh && nyTime.minute() === mm;
};

let ids = {};

const processTrigger = (key, show, hhmm, color, maxDays, _moment, t0, o) => {
  if (!show) return;
  if (!ids[key]) ids[key] = [];
  if (isExactBarTime(hhmm, _moment, t0)) {
    const id = horizontalRay(t0, o, { linecolor: color, linewidth: 1, linestyle: 1, showLabel: true, textcolor: color }, key);
    ids[key].push(id);
    if (ids[key].length > maxDays) {
      deleteDrawingById(ids[key].shift());
    }
  }
};

onTick = (length, _moment, _, ta, inputs) => {
  const t0 = time(0);
  const o = openC(0);

  processTrigger('h1', inputs.show_h1, inputs.time_h1, inputs.color_h1, inputs.maxDays, _moment, t0, o);
  processTrigger('h2', inputs.show_h2, inputs.time_h2, inputs.color_h2, inputs.maxDays, _moment, t0, o);
  processTrigger('h3', inputs.show_h3, inputs.time_h3, inputs.color_h3, inputs.maxDays, _moment, t0, o);
};
