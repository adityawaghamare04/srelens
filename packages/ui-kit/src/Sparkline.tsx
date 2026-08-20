import { toneColor, type Tone } from "./tone";

/**
 * A trend at a glance: no axes, no labels, no interaction.
 *
 * Scaled to its own range rather than to zero, so a metric that only varies in
 * its top few percent still shows its shape.
 *
 * Hardened over the version this came from. A single sample divides by
 * `points.length - 1` and puts NaN in the path data, which renders as nothing
 * with no error — and a series with no samples yet is the normal state of a
 * chart that has just been opened, not an edge case.
 */
export function Sparkline({
  points,
  tone = "sev",
  height = 34,
  fill = true,
  ariaLabel,
}: {
  points: number[];
  tone?: Tone;
  height?: number;
  fill?: boolean;
  ariaLabel?: string;
}) {
  const width = 100;
  // Nothing to draw. Rendered as an empty box rather than skipped, so a row of
  // sparklines keeps its alignment while one series is still filling.
  if (points.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role={ariaLabel ? "img" : "presentation"}
        aria-label={ariaLabel}
      />
    );
  }

  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  // A lone sample has no span to divide across; draw it as a flat line rather
  // than dividing by zero.
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  const y = (p: number) => height - ((p - min) / span) * (height - 4) - 2;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${i * step},${y(p)}`).join(" ");
  const stroke = points.length === 1 ? `${line} L${width},${y(points[0])}` : line;
  const area = `${stroke} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      role={ariaLabel ? "img" : "presentation"}
      aria-label={ariaLabel}
    >
      {fill ? <path d={area} fill={toneColor(tone)} opacity="0.09" /> : null}
      <path
        d={stroke}
        fill="none"
        stroke={toneColor(tone)}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
