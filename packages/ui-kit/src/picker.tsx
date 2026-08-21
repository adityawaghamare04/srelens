import { useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { Command } from "cmdk";
import { cx } from "./cx";

export interface ComboboxOption {
  value: string;
  label?: string;
}

/** What an option is called. The label is optional because most values read fine on their own. */
export function optionLabel(option: ComboboxOption): string {
  return option.label ?? option.value;
}

export interface PickerProps {
  /** What the trigger says about the current state — a value, a count, a stand-in. */
  summary: string;
  ariaLabel?: string;
  searchPlaceholder?: string;
  className?: string;
  /** The rows, given a way to close the popover — which single-select wants and multi-select does not. */
  children: (close: () => void) => ReactNode;
}

/**
 * The shell both pickers are built out of: a trigger that summarises the
 * current state, and a popover holding a search box over a bounded, scrolling
 * list.
 *
 * `Combobox` and `MultiSelect` are the same control with a different answer to
 * one question — what a row click does. Everything else is identical, and in
 * the classic app it was identical by copy: two files with the same trigger
 * markup, the same popover, the same command list, drifting independently. It
 * lives here once instead, and the two components are left holding only what
 * actually differs between them: the summary, the rows, and whether choosing
 * closes.
 *
 * Radix's Popover and cmdk's Command do the work, for the same reason
 * `ConfirmDialog` leans on Radix's Dialog — positioning against a trigger that
 * may be near a viewport edge, dismissing on an outside click, moving focus to
 * the search box and back to the trigger, and arrow-key navigation over a
 * filtered list are each a library-sized problem, and all four are already
 * solved. What is ours is the seam: which classes it wears, and the render prop
 * below. (#318)
 */
export function Picker({ summary, ariaLabel, searchPlaceholder = "Search…", className, children }: PickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {/* Explicitly a button: these stand in toolbars, a toolbar can stand in
            a form, and a button without a type submits it. Radix supplies
            aria-expanded, aria-controls and data-state; the combobox role is
            ours, because a popover full of options is not the generic dialog
            Radix assumes. */}
        <button type="button" role="combobox" aria-label={ariaLabel} className={cx("btn justify-between", className)}>
          <span className="min-w-0 truncate">{summary}</span>
          {/* Inline rather than an icon-set import: the kit takes no dependency
              on lucide, and these are the only two glyphs it needs. */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 opacity-60">
            <path d="m7 15 5 5 5-5M7 9l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="popover w-[268px]"
          // `.popover` is written for a panel that places itself: `position:
          // fixed`. Radix already fixes and translates a wrapper around this
          // content, and a fixed child leaves that wrapper zero-sized — which
          // is the box the collision logic measures, so the panel would flip
          // and shift against nothing. Relative rather than static keeps the
          // stylesheet's z-index doing its job.
          style={{ position: "relative" }}
        >
          <Command>
            <div className="rule-b flex items-center gap-1.5 px-2 py-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-faint">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m20 20-3.6-3.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <Command.Input
                placeholder={searchPlaceholder}
                className="w-full bg-transparent text-[0.8125rem] outline-none placeholder:text-faint"
              />
            </div>
            {/* Capped and scrolling: the whole reason to reach for this over a
                plain select is that the option set is too long to show. */}
            <Command.List className="scroll max-h-[240px]">
              <Command.Empty className="px-3 py-4 text-center text-[0.75rem] text-faint">No results</Command.Empty>
              {children(() => setOpen(false))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export interface PickerRowProps {
  /** Identifies the row to cmdk's filter, and must be unique within the list. */
  value: string;
  label: string;
  checked: boolean;
  onSelect: () => void;
}

/** One row: a check that holds its column whether or not it is showing, and a label. */
export function PickerRow({ value, label, checked, onSelect }: PickerRowProps) {
  return (
    <Command.Item
      value={value}
      // The row is found by what it says as well as by its value, so an option
      // whose label bears no resemblance to its value is still searchable.
      keywords={[label]}
      onSelect={onSelect}
      data-on={checked}
      // cmdk owns `aria-selected` on these rows and uses it for the highlight
      // that follows the pointer and the arrow keys, so it cannot also carry
      // the chosen state. `aria-checked` is free, and is what a row with a
      // check mark on it means.
      aria-checked={checked}
      // `.ns-row` is the design's row inside a popover, and `data-on` is how it
      // marks the live one. The extra rule is for cmdk's highlight, which
      // follows the pointer and the arrow keys alike — so the keyboard gets the
      // same feedback the mouse does, which a plain `:hover` cannot give it.
      className="ns-row data-[selected=true]:bg-[var(--field)]"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        // Always rendered, never removed: the labels line up in a column, and a
        // check appearing would otherwise shove the row it belongs to sideways.
        className={cx("shrink-0", checked ? "opacity-100" : "opacity-0")}
        style={{ color: "var(--accent)" }}
      >
        <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="truncate">{label}</span>
    </Command.Item>
  );
}
