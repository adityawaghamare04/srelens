import { describe, it, expect, afterEach } from "vitest";
import { tabbable } from "./tabbable";

/**
 * One case per review finding on #324, tested directly rather than through a
 * dialog. Going through a component made each of these an awkward integration
 * test and hid what was actually being asserted; here the contract is the
 * subject. (#324 review)
 */
let host: HTMLElement | null = null;

function mount(html: string): HTMLElement {
  host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  host?.remove();
  host = null;
});

const names = (root: HTMLElement) => tabbable(root).map((el) => el.getAttribute("data-n"));

describe("tabbable", () => {
  it("returns nothing for no root", () => {
    expect(tabbable(null)).toEqual([]);
  });

  it("finds the ordinary controls in DOM order", () => {
    const root = mount(`
      <a href="#" data-n="link">l</a>
      <button data-n="button">b</button>
      <input data-n="input" />
      <select data-n="select"></select>
      <textarea data-n="textarea"></textarea>
      <div tabindex="0" data-n="div">d</div>
    `);
    expect(names(root)).toEqual(["link", "button", "input", "select", "textarea", "div"]);
  });

  it("skips a disabled control", () => {
    const root = mount(`<button disabled data-n="off">a</button><button data-n="on">b</button>`);
    expect(names(root)).toEqual(["on"]);
  });

  it("skips a control disabled by an ancestor fieldset", () => {
    // The control reports disabled === false; only :disabled knows.
    const root = mount(`
      <fieldset disabled><button data-n="off">a</button></fieldset>
      <button data-n="on">b</button>
    `);
    expect(names(root)).toEqual(["on"]);
  });

  it("skips a hidden input", () => {
    const root = mount(`<input type="hidden" data-n="off" /><button data-n="on">b</button>`);
    expect(names(root)).toEqual(["on"]);
  });

  it("skips anything under [hidden]", () => {
    const root = mount(`<div hidden><button data-n="off">a</button></div><button data-n="on">b</button>`);
    expect(names(root)).toEqual(["on"]);
  });

  it("skips a control under a display:none ancestor", () => {
    // display does not inherit, so the control's own value says nothing.
    const root = mount(`
      <div style="display:none"><button data-n="off">a</button></div>
      <button data-n="on">b</button>
    `);
    expect(names(root)).toEqual(["on"]);
  });

  it("skips a control made invisible", () => {
    const root = mount(`
      <button style="visibility:hidden" data-n="off">a</button>
      <button data-n="on">b</button>
    `);
    expect(names(root)).toEqual(["on"]);
  });

  it("skips a control inside an inert subtree", () => {
    const root = mount(`<div inert><button data-n="off">a</button></div><button data-n="on">b</button>`);
    expect(names(root)).toEqual(["on"]);
  });

  it("skips a negative tab index on any element type", () => {
    const root = mount(`
      <button tabindex="-1" data-n="b">a</button>
      <input tabindex="-1" data-n="i" />
      <div tabindex="-1" data-n="d">d</div>
      <button data-n="on">b</button>
    `);
    expect(names(root)).toEqual(["on"]);
  });

  it("counts a radio group as one stop, preferring the checked member", () => {
    const root = mount(`
      <input type="radio" name="g" data-n="first" />
      <input type="radio" name="g" checked data-n="checked" />
      <button data-n="after">b</button>
    `);
    expect(names(root)).toEqual(["checked", "after"]);
  });

  it("falls back to the first radio when none is checked", () => {
    const root = mount(`
      <input type="radio" name="g" data-n="first" />
      <input type="radio" name="g" data-n="second" />
    `);
    expect(names(root)).toEqual(["first"]);
  });

  it("treats same-named radios in different forms as separate groups", () => {
    const root = mount(`
      <form><input type="radio" name="g" checked data-n="one" /></form>
      <form><input type="radio" name="g" checked data-n="two" /></form>
    `);
    expect(names(root)).toEqual(["one", "two"]);
  });

  it("orders positive tab indexes ahead of the document flow", () => {
    // The browser visits positive indexes first, ascending, then everything at
    // 0 in DOM order. A list in DOM order puts the real first stop at a nonzero
    // index, and a trap keyed on that lets Shift+Tab escape.
    const root = mount(`
      <button data-n="flow1">a</button>
      <button tabindex="2" data-n="second">b</button>
      <button tabindex="1" data-n="first">c</button>
      <button data-n="flow2">d</button>
    `);
    expect(names(root)).toEqual(["first", "second", "flow1", "flow2"]);
  });

  it("includes implicitly tabbable elements", () => {
    // A contenteditable region and a <summary> are sequential tab stops without
    // carrying a tabindex, so a selector listing only the classic form controls
    // skipped them — and the trap then wrapped straight past, making them
    // unreachable by keyboard inside a dialog. (#324 review)
    const root = mount(`
      <div contenteditable="true" data-n="editor"></div>
      <details data-n="details"><summary data-n="summary">s</summary><p>body</p></details>
      <button data-n="button">b</button>
    `);
    expect(names(root)).toEqual(["editor", "summary", "button"]);
  });

  it("ignores contenteditable=\"false\"", () => {
    const root = mount(`<div contenteditable="false" data-n="off"></div><button data-n="on">b</button>`);
    expect(names(root)).toEqual(["on"]);
  });

  it("skips controls collapsed inside a closed details", () => {
    // A closed <details> hides its body without that showing up in the
    // computed display of the controls inside it.
    const root = mount(`
      <details><summary data-n="summary">s</summary><button data-n="inside">a</button></details>
      <button data-n="after">b</button>
    `);
    expect(names(root)).toEqual(["summary", "after"]);
  });

  it("includes them once the details is open", () => {
    const root = mount(`
      <details open><summary data-n="summary">s</summary><button data-n="inside">a</button></details>
    `);
    expect(names(root)).toEqual(["summary", "inside"]);
  });

  it("keeps DOM order among equal tab indexes", () => {
    const root = mount(`
      <button tabindex="1" data-n="a">a</button>
      <button tabindex="1" data-n="b">b</button>
    `);
    expect(names(root)).toEqual(["a", "b"]);
  });
});
