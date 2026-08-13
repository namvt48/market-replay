//@version=1
// Ported from the "Fractal Indicator" section of the "I'm Duy" Pine Script
// v5 mega-indicator: a swing-high/low marker at a pivot bar once
// `swingLength` bars on both sides confirm it's a local extreme.

init = () => {
  indicator({ onMainPanel: true, format: 'inherit' });
  input.bool('Show Fractals', true, 'show', 'Fractals');
  input.int('Swing Length', 3, 'swingLength', 1, 50, 1, undefined, 'Fractals');
  input.color('Swing High Color', { r: 244, g: 67, b: 54, a: 1 }, 'colorHigh', 'Fractals', undefined);
  input.color('Swing Low Color', { r: 76, g: 175, b: 80, a: 1 }, 'colorLow', 'Fractals', undefined);
};

onTick = (length, _moment, _, ta, inputs) => {
  if (!inputs.show) return;
  const n = inputs.swingLength;
  const pivotHigh = high(n);
  const pivotLow = low(n);
  const pivotTime = time(n);

  let isSwingHigh = true;
  let isSwingLow = true;
  for (let i = 1; i <= n; i++) {
    if (!(pivotHigh > high(n + i) && pivotHigh > high(n - i))) isSwingHigh = false;
    if (!(pivotLow < low(n + i) && pivotLow < low(n - i))) isSwingLow = false;
  }

  if (isSwingHigh) marker(pivotTime, pivotHigh, '⮝', { color: inputs.colorHigh });
  if (isSwingLow) marker(pivotTime, pivotLow, '⮟', { color: inputs.colorLow });
};
