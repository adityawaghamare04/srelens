/**
 * Design tokens — the single source of truth for the visual language.
 *
 * Values are mirrored as CSS custom properties in `styles.css`. Use the CSS
 * vars (`var(--fl-color-accent)`) in component styles; use this object when
 * you need a token value in TypeScript (e.g. computed inline styles, charts).
 */
export const tokens = {
  color: {
    bg: "#1b1f23",
    surface: "#22272e",
    surfaceAlt: "#2d333b",
    border: "#30363d",
    text: "#e6e6e6",
    textMuted: "#9aa4ad",
    accent: "#2d6cdf",
    accentHover: "#3b78e7",
    danger: "#ff7b72",
    success: "#3fb950",
    warning: "#d29922",
  },
  space: { xs: "4px", sm: "8px", md: "12px", lg: "16px", xl: "24px", xxl: "32px" },
  radius: { sm: "4px", md: "6px", lg: "8px", pill: "999px" },
  font: {
    family: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
    size: { xs: "12px", sm: "13px", md: "14px", lg: "18px", xl: "24px" },
  },
  shadow: { md: "0 2px 8px rgba(0,0,0,0.3)" },
} as const;

export type Tokens = typeof tokens;
