import React from "react";
import { Label } from "@/components/ui/label";

export interface FieldProps {
  label: React.ReactNode;
  /**
   * Optional control shown opposite the label (e.g. a "Preview" button).
   * Rendered as a SIBLING of the `<label>`, never inside it: a `<button>` is a
   * labelable element, so nesting it would make label clicks activate it and
   * would swallow its accessible name into the label's name computation.
   */
  action?: React.ReactNode;
  /** Helper text under the control. */
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** A labelled form control: label above, control, optional hint below. */
export function Field({ label, action, hint, children, className }: FieldProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      {action ? (
        <div className="flex items-center justify-between gap-2">
          <Label>{label}</Label>
          {action}
        </div>
      ) : (
        <Label>{label}</Label>
      )}
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
