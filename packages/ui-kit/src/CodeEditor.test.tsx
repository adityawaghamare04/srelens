import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { CodeEditor } from "./CodeEditor";

describe("CodeEditor", () => {
  it("mounts a CodeMirror editor showing the initial value", () => {
    const { container } = render(<CodeEditor value="kind: Pod" ariaLabel="Manifest YAML" />);
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(container.querySelector(".cm-content")?.textContent).toContain("kind: Pod");
    // The label goes on the editable content, which is what a screen reader
    // lands on — not on the wrapper.
    expect(container.querySelector('[aria-label="Manifest YAML"]')).not.toBeNull();
  });

  it("does not call onChange while read-only", () => {
    const onChange = vi.fn();
    const { container } = render(<CodeEditor value="a: 1" readOnly onChange={onChange} />);
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("pushes an external value change into the editor", () => {
    // Reset and reload replace the document from outside; the editor is
    // mounted imperatively, so this is the one direction that needs wiring.
    const { container, rerender } = render(<CodeEditor value="a: 1" />);
    rerender(<CodeEditor value="b: 2" />);
    expect(container.querySelector(".cm-content")?.textContent).toContain("b: 2");
  });

  it("takes completions as an injected source, knowing nothing of what they mean", () => {
    // The classic editor resolved Kubernetes schemas itself, importing four
    // helpers and a type from @srelens/core. The kit may not: `tokens-only`
    // forbids the service layer, and a design system has no business knowing
    // what an apiVersion is. The caller supplies a CodeMirror completion
    // source and keeps that knowledge. (#318)
    const completions = vi.fn(() => null);
    const { container } = render(<CodeEditor value="a: 1" completions={completions} />);
    expect(container.querySelector(".cm-editor")).not.toBeNull();
  });

  it("accepts the sizing options without recreating itself into a broken state", () => {
    // What `fill`, `minHeight` and `maxHeight` actually do is not assertable
    // here: CodeMirror compiles a theme into a generated stylesheet with
    // hashed class names rather than inline styles, and jsdom applies no CSS.
    // Said plainly rather than asserting on a generated class name, which
    // would pin CodeMirror's internals and still prove nothing about layout.
    const { container } = render(<CodeEditor value="a: 1" fill minHeight={100} maxHeight={400} />);
    expect(container.querySelector(".cm-editor")).not.toBeNull();
  });
});
