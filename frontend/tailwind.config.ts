import type { Config } from "tailwindcss";

// Every colour comes from a CSS variable defined once in src/styles/index.css.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;
// A palette colour at a fixed transparency (opacity modifiers still multiply it).
const tint = (name: string, alpha: number) => `rgb(var(--${name}) / calc(<alpha-value> * ${alpha}))`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: token("color-background"),
        sheet: token("color-sheet"),
        surface: { DEFAULT: token("color-surface"), raised: tint("color-tint", 0.08),
                   muted: token("color-surface-muted") },
        ink: { DEFAULT: token("color-text-primary"), muted: token("color-text-muted"),
               subtle: token("color-text-subtle"), inverse: token("color-on-accent") },
        heading: token("color-heading"),
        accent: { DEFAULT: token("color-accent"), strong: token("color-accent-strong"),
                  soft: token("color-accent-soft"), light: token("color-accent-light"),
                  tint: tint("color-tint", 0.12) },
        action: { DEFAULT: token("color-action"), strong: token("color-action-strong") },
        success: token("color-success"),
        warning: token("color-warning"),
        danger: token("color-danger"),
        info: token("color-info"),
        teal: token("color-teal"),
        line: tint("color-line", 0.14),
        // Preflight reads gray-400 for placeholders; point it at the palette (Ash Mist).
        gray: { 400: "#9A9A9A" },
      },
      fontFamily: {
        // Defined once in src/styles/index.css (--font-body / --font-display).
        sans: ["var(--font-body)"],
        display: ["var(--font-display)"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      // Inter at the reference's text sizes: 12px captions, 14px interface, 16px body.
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1.125rem" }],      // 12px — metadata, hints, errors
        sm: ["0.875rem", { lineHeight: "1.375rem" }],     // 14px — labels, lists, tables
        base: ["1rem", { lineHeight: "1.6rem" }],         // 16px — body copy
      },
      // Lifted geometry (F39): cards, panels and images are softly rounded, inputs and
      // tiles a little tighter; buttons and tags stay full pills (rounded-full).
      borderRadius: { card: "1.25rem", control: "0.75rem", sheet: "1.75rem" },
      // Elevation (F39): layered, low-contrast black shadows so every box sits a little
      // above the page. card is the resting lift; float is for dialogs, popovers and bars.
      boxShadow: {
        card: "0 1px 2px rgb(0 0 0 / 0.05), 0 8px 24px -8px rgb(0 0 0 / 0.14)",
        pill: "0 1px 2px rgb(0 0 0 / 0.06), 0 4px 12px -4px rgb(0 0 0 / 0.12)",
        float: "0 2px 4px rgb(0 0 0 / 0.06), 0 20px 48px -16px rgb(0 0 0 / 0.28)",
        // A white gap then a black ring, visible on white, gray and black surfaces.
        focus: "0 0 0 2px rgb(var(--palette-paper)), 0 0 0 4px rgb(var(--palette-obsidian))",
      },
      transitionTimingFunction: { glide: "cubic-bezier(0.19, 1, 0.22, 1)" },
      transitionDuration: { glide: "800ms" },
      maxWidth: { content: "72rem" },
      // Tailwind defaults (grey border, blue ring, white ring offset) replaced with palette values.
      borderColor: { DEFAULT: tint("color-line", 0.22) },
      ringColor: { DEFAULT: "rgb(0 0 0 / 0.5)" },   // a literal because Tailwind parses this default
      ringOffsetColor: { DEFAULT: token("palette-paper") },
    },
  },
  plugins: [],
} satisfies Config;
