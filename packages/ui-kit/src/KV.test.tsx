import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KV, KVList } from "./KV";

/** New: the mock shipped these components with no tests at all. (#320) */
describe("KV", () => {
  it("renders the key and the value", () => {
    render(<KV k="Namespace" v="kube-system" />);
    expect(screen.getByText("Namespace")).toBeDefined();
    expect(screen.getByText("kube-system")).toBeDefined();
  });

  it("pairs them as a name and its value", () => {
    // A key and its value are a name/value group, and dl/dt/dd is the markup
    // that says so; two spans say only "two spans".
    const { container } = render(<KV k="Namespace" v="kube-system" />);
    const row = container.querySelector("dl.kv");
    expect(row).not.toBeNull();
    expect(row?.querySelector("dt.kv-k")?.textContent).toBe("Namespace");
    expect(row?.querySelector("dd.kv-v")?.textContent).toBe("kube-system");
  });

  it("carries the whole group itself, so a lone row is valid anywhere", () => {
    // KV is used on its own as often as through KVList in the design, and a dt
    // outside a dl is markup the browser drops the semantics of.
    const { container } = render(<KV k="Namespace" v="kube-system" />);
    expect(container.firstElementChild?.tagName).toBe("DL");
  });

  it("renders the value in the code face when told to", () => {
    const { container } = render(<KV k="Image" v="nginx:1.25" mono />);
    expect(container.querySelector(".kv-v.code")).not.toBeNull();
  });

  it("leaves the value in the UI face otherwise", () => {
    // The mono face is for identifiers; prose set in it reads as a command.
    const { container } = render(<KV k="Status" v="Running" />);
    expect(container.querySelector(".kv-v.code")).toBeNull();
  });

  it("hangs the full value off the value cell as a title", () => {
    const { container } = render(<KV k="Image" v="nginx:1.25" title="nginx:1.25" />);
    expect(container.querySelector(".kv-v")?.getAttribute("title")).toBe("nginx:1.25");
  });

  it("adds no title attribute when there is none to add", () => {
    const { container } = render(<KV k="Status" v="Running" />);
    expect(container.querySelector(".kv-v")?.hasAttribute("title")).toBe(false);
  });

  it("forwards className onto the row", () => {
    const { container } = render(<KV k="Status" v="Running" className="extra" />);
    expect(container.querySelector(".kv.extra")).not.toBeNull();
  });
});

describe("KVList", () => {
  const rows: Array<[string, string]> = [
    ["Kind", "Pod"],
    ["Namespace", "kube-system"],
    ["Image", "nginx:1.25"],
  ];

  it("renders a row per tuple, in the order given", () => {
    const { container } = render(<KVList rows={rows} />);
    expect(Array.from(container.querySelectorAll(".kv-k")).map((e) => e.textContent)).toEqual([
      "Kind",
      "Namespace",
      "Image",
    ]);
    expect(Array.from(container.querySelectorAll(".kv-v")).map((e) => e.textContent)).toEqual([
      "Pod",
      "kube-system",
      "nginx:1.25",
    ]);
  });

  it("adds no wrapper of its own", () => {
    // The rows are meant to land as children of whatever laid the panel out; a
    // block wrapper between them and a flex or grid parent changes the layout.
    const { container } = render(<KVList rows={rows} />);
    expect(container.children.length).toBe(3);
    expect(container.firstElementChild?.classList.contains("kv")).toBe(true);
  });

  it("applies the mono predicate value by value", () => {
    const { container } = render(<KVList rows={rows} mono={(v) => v.includes(":")} />);
    const mono = Array.from(container.querySelectorAll(".kv-v")).map((e) =>
      e.classList.contains("code"),
    );
    expect(mono).toEqual([false, false, true]);
  });

  it("leaves every value in the UI face when no predicate is given", () => {
    const { container } = render(<KVList rows={rows} />);
    expect(container.querySelectorAll(".kv-v.code").length).toBe(0);
  });

  it("does not ask the predicate about a value that is not a string", () => {
    // The predicate is written against text; a node has no text to test, and
    // handing it one would throw inside a caller's one-line arrow function.
    const { container } = render(
      <KVList rows={[["Owner", <a key="o" href="#x">rs/web</a>]]} mono={(v) => v.length > 0} />,
    );
    expect(container.querySelector(".kv-v.code")).toBeNull();
    expect(container.querySelector(".kv-v")?.hasAttribute("title")).toBe(false);
  });

  it("hangs a text value off its cell as a title", () => {
    const { container } = render(<KVList rows={[["Image", "nginx:1.25"]]} />);
    expect(container.querySelector(".kv-v")?.getAttribute("title")).toBe("nginx:1.25");
  });

  it("renders nothing at all for an empty list", () => {
    const { container } = render(<KVList rows={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
