import { cx } from "./cx";

export interface SelectOption {
  value: string;
  label?: string;
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
}

/**
 * Dropdown with a value-first change contract.
 *
 * A native `<select>`, as the new design uses. The classic version wrapped
 * shadcn's Radix select and had to encode `""` as a sentinel, because Radix
 * forbids an empty-string item value — the whole `enc`/`dec` dance exists for
 * that one restriction. A native select has no such rule, so `""` is simply a
 * value and the sentinel is gone. (#318)
 *
 * `placeholder` becomes a disabled leading option, which is how a native select
 * says "nothing chosen yet"; it appears only when no option matches the current
 * value, so it never competes with a real selection.
 */
export function Select({
  value,
  onValueChange,
  options,
  className,
  placeholder,
  "aria-label": ariaLabel,
}: SelectProps) {
  const unmatched = !options.some((o) => o.value === value);
  return (
    <div className="relative inline-flex items-center">
      <select
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        aria-label={ariaLabel}
        className={cx(
          "appearance-none rounded-md border py-1 pl-2 pr-6 text-[0.8125rem] outline-none",
          className,
        )}
        style={{ background: "var(--surface-sunk)", borderColor: "var(--rule)" }}
      >
        {placeholder && unmatched ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label ?? o.value}
          </option>
        ))}
      </select>
      {/* Decorative: the select already announces itself. */}
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        className="pointer-events-none absolute right-1.5"
        style={{ color: "var(--ink-faint)" }}
      >
        <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}
