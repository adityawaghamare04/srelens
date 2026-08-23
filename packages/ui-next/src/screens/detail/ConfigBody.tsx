import { asRecord, plural, str, type K8sObject } from "@srelens/core";
import { EmptyState, Section } from "@srelens/ui-kit";

/**
 * One ConfigMap entry — key and value, both shown outright: ConfigMap data
 * is not sensitive, so `SecretBody`'s reveal affordance doesn't apply here
 * (classic's `ConfigDataEntry` takes a `secret` flag for exactly this
 * distinction). Not a `KV`: a ConfigMap value can run to many lines (a whole
 * config file), and `KV`'s single-line `dt`/`dd` row isn't built for that —
 * a `<pre>`, the same tag classic's `fl-secret-entry__value` used, preserves
 * it.
 */
function ConfigEntry({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[0.8125rem] font-medium">{name}</span>
      <pre className="whitespace-pre-wrap break-all font-mono text-[0.8125rem] text-muted">{value}</pre>
    </div>
  );
}

/**
 * A ConfigMap's Details pane: its `data` keys and values — classic's
 * `ConfigBody`, minus the inline edit/save affordance (`ConfigDataEditor`):
 * ui-next's Details panes are read-only, the same call `ServiceBody`'s Ports
 * table and `PodBody`'s Containers pane made for their own write affordances
 * (an inline port-forward button neither wires). `binaryData` is not read
 * here either — classic's own `ConfigBody` never read it.
 */
export function ConfigDetailsBody({ object }: { object: K8sObject }) {
  const data = asRecord(object.data) as Record<string, string>;
  const keys = Object.keys(data);
  return (
    <Section title={`Data (${plural(keys.length, "key")})`}>
      {keys.length === 0 ? (
        <EmptyState title="No data" />
      ) : (
        <div className="flex flex-col gap-4">
          {keys.map((key) => (
            <ConfigEntry key={key} name={key} value={str(data[key])} />
          ))}
        </div>
      )}
    </Section>
  );
}
