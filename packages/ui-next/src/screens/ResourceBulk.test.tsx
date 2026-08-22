import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Everything this screen reaches into core for. Mocked so a test can control
// what a write "does" without a real cluster, and can make one fail on demand
// — the partial-failure report is the whole point of one of these tests.
type ActionResult = { ok?: boolean; error?: string };

const { deleteResource, evictPod, rolloutRestart } = vi.hoisted(() => ({
  deleteResource: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  evictPod: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
  rolloutRestart: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
}));

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  deleteResource,
  evictPod,
  rolloutRestart,
}));

import { ResourceBulk } from "./ResourceBulk";
import type { KindDescriptor, ListRow } from "../lib/kinds/types";

const PODS: ListRow[] = [
  { name: "web-0", namespace: "kube-system" },
  { name: "web-0", namespace: "prod" },
  { name: "api-1", namespace: "prod" },
];

const POD_DESCRIPTOR: KindDescriptor = {
  k8sKind: "Pod",
  columns: [],
  source: "watch",
  scope: "namespaced",
  actions: { evict: true },
};

const DEPLOY_DESCRIPTOR: KindDescriptor = {
  k8sKind: "Deployment",
  columns: [],
  source: "watch",
  scope: "namespaced",
  actions: { restart: true },
};

function keyOf(row: ListRow): string {
  return `${row.namespace ?? ""}/${row.name}`;
}

const ALL_SELECTED = new Set(PODS.map(keyOf));

beforeEach(() => {
  vi.clearAllMocks();
  // A prior test's `mockImplementation` (the partial-failure case) would
  // otherwise leak into the next one — `clearAllMocks` resets call history,
  // not a swapped-in implementation.
  deleteResource.mockResolvedValue({ ok: true });
  evictPod.mockResolvedValue({ ok: true });
  rolloutRestart.mockResolvedValue({ ok: true });
});

