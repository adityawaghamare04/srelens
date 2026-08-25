import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ageFromTimestamp,
  copyKubectlCommand,
  forwardAddress,
  getForwards,
  kindToForwardTarget,
  notify,
  plural,
  rehydrateForwards,
  stopPortForward,
  subscribeForwards,
  toKubectl,
  type ActiveForward,
} from "@srelens/core";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Screen,
  StatusPill,
  Table,
  type Column,
  type StatusKind,
} from "@srelens/ui-kit";
import { useActiveContext } from "../lib/clusters";
import { FailureAlert } from "../lib/errorCopy";
import { Icons } from "../lib/icons";
import { formatBytes } from "../lib/numbers";
import { NewForwardDialog } from "./forwards/NewForwardDialog";

/**
 * THE ONE HAND-PAIRED WORD/TONE TABLE ON THIS SCREEN, AND IT IS MARKED BECAUSE
 * IT SHOULD NOT HAVE TO EXIST.
 *
 * `packages/core` has no verdict for a port-forward's status. It has one for a
 * log stream's connection (`logConnectionStatus`) and two for Kubernetes
 * resources (`k8sStatus`, `k8sHealth`), and a tunnel is none of those three:
 * its states are `active | reconnecting | failed`, which is a different union
 * from `connecting | live | reconnecting | error` and means different things —
 * a log stream that is "live" is being read, a forward that is "active" may
 * have moved nothing all day. Widening either of the existing unions to cover
 * this would put four words on a screen that can only ever show three.
 * **If a `forwardStatus` verdict is ever added to `packages/core`, delete this
 * and call it** — and do not spell `status === "active" ? … : …` anywhere else.
 *
 * §13's rule is "`active`→ok, else warn + bold". `failed` is shipped as
 * `danger` rather than `warning` on purpose: §13 draws only the first two
 * states and its "else" was written about `reconnecting`. A tunnel that is
 * reconnecting is coming back; one that has failed is gone, and the row's Stop
 * button is the only thing left to do about it. Amber for both would say the
 * two are the same news.
 *
 * `tinted` follows the design's asymmetric colouring rule, which
 * {@link StatusPill} owns: the bad states colour and embolden the word, the
 * good one reads plain. It is decided here, beside the word, so a copy-paste
 * cannot pair "Active" with the emphasis a failure gets.
 */
const FORWARD_VERDICT: Record<ActiveForward["status"], { word: string; kind: StatusKind }> = {
  active: { word: "Active", kind: "success" },
  reconnecting: { word: "Reconnecting", kind: "warning" },
  failed: { word: "Failed", kind: "danger" },
};

/**
 * kubectl's own short target forms, which is what §13 writes in the Target
 * column (`svc/checkout-api`, `pod/search-indexer-0`).
 *
 * Core's `kindToForwardTarget`, which is also what `toKubectl` puts in the
 * command this row copies and what §A.4's dialog names its options with. This
 * screen used to keep a private `{ Service: "svc", Pod: "pod" }` table beside
 * it; three consumers of one rule beats three copies of it, and a drift would
 * have had the cell and the clipboard disagreeing about what a row is.
 */
function targetOf(kind: string, name: string): string {
  return `${kindToForwardTarget(kind)}/${name}`;
}

/**
 * How often the Age column recomputes.
 *
 * A screen of live tunnels is the one place in the app where a frozen age is a
 * lie the reader would act on — "18m" under a forward that died an hour ago.
 * Every other Age in the app is re-read when its list is re-fetched; nothing
 * re-fetches here, because the store is pushed to. A second is the resolution
 * of core's own age words below a minute, and the backend already pushes a
 * traffic total about that often, so this costs nothing a live forward was not
 * already costing.
 */
const AGE_TICK_MS = 1_000;

/** One row of §13's table: every cell already resolved to what it renders. */
interface ForwardRow {
  id: number;
  /** `svc/checkout-api` — kubectl's name for the thing, not Kubernetes's. */
  target: string;
  namespace: string;
  cluster: string;
  /**
   * Where this forward is reachable FROM THE MACHINE READING THIS PAGE —
   * `forwardAddress`, never a locally assembled `localhost:<port>`. See
   * {@link Forwards}.
   */
  address: string;
  remote: string;
  status: ActiveForward["status"];
  traffic: string;
  bytesMoved: number;
  age: string;
  startedAt: number;
  command: string;
}

