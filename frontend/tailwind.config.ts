import type { Config } from "tailwindcss";

// Every colour comes from a CSS variable defined once in src/styles/index.css.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: token("color-background"),
        sheet: token("color-sheet"),
        surface: { DEFAULT: token("color-surface"), raised: token("color-surface-raised"),
                   muted: token("color-surface-muted") },
        ink: { DEFAULT: token("color-text-primary"), muted: token("color-text-muted"),
               inverse: token("color-on-accent") },
        heading: token("color-heading"),
        accent: { DEFAULT: token("color-accent"), strong: token("color-accent-strong"),
                  soft: token("color-accent-soft"), light: token("color-accent-light"),
                  tint: token("color-accent-tint") },
        action: { DEFAULT: token("color-action"), strong: token("color-action-strong") },
        success: token("color-success"),
        warning: token("color-warning"),
        danger: token("color-danger"),
        info: token("color-info"),
        line: token("color-line"),
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      // Large for image panels and major cards, medium for inputs and list rows.
      borderRadius: { card: "1.75rem", control: "1rem", sheet: "2rem" },
      boxShadow: {
        card: "0 8px 28px rgb(40 60 80 / 0.08)",
        pill: "0 2px 10px rgb(40 60 80 / 0.10)",
        float: "0 18px 44px -14px rgb(30 50 70 / 0.28)",
        focus: "0 0 0 3px rgb(var(--color-accent) / 0.4)",
      },
      maxWidth: { content: "72rem" },
    },
  },
  plugins: [],
} satisfies Config;
