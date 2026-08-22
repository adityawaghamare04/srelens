import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { Status } from "./Status";
import { ConsoleProvider, useConsole } from "../console";
import { setState } from "../lib/tabsStore";
import { defaultState } from "../lib/tabs";
import { probeCluster, resetProbes } from "../lib/probe";
import { resetView } from "../lib/workspace";

// The forwards store is core's, module-level and driven by the backend, so the
// count is faked at the boundary rather than by starting a real forward. The
// getter hands back the same array until it is swapped, which is what
// `useSyncExternalStore` requires of it.
const forwards = vi.hoisted(() => ({ list: [] as unknown[], notify: new Set<() => void>() }));
vi.mock("@srelens/core", async (orig) => ({
  ...(await orig<typeof import("@srelens/core")>()),
  getForwards: () => forwards.list,
  subscribeForwards: (l: () => void) => {
    forwards.notify.add(l);
    return () => forwards.notify.delete(l);
  },
}));

const ctx = { name: "prod-eu", stableId: "prod", cluster: "c", server: "", isCurrent: false };

beforeEach(() => {
  forwards.list = [];
  resetView();
  resetProbes();
});

/** Reads the console's open flag from outside the bar, the way the dock does. */
function Peek() {
  const { open } = useConsole();
  return <span data-testid="console-open">{String(open)}</span>;
}

function mount(node: ReactNode) {
  return render(
    <ConsoleProvider>
      {node}
      <Peek />
    </ConsoleProvider>,
  );
}

/** Connect the cluster for real through the probe, so link state is derived. */
async function connect(version: string | null) {
  const connectCluster = vi.fn().mockResolvedValue({ context: ctx.name, reachable: true, version });
  await act(async () => {
    await probeCluster(ctx, connectCluster as never);
  });
}

describe("Status", () => {
  it("says so when no cluster is active", () => {
    setState(defaultState([]));
    mount(<Status contexts={[]} />);
    expect(screen.getByText("No cluster")).toBeDefined();
    // Nothing to say about a version nobody asked for.
    expect(screen.queryByText("version unknown")).toBeNull();
  });

  it("names the active cluster, its version and its link", async () => {
    setState(defaultState([ctx]));
    mount(<Status contexts={[ctx]} />);
    await connect("v1.29.0");
    expect(screen.getByText("prod-eu")).toBeDefined();
    expect(screen.getByText("v1.29.0")).toBeDefined();
    expect(screen.getByText("Connected")).toBeDefined();
  });

  it("counts the port-forwards, in the plural the number calls for", () => {
    setState(defaultState([ctx]));
    forwards.list = [{ id: 1 }, { id: 2 }];
    mount(<Status contexts={[ctx]} />);
    expect(screen.getByRole("button", { name: "2 port-forwards" })).toBeDefined();
  });

  it("opens the console from Ask", async () => {
    setState(defaultState([ctx]));
    mount(<Status contexts={[ctx]} />);
    expect(screen.getByTestId("console-open").textContent).toBe("false");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByTestId("console-open").textContent).toBe("true");
  });
});