/**
 * `/forwards` — the design's Port forwards screen (§13).
 *
 * A port-forward pipes a local port to a Pod or a Service; this is the list of
 * the ones that are live, and the only place in the app that can stop one.
 * There is no fetch here: `packages/core`'s forwards store is module-level and
 * pushed to by the backend, so the table is a `useSyncExternalStore` over it.
 *
 * **Two things §13 asks for are deliberately not shipped as written.**
 *
 * §13's Copy URL writes `http://localhost:<local>`. That is the DESKTOP answer
 * and only the desktop answer: in web mode srelens runs in a container whose
 * loopback the browser cannot reach, and the address is a same-origin
 * `/pf/<id>/` proxy instead. `forwardAddress` in core already decides this, and
 * the button and the Local cell both read it rather than re-deriving it — so
 * what the row shows and what the clipboard gets cannot disagree. The Local
 * column shows that same address for the same reason: a column headed `Local`
 * printing a port nothing on this machine is listening on is worse than a long
 * URL.
 *
 * §13 also says, in as many words, that the design defines an empty state for
 * this screen in the Components gallery and never renders it here. It renders
 * here. A reader with no tunnels needs the sentence about what a forward is
 * and the button that makes one far more than a reader with four does.
 *
 * **The age ticks.** See {@link AGE_TICK_MS}.
 */
export function Forwards(_props: { route: string }) {
  const forwards = useSyncExternalStore(subscribeForwards, getForwards, getForwards);
  const cluster = useActiveContext();

  /**
   * Adopt whatever the backend is still forwarding.
   *
   * This is what makes the screen honest after a browser reload. The store is
   * module-level JavaScript and a reload empties it; `ForwardManager` on the
   * other side does not die, so without this a web reader reloads into an
   * empty table while their tunnels keep running and nothing in the app can
   * stop them. `rehydrateForwards` never rejects — a failed listing is
   * reported to the reader by core itself — which is why it is called bare.
   */
  useEffect(() => {
    void rehydrateForwards();
  }, []);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(tick);
  }, []);

  /** The last stop that was refused, and which tunnel it was about. */
  const [stopFailure, setStopFailure] = useState<{ target: string; error: unknown } | null>(null);

  const rows = useMemo<ForwardRow[]>(
    () =>
      forwards.map((f) => ({
        id: f.id,
        target: targetOf(f.kind, f.name),
        namespace: f.namespace,
        cluster: f.context,
        address: forwardAddress({ id: f.id, localPort: f.localPort }),
        // The remote port reads as a port, `:443`, which is how the design
        // writes the far end of a forward and how kubectl's own output does.
        remote: `:${f.remotePort}`,
        status: f.status,
        traffic: formatBytes(f.bytesMoved),
        bytesMoved: f.bytesMoved,
        // Core's compact age, from the backend's own start stamp. §13 writes
        // `2h 04m`; every other Age in this app is one value and one unit, and
        // a screen that spelled minutes-past-the-hour here would be the only
        // one — the extra precision is not worth a second way of saying an age.
        age: ageFromTimestamp(new Date(f.startedAt).toISOString(), now),
        startedAt: f.startedAt,
        command: toKubectl({
          action: "port-forward",
          kind: f.kind,
          name: f.name,
          context: f.context,
          namespace: f.namespace,
          localPort: f.localPort,
          remotePort: f.remotePort,
        }),
      })),
    [forwards, now],
  );

  const clusters = useMemo(() => new Set(rows.map((r) => r.cluster)).size, [rows]);
  const moved = useMemo(() => rows.reduce((sum, r) => sum + r.bytesMoved, 0), [rows]);

  /**
   * §A.4's dialog, opened from the header action and from the empty state's
   * way out — one handler behind both, so a reader with no tunnels reaches the
   * same dialog as one with four.
   */
  const [newForwardOpen, setNewForwardOpen] = useState(false);
  const openNewForward = () => setNewForwardOpen(true);

  const newForwardButton = (
    <Button variant="primary" size="sm" onClick={openNewForward}>
      New forward
    </Button>
  );

  async function stop(row: ForwardRow) {
    setStopFailure(null);
    try {
      await stopPortForward(row.id);
    } catch (e) {
      setStopFailure({ target: row.target, error: e });
    }
  }

  async function copyAddress(row: ForwardRow) {
    try {
      await navigator.clipboard.writeText(row.address);
      notify.success("Copied the forward's address");
    } catch {
      // No clipboard on a non-secure origin, and nothing to recover: the
      // address is rendered in full in the row's own Local cell and can be
      // selected. Saying "Copied" when nothing was copied is the only real harm.
    }
  }

  const columns: Column<ForwardRow>[] = [
    ...COLUMNS,
    {
      // §13's unnamed trailing column. Three compact controls rather than the
      // inline `CopyCommand` §13 names: that component prints the whole command
      // beside its button and refuses to truncate it, which is right in a rail
      // and is a paragraph per row in a 128px column. The command is still one
      // click away, and it is still core's `toKubectl` string verbatim.
      key: "actions",
      header: "",
      sortable: false,
      filterable: false,
      align: "end",
      minWidth: 128,
      render: (row) => (
        <div className="flex items-center justify-end gap-0.5">
          <IconButton
            icon={Icons.terminal}
            // Named per row: four rows all offering "Copy" name nothing at all.
            // The name carries the TARGET, which the row already shows — never
            // the command or the address, which it must not hide in a title.
            label={`Copy kubectl command for ${row.target}`}
            onClick={() => void copyKubectlCommand(row.command)}
          />
          <IconButton
            icon={Icons.copy}
            label={`Copy address for ${row.target}`}
            onClick={() => void copyAddress(row)}
          />
          <IconButton
            icon={Icons.close}
            danger
            label={`Stop forwarding ${row.target}`}
            onClick={() => void stop(row)}
          />
        </div>
      ),
    },
  ];

  return (
    <Screen title="Port forwards" eyebrow="all clusters" actions={newForwardButton} fill>
      {/* Beside the body rather than inside either branch of it, so the dialog
          opens the same from a populated screen and an empty one. */}
      {newForwardOpen && (
        <NewForwardDialog
          // The cluster in focus. A forward is made in one cluster even though
          // this screen lists every cluster's, and the rail's selection is the
          // only answer the app has to *which*; the dialog says so itself when
          // there is none rather than being opened against an empty context.
          context={cluster?.name ?? ""}
          namespace={cluster?.namespace}
          onClose={() => setNewForwardOpen(false)}
        />
      )}
      {stopFailure && (
        <div className="p-3 pb-0">
          <FailureAlert
            tone="sev"
            title={`Could not stop ${stopFailure.target}`}
            error={stopFailure.error}
          />
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState
          title="No port forwards"
          hint="Forward a service port to reach it from this machine. Nothing is exposed outside your laptop."
          action={newForwardButton}
          // `fill` hands the body the whole area and leaves the centring to
          // whatever is in it; without this the state sits at the top edge.
          className="flex-1"
        />
      ) : (
        <>
          <div className="pane-head">
            <span>{`Active tunnels · ${rows.length} across ${plural(clusters, "cluster")}`}</span>
            {/* Pushes the badge to the far end without either side needing to
                know how wide the other is. */}
            <span className="flex-1" />
            <Badge tone="ok">{`${formatBytes(moved)} moved`}</Badge>
          </div>
          <div className="scroll min-h-0 flex-1">
            <Table columns={columns} data={rows} getRowKey={(row) => String(row.id)} />
          </div>
        </>
      )}
    </Screen>
  );
}

