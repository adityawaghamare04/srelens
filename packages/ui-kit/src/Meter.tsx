import { toneColor, type Tone } from "./tone";

/**
 * A proportion bar with its percentage beside it.
 *
 * Picks its own tone from the value unless told otherwise, so a row of meters
 * reads as a heat map without every caller repeating the thresholds.
 *
 * Hardened over the version this came from: a pod over its limit reports more
 * than 100%, and a bar that runs past its track looks like a rendering fault
 * rather than the reading it is. The number keeps the real value; only the bar
 * is clamped.
 */
export function Meter({
  value,
  tone,
  ariaLabel,
}: {
  value: number;
  tone?: Tone;
  ariaLabel?: string;
}) {
  const resolved: Tone = tone ?? (value > 80 ? "sev" : value > 65 ? "warn" : "ok");
  const width = Math.min(Math.max(value, 0), 100);
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-[5px] w-full overflow-hidden rounded-full"
        style={{ background: "var(--field)" }}
        role="meter"
        aria-label={ariaLabel}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${width}%`, background: toneColor(resolved) }}
        />
      </div>
      <span className="num w-9 shrink-0 text-right text-[0.6875rem] text-muted">{value}%</span>
    </div>
  );
}
