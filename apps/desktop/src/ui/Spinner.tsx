import React from "react";
import { Spinner as ShadSpinner } from "@/components/ui/spinner";

export interface SpinnerProps extends Omit<React.ComponentProps<typeof ShadSpinner>, "aria-label"> {
  /** Accessible label; defaults to "Loading". */
  label?: string;
}

/**
 * Indeterminate loading spinner. Local wrapper over shadcn's Spinner; inherits
 * the current text colour so it blends wherever it sits inline with a label.
 */
export function Spinner({ label = "Loading", ...props }: SpinnerProps) {
  return <ShadSpinner aria-label={label} {...props} />;
}