/**
 * §13's columns, in §13's order.
 *
 * Module-level and free of handlers so the sort and filter values are read off
 * the same strings the reader sees — a filter for `staging` that matched
 * nothing because the cell was built from a different field is the sort of
 * mismatch nobody reports. The two numeric columns are the exception and say
 * why at each one.
 */
const COLUMNS: Column<ForwardRow>[] = [
  {
    key: "target",
    header: "Target",
    // Both lines are searchable: a reader looking for `checkout` means either
    // the service or the namespace and should not have to know which.
    getValue: (row) => `${row.target} ${row.namespace}`,
    render: (row) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{row.target}</span>
        <span className="path truncate">{row.namespace}</span>
      </div>
    ),
  },
  {
    key: "cluster",
    header: "Cluster",
    // `block`, not a bare span: `truncate` sets `overflow: hidden`, which does
    // nothing to an inline box. A kubeconfig context name is user-chosen and
    // routinely long — `m01-1786968575165/kubernetes-admin@cluster.local` —
    // and without this it draws straight over the Local cell beside it.
    render: (row) => <span className="path block truncate">{row.cluster}</span>,
  },
  {
    key: "address",
    header: "Local",
    render: (row) => <span className="code block truncate">{row.address}</span>,
  },
  {
    key: "remote",
    header: "Remote",
    // Sorted as the number it is: `:443` beside `:8080` and `:9090` orders
    // 443, 8080, 9090 numerically and "443", "8080", "9090" the same way by
    // luck — `:6060` and `:443` do not.
    getSortValue: (row) => Number(row.remote.slice(1)),
    render: (row) => <span className="tabular-nums">{row.remote}</span>,
  },
  {
    key: "state",
    header: "State",
    // Sorted and searched on the word the reader can see, not on the internal
    // status behind it.
    getValue: (row) => FORWARD_VERDICT[row.status].word,
    render: (row) => (
      <StatusPill
        status={FORWARD_VERDICT[row.status].word}
        kind={FORWARD_VERDICT[row.status].kind}
        tinted
      />
    ),
  },
  {
    key: "traffic",
    header: "Traffic",
    align: "end",
    // The bytes, not the words: `312 KB` sorts above `44.1 MB` as text.
    getSortValue: (row) => row.bytesMoved,
    render: (row) => <span className="tabular-nums">{row.traffic}</span>,
  },
  {
    key: "age",
    header: "Age",
    align: "end",
    // The start stamp, not the compact age: `2h` sorts below `51m` as text,
    // which is the defect `ageSeconds` exists for — and this row has the
    // original millis, so it does not need to parse its own words back.
    getSortValue: (row) => row.startedAt,
    render: (row) => <span className="tabular-nums text-muted">{row.age}</span>,
  },
];
