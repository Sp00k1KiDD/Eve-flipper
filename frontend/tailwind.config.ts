import type { Config } from "tailwindcss";

/** Helper: creates a Tailwind color value from a CSS RGB-triplet variable
 *  that supports opacity modifiers like bg-eve-accent/10 */
function v(name: string) {
  return `rgb(var(--eve-${name}) / <alpha-value>)`;
}

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        eve: {
          dark: v("dark"),
          panel: v("panel"),
          "panel-hover": v("panel-hover"),
          input: v("input"),
          accent: v("accent"),
          "accent-hover": v("accent-hover"),
          "accent-dim": v("accent-dim"),
          text: v("text"),
          dim: v("dim"),
          success: v("success"),
          error: v("error"),
          warning: v("warning"),
          border: v("border"),
          "border-light": v("border-light"),
          glow: "var(--eve-glow)",
        },
      },
      fontFamily: {
        eve: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Consolas", "Monaco", "monospace"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Consolas", "Monaco", "monospace"],
      },
      boxShadow: {
        "eve-glow": "0 0 8px var(--eve-glow)",
        "eve-glow-strong": "0 0 16px var(--eve-glow)",
        "eve-inset": "inset 0 1px 3px rgba(0, 0, 0, 0.5)",
      },
    },
  },
  plugins: [],
};
export default config;
