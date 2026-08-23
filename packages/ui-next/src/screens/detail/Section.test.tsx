import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KV } from "@srelens/ui-kit";
import { loadSectionFolds, setSectionOpen } from "../../lib/sectionFolds";
import { Section, SectionMemory } from "./Section";

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("a detail section that remembers", () => {
  beforeEach(() => {
    localStorage.clear();
    loadSectionFolds(fakeStorage());
  });

  it("opens shut inside a detail, showing its heading and none of its rows", () => {
    // The reader's request, in one assertion: first open, everything
    // collapsed. The heading stays — a block nobody can see the name of is
    // one nobody can choose to open.
    render(
      <SectionMemory kind="Pod">
        <Section title="Conditions">
          <span>Ready True</span>
        </Section>
      </SectionMemory>,
    );
    expect(screen.getByRole("heading", { level: 3, name: "Conditions" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Conditions" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Ready True")).toBeNull();
  });

  it("remembers what the reader opened, for the next subject of that kind", async () => {
    const first = render(
      <SectionMemory kind="Pod">
        <Section title="Conditions">
          <span>Ready True</span>
        </Section>
      </SectionMemory>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Conditions" }));
    expect(screen.getByText("Ready True")).toBeDefined();
    first.unmount();

    // A different pod, a different pane, the next launch — same kind, so the
    // block the reader opened is open.
    render(
      <SectionMemory kind="Pod">
        <Section title="Conditions">
          <span>Ready False</span>
        </Section>
      </SectionMemory>,
    );
    expect(screen.getByText("Ready False")).toBeDefined();
  });

  it("shuts again on a second click, and remembers that too", async () => {
    render(
      <SectionMemory kind="Pod">
        <Section title="Labels">
          <span>app=web</span>
        </Section>
      </SectionMemory>,
    );
    const toggle = screen.getByRole("button", { name: "Labels" });
    await userEvent.click(toggle);
    expect(screen.getByText("app=web")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Labels" }));
    expect(screen.queryByText("app=web")).toBeNull();
  });

  it("remembers per kind and cannot be opened by another kind's memory", () => {
    // A Deployment's Annotations and a Secret's are the same heading and a
    // different decision. See `sections.tsx` for what rides on that.
    setSectionOpen("Deployment", "Annotations", true, fakeStorage());
    render(
      <SectionMemory kind="Secret">
        <Section title="Annotations">
          <span>held-back</span>
        </Section>
      </SectionMemory>,
    );
    expect(screen.queryByText("held-back")).toBeNull();
    expect(screen.getByRole("button", { name: "Annotations" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("keys a block whose heading counts things on an id the count cannot move", () => {
    // `Data (3 keys)` becomes `Data (4 keys)` the moment someone edits the
    // ConfigMap, and a memory keyed on the heading would be lost with it.
    setSectionOpen("ConfigMap", "Data", true, fakeStorage());
    render(
      <SectionMemory kind="ConfigMap">
        <Section id="Data" title="Data (3 keys)">
          <span>tls.crt</span>
        </Section>
      </SectionMemory>,
    );
    expect(screen.getByText("tls.crt")).toBeDefined();
  });

  it("leaves the unheaded lead block open, since it has no control to offer", () => {
    // The design heads the first fact list with nothing, and a pane that
    // opens showing nothing at all is hostile.
    render(
      <SectionMemory kind="Pod">
        <Section>
          <KV k="Status" v="Running" />
        </Section>
      </SectionMemory>,
    );
    expect(screen.getByText("Running")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("stays open, with no control, wherever there is no detail around it", () => {
    // A body rendered on its own has no kind to key a memory on, so it has
    // nothing to remember — and a block that folded with nowhere to record it
    // would fold back every render.
    render(
      <Section title="Conditions">
        <span>Ready True</span>
      </Section>,
    );
    expect(screen.getByText("Ready True")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps every block a sibling of every other, so the hairlines are unchanged", () => {
    // `.section + .section` draws the rules. The memory adds a control inside
    // a section and never an element between two of them, and a shut section
    // is still a section.
    const { container } = render(
      <SectionMemory kind="Pod">
        <Section title="Conditions">rows</Section>
        <Section title="Labels">rows</Section>
        <Section>rows</Section>
      </SectionMemory>,
    );
    expect([...container.children].every((el) => el.matches("section.section"))).toBe(true);
    expect(container.children).toHaveLength(3);
  });
});

/**
 * The memory cannot be walked around.
 *
 * A body that imports the kit's `Section` directly gets a block that never
 * folds and never remembers, and it looks exactly right on the day it is
 * written — which is how six copies of `StringList` came to live in this
 * directory. Read off the source for the same reason that sweep is.
 */
describe("one Section, reached one way", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(here)
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx") && f !== "Section.tsx")
    .map((f) => ({ file: f, text: readFileSync(join(here, f), "utf8") }));

  /** What a file takes from `@srelens/ui-kit`, across every import of it. */
  const kitImports = (text: string): string =>
    [...text.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*"@srelens\/ui-kit";/g)]
      .map((m) => m[1])
      .join(",");

  it.each(sources.map((s) => s.file))("%s takes its Section from ./Section", (file) => {
    const source = sources.find((s) => s.file === file)!;
    expect(/\bSection\b/.test(kitImports(source.text))).toBe(false);
  });

  it("tells a bare Section from the many names ending in one", () => {
    // `ConditionsSection`, `AnnotationsSection` and `LabelsSection` are this
    // directory's own and come from `./sections`; a sweep that flagged them
    // would be turned off within the week.
    expect(/\bSection\b/.test("KV, Section, StatusPill")).toBe(true);
    expect(/\bSection\b/.test("\n  Section,\n  Table,\n")).toBe(true);
    expect(/\bSection\b/.test("KV, StatusPill, Table")).toBe(false);
    expect(/\bSection\b/.test("AnnotationsSection, ConditionsSection")).toBe(false);
  });

  it("reads a directory with every body in it, so the sweep above is not vacuous", () => {
    const files = sources.map((s) => s.file);
    for (const body of ["CronJobBody", "GenericBody", "PodBody", "SecretBody", "ServiceBody", "WorkloadBody"]) {
      expect(files).toContain(`${body}.tsx`);
    }
  });
});
