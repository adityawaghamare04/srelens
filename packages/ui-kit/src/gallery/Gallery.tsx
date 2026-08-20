import { Badge } from "../Badge";
import { Meter } from "../Meter";
import { Sparkline } from "../Sparkline";
import type { Tone } from "../tone";

const TONES: Tone[] = ["muted", "ok", "info", "accent", "warn", "sev"];

/**
 * The kit's living catalogue, and the only visual review surface this design
 * has — there are no visual regression tests, so a component missing from here
 * is a component nobody looks at.
 *
 * Every section shows the states, not the happy path. The states are what break
 * on a real cluster: a pod over its limit, a series with no samples yet, a node
 * reporting a figure nobody designed for.
 */
export function Gallery() {
  return (
    <div className="kit-gallery">
      <h1>Design system</h1>

      <section>
        <h2>Badge</h2>
        <div className="kit-gallery__row">
          {TONES.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
        </div>
        <div className="kit-gallery__row">
          {TONES.map((tone) => (
            <Badge key={tone} tone={tone} solid>
              {tone}
            </Badge>
          ))}
        </div>
      </section>

      <section>
        <h2>Meter</h2>
        <Meter value={0} ariaLabel="empty" />
        <Meter value={42} ariaLabel="ok" />
        <Meter value={72} ariaLabel="warning" />
        <Meter value={95} ariaLabel="severe" />
        {/* A pod over its limit reports more than 100%: the bar clamps, the
            number does not. */}
        <Meter value={150} ariaLabel="over limit" />
      </section>

      <section>
        <h2>Sparkline</h2>
        <Sparkline points={[3, 5, 2, 8, 6, 9, 4]} tone="ok" ariaLabel="a normal series" />
        <Sparkline points={[3, 5, 2, 8, 6, 9, 4]} tone="sev" fill={false} ariaLabel="no fill" />
        {/* One sample is where the version this came from produced NaN. */}
        <Sparkline points={[7]} tone="warn" ariaLabel="a single sample" />
        {/* The normal state of a chart that has just been opened. */}
        <Sparkline points={[]} ariaLabel="no samples yet" />
      </section>
    </div>
  );
}
