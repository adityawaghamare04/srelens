import { useEffect, useState } from "react";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { CodeEditor } from "../CodeEditor";
import { ColumnPicker } from "../ColumnPicker";
import { Combobox } from "../Combobox";
import { Checkbox } from "../Checkbox";
import { ConfirmDialog } from "../ConfirmDialog";
import { Drawer } from "../Drawer";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { Eyebrow } from "../Eyebrow";
import { Field } from "../Field";
import { IconButton } from "../IconButton";
import { KubectlPreview } from "../KubectlPreview";
import { KV, KVList } from "../KV";
import { LoadingState } from "../LoadingState";
import { Meter } from "../Meter";
import { MultiSelect } from "../MultiSelect";
import { MetricTile } from "../MetricTile";
import { NavIcon } from "../NavIcon";
import { PairList } from "../PairList";
import { Panel } from "../Panel";
import { Radio } from "../Radio";
import { Screen } from "../Screen";
import { SegmentBar } from "../SegmentBar";
import { Select } from "../Select";
import { Sparkline } from "../Sparkline";
import { Stat } from "../Stat";
import { Spinner } from "../Spinner";
import { StatusPill } from "../StatusPill";
import { SubHead } from "../SubHead";
import { Switch } from "../Switch";
import { Table, type Column } from "../Table";
import { Tabs } from "../Tabs";
import { TextInput } from "../TextInput";
import { Toolbar } from "../Toolbar";
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
  const [ns, setNs] = useState("kube-system");
  const [tab, setTab] = useState("pods");
  const [drawer, setDrawer] = useState(false);
  const [boxes, setBoxes] = useState({ a: true, b: false });
  const [refresh, setRefresh] = useState("30");
  const [live, setLive] = useState(true);
  const [scope, setScope] = useState("kube-system");
  const [sort, setSort] = useState<import("../Table").TableSort | null>(null);
  const [picked2, setPicked2] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string[]>([]);
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(new Set(["age"]));
  const [manifest, setManifest] = useState("apiVersion: v1\nkind: Pod\nmetadata:\n  name: web-1\n");
  const [dialog, setDialog] = useState<null | "plain" | "danger" | "busy">(null);
  // The busy dialog is deliberately undismissable — that is the state being
  // shown — so the catalogue releases it rather than trapping whoever opened it.
  useEffect(() => {
    if (dialog !== "busy") return;
    const timer = setTimeout(() => setDialog(null), 2500);
    return () => clearTimeout(timer);
  }, [dialog]);

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
        {/* Captioned: the number moves above the bar rather than doubling, and
            the caption is not the accessible name — the meter still needs one. */}
        <Meter value={42} ariaLabel="Node CPU" label="CPU" detail="3 of 8 cores" />
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

      <section>
        <h2>Select</h2>
        <div className="kit-gallery__row">
          <Select
            value={ns}
            onValueChange={setNs}
            options={[{ value: "default" }, { value: "kube-system" }, { value: "argocd" }]}
            aria-label="a namespace"
          />
          {/* An empty string is a real value here, not a sentinel. */}
          <Select
            value=""
            onValueChange={() => {}}
            options={[{ value: "", label: "All namespaces" }, { value: "default" }]}
            aria-label="an all-namespaces select"
          />
          {/* Nothing chosen yet: the placeholder leads and cannot be picked. */}
          <Select
            value="none"
            onValueChange={() => {}}
            options={[{ value: "a" }, { value: "b" }]}
            placeholder="Pick a context"
            aria-label="an unselected select"
          />
        </div>
      </section>

      <section>
        <h2>StatusPill</h2>
        <div className="kit-gallery__row">
          <StatusPill status="Running" kind="success" />
          <StatusPill status="Pending" kind="warning" />
          <StatusPill status="CrashLoopBackOff" kind="danger" />
          <StatusPill status="Terminating" kind="info" />
          <StatusPill status="Unknown" />
        </div>
      </section>

      <section>
        <h2>Spinner</h2>
        <div className="kit-gallery__row">
          <Spinner />
          <Spinner className="size-8" />
          {/* Inline beside text is where it spends most of its life. */}
          <span className="inline-flex items-center gap-2 text-[0.8125rem]">
            <Spinner label="Fetching pods" /> Fetching pods
          </span>
        </div>
      </section>

      <section>
        <h2>ConfirmDialog</h2>
        <div className="kit-gallery__row">
          <Button size="xs" onClick={() => setDialog("plain")}>
            confirm
          </Button>
          <Button size="xs" variant="danger" onClick={() => setDialog("danger")}>
            destructive
          </Button>
          {/* In flight: both controls disabled, Escape and the overlay inert. */}
          <Button size="xs" variant="secondary" onClick={() => setDialog("busy")}>
            busy
          </Button>
        </div>
        {dialog ? (
          <ConfirmDialog
            title={dialog === "danger" ? "Delete pod?" : "Apply changes?"}
            message={
              dialog === "danger"
                ? "web-1 will be removed. This cannot be undone."
                : "The manifest will be applied to the cluster."
            }
            confirmLabel={dialog === "danger" ? "Delete" : "Apply"}
            danger={dialog === "danger"}
            busy={dialog === "busy"}
            onConfirm={() => setDialog(null)}
            onCancel={() => setDialog(null)}
          />
        ) : null}
      </section>

      <section>
        <h2>LoadingState</h2>
        <LoadingState />
        <LoadingState label="Loading pods" />
      </section>
      <section>
        <h2>Panel</h2>
        <Panel title="Cluster">A titled surface.</Panel>
        <Panel title="Cluster" description="Every node in the current context">
          A description under the title.
        </Panel>
        {/* A description with no title still earns a header. */}
        <Panel description="No title, still a header">Body.</Panel>
        {/* Untitled omits the header rather than ruling off an empty one. */}
        <Panel>No title at all.</Panel>
      </section>

      <section>
        <h2>Tabs</h2>
        <Tabs
          tabs={[
            { id: "pods", label: "Pods" },
            { id: "services", label: "Services" },
            { id: "events", label: "Events" },
          ]}
          active={tab}
          onChange={setTab}
          label="Resource views"
        />
        {/* The keyboard contract is the part worth checking here: the strip is
            one Tab stop, and Left/Right/Home/End move between tabs. */}
        <p className="text-[0.75rem] text-muted">showing: {tab}</p>
      </section>

      <section>
        <h2>Drawer</h2>
        <Button size="xs" onClick={() => setDrawer((v) => !v)}>
          {drawer ? "close" : "open"} the drawer
        </Button>
        <div className="flex" style={{ height: 180 }}>
          <div className="flex-1 text-[0.75rem] text-muted">
            the list this docks beside — it shrinks rather than being covered
          </div>
          <Drawer
            open={drawer}
            title="Pod · web-1"
            onClose={() => setDrawer(false)}
            defaultWidth={320}
          >
            Drag the left edge to resize. Escape closes it.
          </Drawer>
        </div>
      </section>
      <section>
        <h2>MetricTile</h2>
        <div className="kit-gallery__row">
          <MetricTile label="Pods" value={248} />
          <MetricTile label="Restarts" value={9} tone="sev" description="last hour" />
          <MetricTile label="Nodes" value={12} tone="ok" />
          {/* The figure stays in the body colour whatever the tone: severity is
              context around the number, not the number itself. */}
          <MetricTile label="Pending" value={3} tone="warn" action={<Button size="xs">view</Button>} />
        </div>
      </section>

      <section>
        <h2>SegmentBar</h2>
        <SegmentBar
          ariaLabel="Pods: 18 running, 3 pending, 1 failed"
          segments={[
            { value: 18, tone: "ok", label: "Running" },
            { value: 3, tone: "warn", label: "Pending" },
            { value: 1, tone: "sev", label: "Failed" },
          ]}
        />
        {/* A cluster with nothing scheduled yet is the first render, not an
            edge case — it must not divide by zero into a NaN width. */}
        <p className="text-[0.75rem] text-muted">nothing scheduled yet</p>
        <SegmentBar
          ariaLabel="Empty cluster"
          segments={[
            { value: 0, tone: "ok", label: "Running" },
            { value: 0, tone: "sev", label: "Failed" },
          ]}
        />
      </section>

      <section>
        <h2>Toolbar</h2>
        <Toolbar>
          <TextInput value={ns} onValueChange={setNs} placeholder="filter" aria-label="filter" />
          <span className="flex-1" />
          <Button size="xs" variant="secondary">
            refresh
          </Button>
        </Toolbar>
      </section>

      <section>
        <h2>Screen</h2>
        {/* Bounded here; in the app it takes the full height of its pane. */}
        <div className="card overflow-hidden" style={{ height: 220 }}>
          <Screen
            title="Pods"
            eyebrow="Workloads"
            description="Everything scheduled in this namespace."
            actions={<Button size="xs">new</Button>}
          >
            <p className="text-[0.75rem] text-muted">the table goes here</p>
          </Screen>
        </div>
      </section>

      <section>
        <h2>EmptyState</h2>
        <EmptyState title="No pods" />
        <EmptyState title="No pods" hint="Nothing is scheduled in this namespace." />
        <EmptyState
          title="No pods"
          hint="Nothing is scheduled in this namespace."
          action={<Button size="xs">create pod</Button>}
        />
      </section>

      <section>
        <h2>ErrorState</h2>
        {/* The states differ in what they announce, not just how they look:
            this one is a live region, the two above are not. */}
        <ErrorState title="Could not load pods" />
        <ErrorState
          title="Could not load pods"
          detail="dial tcp 10.0.0.1:6443: connection refused"
          onRetry={() => {}}
          action={{ label: "Diagnose in Toolbox", onClick: () => {} }}
        />
      </section>

      <section>
        <h2>NavIcon</h2>
        {/* Takes its colour from the row it sits in, so hover and the active
            state reach it without it knowing about them. */}
        <div className="kit-gallery__row">
          <span className="inline-flex items-center gap-2 text-[0.8125rem]">
            <NavIcon icon={DotIcon} /> Pods
          </span>
          <span className="inline-flex items-center gap-2 text-[0.8125rem]" style={{ color: "var(--accent)" }}>
            <NavIcon icon={DotIcon} /> Deployments
          </span>
        </div>
      </section>
      <section>
        <h2>Combobox</h2>
        {/* Use over Select when the list is long enough to want searching. */}
        <Combobox
          value={scope}
          onValueChange={setScope}
          options={[
            { value: "kube-system" },
            { value: "default" },
            { value: "monitoring" },
            { value: "cert-manager" },
          ]}
          ariaLabel="Scope"
        />
        <p className="text-[0.75rem] text-muted">chosen: {scope}</p>
      </section>

      <section>
        <h2>MultiSelect</h2>
        {/* Stays open while toggling, so several can be picked in one visit.
            `allLabel` is how a filter says "no filter" without a sentinel
            value the caller has to invent. */}
        <MultiSelect
          options={[{ value: "default" }, { value: "kube-system" }, { value: "monitoring" }]}
          selection={picked}
          onChange={setPicked}
          allLabel="All namespaces"
          ariaLabel="Namespaces"
        />
        <p className="text-[0.75rem] text-muted">
          selected: {picked.length === 0 ? "(all)" : picked.join(", ")}
        </p>
      </section>

      <section>
        <h2>ColumnPicker</h2>
        {/* The pinned column is the row identifier: offered, but never off. */}
        <ColumnPicker
          columns={[
            { key: "name", label: "Name" },
            { key: "namespace", label: "Namespace" },
            { key: "status", label: "Status" },
            { key: "age", label: "Age" },
          ]}
          hidden={hiddenColumns}
          pinnedKey="name"
          onToggle={(key) =>
            setHiddenColumns((current) => {
              const next = new Set(current);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
        />
        <p className="text-[0.75rem] text-muted">
          hidden: {hiddenColumns.size === 0 ? "(none)" : [...hiddenColumns].join(", ")}
        </p>
      </section>

      <section>
        <h2>KubectlPreview</h2>
        <KubectlPreview command="kubectl delete pod web-1 -n default" onCopy={() => {}} />
        {/* Not every action has a faithful one-liner; the note says so in the
            same place rather than leaving the dialog silent. */}
        <KubectlPreview note="Eviction is an API call with no kubectl verb of its own." />
      </section>

      <section>
        <h2>CodeEditor</h2>
        <div style={{ height: 200 }}>
          <CodeEditor
            value={manifest}
            onChange={setManifest}
            ariaLabel="Manifest YAML"
            fill
          />
        </div>
        {/* Completions are the caller's: the kit knows CodeMirror, not what an
            apiVersion is. */}
      </section>
      <section>
        <h2>Table</h2>
        {/* The states worth seeing: a sortable column, a filterable one, bulk
            selection, and a row that is clickable. Virtualisation only engages
            past a threshold, so a gallery-sized list renders whole. */}
        <Table
          columns={
            [
              { key: "name", header: "Name", sortable: true, filterable: true },
              { key: "phase", header: "Phase", sortable: true },
              { key: "restarts", header: "Restarts", sortable: true },
            ] as Column<{ name: string; phase: string; restarts: number }>[]
          }
          data={[
            { name: "web-1", phase: "Running", restarts: 0 },
            { name: "web-2", phase: "Pending", restarts: 3 },
            { name: "api-0", phase: "CrashLoopBackOff", restarts: 17 },
          ]}
          getRowKey={(r) => r.name}
          sort={sort}
          onSortChange={setSort}
          selection={{ selected: picked2, onChange: setPicked2 }}
          onRowClick={() => {}}
        />
        <p className="text-[0.75rem] text-muted">
          sorted: {sort ? `${sort.key} ${sort.direction}` : "(unsorted)"} · selected:{" "}
          {picked2.size === 0 ? "(none)" : [...picked2].join(", ")}
        </p>
        {/* Empty is a state, not an absence: it says what would be here. */}
        <Table
          columns={[{ key: "name", header: "Name" }] as Column<{ name: string }>[]}
          data={[]}
          getRowKey={(r) => r.name}
          emptyText="No pods"
          emptyHint="Nothing is scheduled in this namespace."
        />
      </section>
      <section>
        <h2>Checkbox</h2>
        <div className="kit-gallery__row">
          <Checkbox checked={boxes.a} onChange={(v) => setBoxes((b) => ({ ...b, a: v }))} label="Include system namespaces" />
          <Checkbox checked={boxes.b} onChange={(v) => setBoxes((b) => ({ ...b, b: v }))} label="Watch for changes" />
          {/* The third state, for a header box over a partial selection — and
              the one the mock lost on the first click. */}
          <Checkbox checked={false} indeterminate onChange={() => {}} label="Select all" />
          <Checkbox checked disabled onChange={() => {}} label="Locked on" />
          <Checkbox checked={boxes.a} onChange={(v) => setBoxes((b) => ({ ...b, a: v }))} ariaLabel="Unlabelled" />
        </div>
      </section>

      <section>
        <h2>Radio</h2>
        {/* One tab stop for the group; arrows move within it, which is the
            browser's doing and the reason these are native inputs. */}
        {[
          { value: "10", label: "Every 10 seconds", hint: "Heaviest on the API server." },
          { value: "30", label: "Every 30 seconds" },
          { value: "off", label: "Never", hint: "Refresh by hand." },
        ].map((option) => (
          <Radio
            key={option.value}
            name="kit-gallery-refresh"
            checked={refresh === option.value}
            onChange={() => setRefresh(option.value)}
            label={option.label}
            hint={option.hint}
          />
        ))}
      </section>

      <section>
        <h2>Switch</h2>
        <Switch on={live} onChange={setLive} label="Live updates" hint="Stream changes as they happen." />
        <Switch on={!live} onChange={() => setLive((v) => !v)} label="Pause on error" danger />
        <Switch on={false} onChange={() => {}} label="Unavailable here" disabled />
        {/* Unlabelled still needs a name; the caller supplies one. */}
        <Switch on={live} onChange={setLive} ariaLabel="Live updates, compact" />
      </section>

      <section>
        <h2>Eyebrow</h2>
        <div className="kit-gallery__row">
          <Eyebrow>since</Eyebrow>
          <Eyebrow tone="warn">degraded</Eyebrow>
          <Eyebrow tone="sev">failing</Eyebrow>
        </div>
      </section>

      <section>
        <h2>SubHead</h2>
        {/* A heading, so the pane it labels has an outline. */}
        <SubHead>Containers</SubHead>
        <p className="text-[0.75rem] text-muted">the group this labels</p>
      </section>

      <section>
        <h2>Stat</h2>
        {/* A divided row: `.stat + .stat` rules between them. */}
        <div className="card flex">
          <Stat label="Nodes" value={12} delta="all ready" tone="ok" className="flex-1" />
          <Stat label="Pods" value="1 284" delta="3 not ready" tone="sev" className="flex-1" />
          <Stat label="Age" value="84d" className="flex-1" />
        </div>
      </section>

      <section>
        <h2>KV</h2>
        {/* A row carries its own name/value group, so one on its own is valid
            markup anywhere — which is why it is used standalone as often as
            through a list. */}
        <KV k="Status" v="Running" />
        <KV k="Image" v="nginx:1.25" mono title="nginx:1.25" />
      </section>

      <section>
        <h2>KVList</h2>
        <Panel title="Pod · web-1">
          <KVList
            rows={[
              ["Kind", "Pod"],
              ["Namespace", "kube-system"],
              ["Image", "nginx:1.25"],
              ["Node", "ip-10-0-1-23"],
            ]}
            mono={(v) => v.includes(":") || v.startsWith("ip-")}
          />
        </Panel>
      </section>

      <section>
        <h2>PairList</h2>
        <SubHead>Labels</SubHead>
        <PairList
          pairs={[
            ["app", "web"],
            ["app.kubernetes.io/managed-by", "Helm"],
          ]}
        />
        {/* Wide enough to read one in full. */}
        <SubHead>Annotations</SubHead>
        <PairList
          breakValues
          pairs={[["kubectl.kubernetes.io/last-applied-configuration", '{"apiVersion":"v1","kind":"Pod"}']]}
        />
      </section>
    </div>
  );
}
