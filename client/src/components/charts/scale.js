// Small numeric helpers shared by the charts: clean axis ticks and a smooth line
// that never overshoots its data.

/** Ticks at 1/2/2.5/5 x 10^n steps, from zero to just above `max`. */
export function niceTicks(max, count = 4) {
  if (!Number.isFinite(max) || max <= 0) return { ticks: [0, 1], top: 1 };
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) || 10 * magnitude;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { ticks, top };
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Monotone cubic interpolation (Fritsch-Carlson). The curve reads as smooth, but
 * between two data points it never rises above or dips below them - so a day
 * with zero sales is never drawn as negative.
 */
export function monotonePath(points) {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M${points[0][0]},${points[0][1]}`;
  if (n === 2) return `M${points[0][0]},${points[0][1]}L${points[1][0]},${points[1][1]}`;

  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1][0] - points[i][0];
    slope[i] = dx[i] === 0 ? 0 : (points[i + 1][1] - points[i][1]) / dx[i];
  }

  const tangent = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) tangent[i] = 0;
    else {
      const common = dx[i - 1] + dx[i];
      tangent[i] = (3 * common) / ((common + dx[i]) / slope[i - 1] + (common + dx[i - 1]) / slope[i]);
    }
  }
  tangent[n - 1] = slope[n - 2];

  let d = `M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = dx[i] / 3;
    d += `C${(x0 + h).toFixed(2)},${(y0 + tangent[i] * h).toFixed(2)} ${(x1 - h).toFixed(2)},${(y1 - tangent[i + 1] * h).toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }
  return d;
}

/** Which label indexes to show on an axis so they never collide. */
export function labelIndexes(count, available, minGap = 80) {
  if (count <= 1) return [0];
  const fit = Math.max(2, Math.floor(available / minGap));
  if (count <= fit) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (fit - 1);
  return Array.from({ length: fit }, (_, i) => Math.round(i * step));
}
