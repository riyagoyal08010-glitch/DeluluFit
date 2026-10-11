import type { Config } from "tailwindcss";

// Every colour comes from a CSS variable defined once in src/styles/index.css.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: token("color-background"),
        surface: { DEFAULT: token("color-surface"), raised: token("color-surface-raised"),
                   muted: token("color-surface-muted") },
        ink: { DEFAULT: token("color-text-primary"), muted: token("color-text-muted"),
               inverse: token("color-background") },
        accent: { DEFAULT: token("color-accent"), strong: token("color-accent-strong") },
        success: token("color-success"),
        warning: token("color-warning"),
        danger: token("color-danger"),
        info: token("color-info"),
        line: token("color-line"),
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["\"Plus Jakarta Sans\"", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      borderRadius: { card: "1.25rem", control: "0.75rem" },
      boxShadow: {
        card: "0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 12px 32px -16px rgb(0 0 0 / 0.6)",
        focus: "0 0 0 3px rgb(var(--color-accent) / 0.45)",
      },
      maxWidth: { content: "72rem" },
    },
  },
  plugins: [],
} satisfies Config;
