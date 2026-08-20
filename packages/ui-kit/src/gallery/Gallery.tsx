import { useState } from "react";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Field } from "../Field";
import { IconButton } from "../IconButton";
import { Meter } from "../Meter";
import { Sparkline } from "../Sparkline";
import { TextInput } from "../TextInput";
import type { Tone } from "../tone";

const TONES: Tone[] = ["muted", "ok", "info", "accent", "warn", "sev"];

/**
 * A stand-in for a real icon. The kit does not depend on an icon set — callers
 * pass their own — so the catalogue brings its own shape to show the hole.
 */
function DotIcon({ size = 14, ...rest }: { size?: number; "aria-hidden"?: boolean | "true" | "false" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...rest}>
      <circle cx="8" cy="8" r="5" fill="currentColor" />
    </svg>
  );
}

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
  // The inputs are controlled, so the catalogue has to hold their value; typing
  // into a component that never updates is not a working example of it.
  const [text, setText] = useState("kube-system");
  const [empty, setEmpty] = useState("");

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

      <section>
        <h2>Button</h2>
        <div className="kit-gallery__row">
          <Button>primary</Button>
          <Button variant="secondary">secondary</Button>
          <Button variant="outline">outline</Button>
          <Button variant="ghost">ghost</Button>
          <Button variant="danger">danger</Button>
        </div>
        <div className="kit-gallery__row">
          <Button size="xs">xs</Button>
          <Button size="sm">sm</Button>
          <Button size="default">default</Button>
          <Button size="lg">lg</Button>
        </div>
        {/* Disabled is not a rare state: half the toolbar is disabled until a
            resource is selected. */}
        <div className="kit-gallery__row">
          <Button disabled>disabled</Button>
          <Button variant="danger" disabled>
            disabled danger
          </Button>
        </div>
      </section>

      <section>
        <h2>IconButton</h2>
        <div className="kit-gallery__row">
          <IconButton icon={DotIcon} label="Logs" />
          <IconButton icon={DotIcon} label="Delete" danger />
          {/* The disabled form carries its reason, which is the whole point of
              the title override. */}
          <IconButton icon={DotIcon} label="Restart" disabled title="No pod selected" />
        </div>
      </section>

      <section>
        <h2>TextInput</h2>
        <div className="kit-gallery__row">
          <TextInput value={text} onValueChange={setText} aria-label="a filled input" />
          <TextInput
            value={empty}
            onValueChange={setEmpty}
            placeholder="namespace"
            aria-label="an empty input"
          />
          <TextInput value="bad name" onValueChange={() => {}} invalid aria-label="an invalid input" />
          <TextInput value="frozen" onValueChange={() => {}} disabled aria-label="a disabled input" />
        </div>
      </section>

      <section>
        <h2>Field</h2>
        <Field label="Namespace">
          <TextInput value={text} onValueChange={setText} />
        </Field>
        <Field label="Name" hint="Lowercase letters, numbers and dashes">
          <TextInput value={empty} onValueChange={setEmpty} />
        </Field>
        {/* The error replaces the hint rather than joining it. */}
        <Field label="Name" hint="Lowercase letters, numbers and dashes" error="Already taken">
          <TextInput value="prod" onValueChange={() => {}} invalid />
        </Field>
        {/* With an action the label cannot wrap the control; see the component. */}
        <Field label="Manifest" action={<Button size="xs">Preview</Button>}>
          <TextInput value={empty} onValueChange={setEmpty} />
        </Field>
      </section>
    </div>
  );
}