describe("ResourceBulk", () => {
  it("stays out of the way until something is selected", () => {
    const { container } = render(
      <ResourceBulk
        selected={new Set()}
        kind="pods"
        descriptor={POD_DESCRIPTOR}
        context="prod"
        rows={PODS}
        onDone={() => {}}
      />,
    );
    expect(container.textContent).toBe("");
  });

  // Whole-branch review (FIX 2): `Table` never prunes `selection.selected`
  // when its data changes — select rows, then filter the list down to none
  // of them, and the stale keys are still in `selected`. The bar must count
  // (and act on) only the selection that resolves against the rows it was
  // actually handed, not the raw key count, or Delete opens a confirm for
  // rows that no longer exist and a mismatched count.
  it("counts and acts on only the selected keys still present in rows, not stale ones", () => {
    const selected = new Set([...PODS.map(keyOf), "ghost-ns/ghost-pod"]);
    render(
      <ResourceBulk
        selected={selected}
        kind="pods"
        descriptor={POD_DESCRIPTOR}
        context="prod"
        rows={PODS}
        onDone={() => {}}
      />,
    );
    // Not "4 selected" — the ghost key was never in `rows`.
    expect(screen.getByText("3 selected")).toBeDefined();
  });

  it("stays out of the way when every selected key has fallen out of the rows", () => {
    const { container } = render(
      <ResourceBulk
        selected={new Set(["ghost-ns/ghost-pod"])}
        kind="pods"
        descriptor={POD_DESCRIPTOR}
        context="prod"
        rows={PODS}
        onDone={() => {}}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("counts what is selected, in words", () => {
    render(
      <ResourceBulk
        selected={ALL_SELECTED}
        kind="pods"
        descriptor={POD_DESCRIPTOR}
        context="prod"
        rows={PODS}
        onDone={() => {}}
      />,
    );
    expect(screen.getByText("3 selected")).toBeDefined();
  });

  it("asks once for the whole selection, naming how many", async () => {
    render(
      <ResourceBulk
        selected={ALL_SELECTED}
        kind="pods"
        descriptor={POD_DESCRIPTOR}
        context="prod"
        rows={PODS}
        onDone={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    // Exactly one dialog, not one per row.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByText("Delete 3 pods?")).toBeDefined();
    expect(deleteResource).not.toHaveBeenCalled();
  });

  it("acts on every selected row, by namespace and name", async () => {
    render(
      <ResourceBulk
        selected={ALL_SELECTED}
        kind="pods"
        descriptor={POD_DESCRIPTOR}
        context="prod"
        rows={PODS}
        onDone={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteResource).toHaveBeenCalledTimes(3));
    expect(deleteResource).toHaveBeenCalledWith("prod", "Pod", "kube-system", "web-0");
    // The other same-named pod, in a different namespace, is a distinct call.
    expect(deleteResource).toHaveBeenCalledWith("prod", "Pod", "prod", "web-0");
    expect(deleteResource).toHaveBeenCalledWith("prod", "Pod", "prod", "api-1");
  });

  it("says which succeeded and which did not, rather than 'some failed'", async () => {
    // `runBulk`'s workers pull items off the front of the list synchronously
    // before their first await, so with concurrency >= item count the calls
    // land in `PODS` order — the first is `kube-system/web-0`.
    deleteResource.mockResolvedValueOnce({ error: "forbidden" }).mockResolvedValue({ ok: true });
    render(
      <ResourceBulk
        selected={ALL_SELECTED}
        kind="pods"
        descriptor={POD_DESCRIPTOR}
        context="prod"
        rows={PODS}
        onDone={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteResource).toHaveBeenCalledTimes(3));
    // Names the row that failed and why, and the ones that did not.
    expect(await screen.findByText(/kube-system\/web-0/)).toBeDefined();
    expect(screen.getByText(/forbidden/)).toBeDefined();
    expect(screen.getByText(/prod\/web-0/)).toBeDefined();
    expect(screen.getByText(/prod\/api-1/)).toBeDefined();
    expect(screen.queryByText(/some failed/i)).toBeNull();
  });

  // Whole-branch review (FIX 3): same reason as the row menu's own gate — a
  // custom resource's Delete always fails against the backend's kind→GVR
  // resolution, so the bulk bar must not offer it either.
  it("withholds Delete when the kind's actions say so", () => {
    const noDeleteDescriptor: KindDescriptor = {
      k8sKind: "Widget",
      columns: [],
      source: "poll",
      scope: "namespaced",
      actions: { delete: false },
    };
    render(
      <ResourceBulk
        selected={ALL_SELECTED}
        kind="widgets"
        descriptor={noDeleteDescriptor}
        context="prod"
        rows={PODS}
        onDone={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("offers evict only where the kind has it", () => {
    const pods = render(
      <ResourceBulk
        selected={ALL_SELECTED}
        kind="pods"
        descriptor={POD_DESCRIPTOR}
        context="prod"
        rows={PODS}
        onDone={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Evict" })).toBeDefined();
    pods.unmount();

    render(
      <ResourceBulk
        selected={ALL_SELECTED}
        kind="deployments"
        descriptor={DEPLOY_DESCRIPTOR}
        context="prod"
        rows={PODS}
        onDone={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Evict" })).toBeNull();
    // Deployments have restart instead.
    expect(screen.getByRole("button", { name: "Restart rollout" })).toBeDefined();
  });

  it("clears the selection once the action is done", async () => {
    const onDone = vi.fn();
    render(
      <ResourceBulk
        selected={ALL_SELECTED}
        kind="pods"
        descriptor={POD_DESCRIPTOR}
        context="prod"
        rows={PODS}
        onDone={onDone}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // A clean run closes the dialog rather than leaving a report open.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("evicts by namespace and name, not delete, when Evict is picked", async () => {
    render(
      <ResourceBulk
        selected={ALL_SELECTED}
        kind="pods"
        descriptor={POD_DESCRIPTOR}
        context="prod"
        rows={PODS}
        onDone={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Evict" }));
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: "Evict" }));

    await waitFor(() => expect(evictPod).toHaveBeenCalledTimes(3));
    expect(evictPod).toHaveBeenCalledWith("prod", "kube-system", "web-0");
    expect(deleteResource).not.toHaveBeenCalled();
  });

  it("restarts the rollout of every selected row when the kind offers it", async () => {
    render(
      <ResourceBulk
        selected={ALL_SELECTED}
        kind="deployments"
        descriptor={DEPLOY_DESCRIPTOR}
        context="prod"
        rows={PODS}
        onDone={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Restart rollout" }));
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: "Restart" }));

    await waitFor(() => expect(rolloutRestart).toHaveBeenCalledTimes(3));
    expect(rolloutRestart).toHaveBeenCalledWith("prod", "Deployment", "prod", "api-1");
  });
});
