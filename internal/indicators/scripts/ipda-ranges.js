//@version=1
// Ported from the "ICT IPDA LB" section of the "I'm Duy" Pine Script v5
// mega-indicator: 20/40/60-day rolling daily high/low premium/discount
// zones plus an equilibrium line. Only the box-overlay plot mode is
// ported — the original's Table A/B text-summary modes are a frontend
// display concern, same reasoning as dropping Watermark entirely.

init = () => {
  indicator({ onMainPanel: true, format: 'inherit' });
  input.bool('Show IPDA 20', true, 'show20', 'IPDA Ranges');
  input.bool('Show IPDA 40', true, 'show40', 'IPDA Ranges');
  input.bool('Show IPDA 60', true, 'show60', 'IPDA Ranges');
  input.color('Premium Color', { r: 0, g: 0, b: 128, a: 0.2 }, 'premiumColor', 'IPDA Ranges', undefined);
  input.color('Discount Color', { r: 128, g: 0, b: 0, a: 0.2 }, 'discountColor', 'IPDA Ranges', undefined);
  input.color('Equilibrium Color', { r: 0, g: 0, b: 0, a: 1 }, 'eqColor', 'IPDA Ranges', undefined);
};

let state = {};

// All three ranges share the same three colors, and inputs are fixed for the
// whole run — so the style objects are built once instead of nine times per
// tick. Every one of those literals was a fresh object the host then had to
// walk and convert.
let styles = null;

const buildStyles = (inputs) => ({
  premium: { color: inputs.premiumColor, backgroundColor: inputs.premiumColor, linewidth: 0 },
  discount: { color: inputs.discountColor, backgroundColor: inputs.discountColor, linewidth: 0 },
  eq: { linecolor: inputs.eqColor, linewidth: 1, linestyle: 0, showLabel: true, textcolor: inputs.eqColor },
});

const processIpda = (key, n, show, t0) => {
  if (!show) return;
  const r = dailyRange(n);
  if (!r) return;
  const eq = (r.high + r.low) / 2;

  if (!state[key]) state[key] = { premiumId: null, discountId: null, eqId: null };
  const s = state[key];
  if (s.premiumId !== null) deleteDrawingById(s.premiumId);
  if (s.discountId !== null) deleteDrawingById(s.discountId);
  if (s.eqId !== null) deleteDrawingById(s.eqId);

  s.premiumId = rectangle(r.time, r.high, t0, eq, styles.premium);
  s.discountId = rectangle(r.time, eq, t0, r.low, styles.discount);
  s.eqId = horizontalRay(r.time, eq, styles.eq, 'IPDA' + n + ' EQ');
};

onTick = (length, _moment, _, ta, inputs) => {
  const t0 = time(0);
  if (styles === null) styles = buildStyles(inputs);
  processIpda('20', 20, inputs.show20, t0);
  processIpda('40', 40, inputs.show40, t0);
  processIpda('60', 60, inputs.show60, t0);
};
