//@version=1
// Ported from the "Day Separator (00:00)" section of the "I'm Duy" Pine
// Script v5 mega-indicator: a full-height vertical line at every NY-local
// midnight boundary.

init = () => {
  indicator({ onMainPanel: true, format: 'inherit' });
  input.bool('Show Day Separator', true, 'show', 'Day Separator');
  input.color('Line Color', { r: 0, g: 0, b: 0, a: 1 }, 'color', 'Day Separator', undefined);
  input.str('Style', 'Dotted', 'style', ['Solid', 'Dotted', 'Dashed'], undefined, 'Day Separator');
  input.int('Width', 1, 'width', 1, 5, 1, undefined, 'Day Separator');
};

// Matches lightweight-charts' own LineStyle enum (Solid=0, Dotted=1,
// Dashed=2) so the frontend can pass this straight through unmapped.
const LINE_STYLES = { Solid: 0, Dotted: 1, Dashed: 2 };

let prevHour = null;

onTick = (length, _moment, _, ta, inputs) => {
  const t0 = time(0);
  const nyHour = _moment(t0).tz('America/New_York').hour();

  if (inputs.show && prevHour !== null && nyHour === 0 && prevHour !== 0) {
    verticalLine(t0, {
      linecolor: inputs.color,
      linewidth: inputs.width,
      linestyle: LINE_STYLES[inputs.style] ?? LINE_STYLES.Dotted,
    });
  }

  prevHour = nyHour;
};
