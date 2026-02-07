import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createElement } from "react";

// ===================================================================
// Types
// ===================================================================

export type ThemeMode = "dark" | "light" | "auto";
export type FontSize = "xs" | "sm" | "md" | "lg" | "xl";

// Built-in palette IDs (string-based so custom_* IDs also work)
export type Palette = string;

export interface CustomPaletteColors {
  bg: string;       // hex #rrggbb
  panel: string;
  accent: string;
  text: string;
  dim: string;
  success: string;
  error: string;
  border: string;
}

export interface CustomPalette {
  id: string;       // "custom_<timestamp>"
  name: string;
  dark: CustomPaletteColors;
  light: CustomPaletteColors;
}

interface ThemeState {
  mode: ThemeMode;
  palette: Palette;
  fontSize: FontSize;
}

interface ThemeContextValue {
  mode: ThemeMode;
  palette: Palette;
  fontSize: FontSize;
  themeKey: string;
  customPalettes: CustomPalette[];
  setMode: (m: ThemeMode) => void;
  setPalette: (p: Palette) => void;
  setFontSize: (s: FontSize) => void;
  saveCustomPalette: (p: CustomPalette) => void;
  deleteCustomPalette: (id: string) => void;
  reapplyTheme: () => void;
}

// ===================================================================
// Constants
// ===================================================================

export const FONT_SIZE_PX: Record<FontSize, number> = {
  xs: 12, sm: 13, md: 14, lg: 16, xl: 18,
};

const STORAGE_KEY = "eve-flipper-theme";
const CUSTOM_PALETTES_KEY = "eve-flipper-custom-palettes";

// ===================================================================
// Color utilities (exported for editor live-preview)
// ===================================================================

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function rgbTriplet(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `${r} ${g} ${b}`;
}

export function adjustBrightness(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `#${[r, g, b].map(c => clamp(c + amount).toString(16).padStart(2, "0")).join("")}`;
}

/** CSS var names overridden by custom palettes */
const CUSTOM_CSS_VARS = [
  "--eve-dark", "--eve-panel", "--eve-panel-hover", "--eve-input",
  "--eve-accent", "--eve-accent-hover", "--eve-accent-dim",
  "--eve-text", "--eve-dim",
  "--eve-success", "--eve-error", "--eve-warning",
  "--eve-border", "--eve-border-light",
  "--eve-glow", "--eve-selection",
  "--eve-scrollbar-track", "--eve-scrollbar-thumb", "--eve-scrollbar-thumb-hover",
];

/** Remove all custom palette inline CSS overrides from element */
export function clearCustomStyles(el: HTMLElement) {
  for (const v of CUSTOM_CSS_VARS) el.style.removeProperty(v);
}

/** Derive all CSS variables from 8 base colors and apply as inline styles */
export function deriveAndApply(el: HTMLElement, colors: CustomPaletteColors) {
  const vars: [string, string][] = [
    ["--eve-dark",         rgbTriplet(colors.bg)],
    ["--eve-panel",        rgbTriplet(colors.panel)],
    ["--eve-panel-hover",  rgbTriplet(adjustBrightness(colors.panel, 12))],
    ["--eve-input",        rgbTriplet(adjustBrightness(colors.panel, 6))],
    ["--eve-accent",       rgbTriplet(colors.accent)],
    ["--eve-accent-hover", rgbTriplet(adjustBrightness(colors.accent, 20))],
    ["--eve-accent-dim",   rgbTriplet(adjustBrightness(colors.accent, -30))],
    ["--eve-text",         rgbTriplet(colors.text)],
    ["--eve-dim",          rgbTriplet(colors.dim)],
    ["--eve-success",      rgbTriplet(colors.success)],
    ["--eve-error",        rgbTriplet(colors.error)],
    ["--eve-warning",      rgbTriplet(colors.accent)],
    ["--eve-border",       rgbTriplet(colors.border)],
    ["--eve-border-light", rgbTriplet(adjustBrightness(colors.border, 16))],
  ];
  const [ar, ag, ab] = hexToRgb(colors.accent);
  vars.push(
    ["--eve-glow",                  `rgba(${ar}, ${ag}, ${ab}, 0.15)`],
    ["--eve-selection",             `rgba(${ar}, ${ag}, ${ab}, 0.3)`],
    ["--eve-scrollbar-track",       colors.bg],
    ["--eve-scrollbar-thumb",       colors.border],
    ["--eve-scrollbar-thumb-hover", adjustBrightness(colors.border, 20)],
  );
  for (const [k, v] of vars) el.style.setProperty(k, v);
}

/** Read current theme colors from computed CSS variables */
export function readCurrentColors(): CustomPaletteColors {
  const cs = getComputedStyle(document.documentElement);
  const toHex = (name: string, fb: string): string => {
    const val = cs.getPropertyValue(name).trim();
    if (!val) return fb;
    const parts = val.split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.every(n => !isNaN(n))) {
      return `#${parts.map(n => clamp(n).toString(16).padStart(2, "0")).join("")}`;
    }
    return fb;
  };
  return {
    bg:      toHex("--eve-dark",    "#0d0d0d"),
    panel:   toHex("--eve-panel",   "#1a1a1a"),
    accent:  toHex("--eve-accent",  "#e69500"),
    text:    toHex("--eve-text",    "#c0c0c0"),
    dim:     toHex("--eve-dim",     "#8c8c8c"),
    success: toHex("--eve-success", "#00b450"),
    error:   toHex("--eve-error",   "#dc3c3c"),
    border:  toHex("--eve-border",  "#2a2a2a"),
  };
}

/** Validate imported palette JSON */
export function validateImportedPalette(data: unknown): CustomPalette | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.name !== "string") return null;
  const validColors = (c: unknown): c is CustomPaletteColors => {
    if (!c || typeof c !== "object") return false;
    const obj = c as Record<string, unknown>;
    return ["bg", "panel", "accent", "text", "dim", "success", "error", "border"]
      .every(k => typeof obj[k] === "string" && /^#[0-9a-fA-F]{6}$/.test(obj[k] as string));
  };
  if (!validColors(d.dark) || !validColors(d.light)) return null;
  return {
    id: `custom_${Date.now()}`,
    name: d.name,
    dark: d.dark,
    light: d.light,
  };
}

// ===================================================================
// Persistence
// ===================================================================

function getSystemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function loadState(): ThemeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.mode && parsed.palette) {
        return { mode: parsed.mode, palette: parsed.palette, fontSize: parsed.fontSize || "sm" };
      }
    }
  } catch { /* ignore */ }
  return { mode: "dark", palette: "classic", fontSize: "sm" };
}

function saveState(state: ThemeState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export function loadCustomPalettes(): CustomPalette[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PALETTES_KEY);
    if (raw) return JSON.parse(raw) as CustomPalette[];
  } catch { /* ignore */ }
  return [];
}

function saveCustomPalettesToStorage(palettes: CustomPalette[]) {
  try { localStorage.setItem(CUSTOM_PALETTES_KEY, JSON.stringify(palettes)); } catch { /* ignore */ }
}

// ===================================================================
// Apply theme to DOM
// ===================================================================

function applyTheme(state: ThemeState, customPalettes: CustomPalette[]) {
  const html = document.documentElement;
  const isDark = state.mode === "auto" ? getSystemDark() : state.mode === "dark";
  html.classList.toggle("dark", isDark);
  html.dataset.mode = isDark ? "dark" : "light";
  html.style.fontSize = `${FONT_SIZE_PX[state.fontSize] || 14}px`;

  // Always clear custom inline styles first
  clearCustomStyles(html);

  if (state.palette.startsWith("custom_")) {
    const cp = customPalettes.find(p => p.id === state.palette);
    if (cp) {
      html.dataset.palette = "custom";
      deriveAndApply(html, isDark ? cp.dark : cp.light);
      return;
    }
    // Custom palette was deleted — fall through to classic
  }
  html.dataset.palette = state.palette;
}

// Apply immediately on load to prevent flash
const _initCustom = loadCustomPalettes();
applyTheme(loadState(), _initCustom);

// ===================================================================
// React Context
// ===================================================================

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ThemeState>(loadState);
  const [customPalettes, setCustomPalettes] = useState<CustomPalette[]>(loadCustomPalettes);
  const [customVersion, setCustomVersion] = useState(0);

  // Refs for reapplyTheme (avoids stale closures)
  const stateRef = useRef(state);
  const customRef = useRef(customPalettes);
  stateRef.current = state;
  customRef.current = customPalettes;

  // Apply theme synchronously after DOM commit
  useLayoutEffect(() => {
    applyTheme(state, customPalettes);
    saveState(state);
  }, [state, customPalettes, customVersion]);

  // Listen for system theme changes when mode=auto
  useEffect(() => {
    if (state.mode !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme(state, customPalettes);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [state, customPalettes]);

  const setMode = useCallback((mode: ThemeMode) => {
    setState(prev => ({ ...prev, mode }));
  }, []);

  const setPalette = useCallback((palette: Palette) => {
    setState(prev => ({ ...prev, palette }));
  }, []);

  const setFontSize = useCallback((fontSize: FontSize) => {
    setState(prev => ({ ...prev, fontSize }));
  }, []);

  const saveCustomPalette = useCallback((p: CustomPalette) => {
    setCustomPalettes(prev => {
      const idx = prev.findIndex(x => x.id === p.id);
      const next = idx >= 0
        ? [...prev.slice(0, idx), p, ...prev.slice(idx + 1)]
        : [...prev, p];
      saveCustomPalettesToStorage(next);
      return next;
    });
    setCustomVersion(v => v + 1);
  }, []);

  const deleteCustomPalette = useCallback((id: string) => {
    setCustomPalettes(prev => {
      const next = prev.filter(x => x.id !== id);
      saveCustomPalettesToStorage(next);
      return next;
    });
    setState(prev => prev.palette === id ? { ...prev, palette: "classic" } : prev);
  }, []);

  /** Re-apply the current theme (useful after canceling editor preview) */
  const reapplyTheme = useCallback(() => {
    clearCustomStyles(document.documentElement);
    applyTheme(stateRef.current, customRef.current);
  }, []);

  const isDark = state.mode === "auto" ? getSystemDark() : state.mode === "dark";
  const themeKey = `${state.palette}-${isDark ? "dark" : "light"}-${customVersion}`;

  return createElement(
    ThemeContext.Provider,
    {
      value: {
        mode: state.mode, palette: state.palette, fontSize: state.fontSize,
        themeKey, customPalettes,
        setMode, setPalette, setFontSize,
        saveCustomPalette, deleteCustomPalette, reapplyTheme,
      },
    },
    children,
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

// ===================================================================
// Built-in palette metadata for UI
// ===================================================================

export interface PaletteMeta {
  id: Palette;
  nameKey: string;
  accent: string;
  bg: string;
}

export const PALETTES: PaletteMeta[] = [
  { id: "classic",   nameKey: "themeClassic",   accent: "#e69500", bg: "#0d0d0d" },
  { id: "caldari",   nameKey: "themeCaldari",   accent: "#4a9eff", bg: "#0a0e14" },
  { id: "amarr",     nameKey: "themeAmarr",     accent: "#ffd700", bg: "#12100a" },
  { id: "minmatar",  nameKey: "themeMinmatar",  accent: "#e05040", bg: "#120a0a" },
  { id: "gallente",  nameKey: "themeGallente",  accent: "#40c060", bg: "#0a120a" },
  { id: "serpentis", nameKey: "themeSerpentis", accent: "#a78bfa", bg: "#0e0a14" },
];

/** Color field metadata for the palette editor */
export const PALETTE_COLOR_FIELDS: { key: keyof CustomPaletteColors; nameKey: string }[] = [
  { key: "bg",      nameKey: "themeClrBg" },
  { key: "panel",   nameKey: "themeClrPanel" },
  { key: "accent",  nameKey: "themeClrAccent" },
  { key: "text",    nameKey: "themeClrText" },
  { key: "dim",     nameKey: "themeClrDim" },
  { key: "success", nameKey: "themeClrSuccess" },
  { key: "error",   nameKey: "themeClrError" },
  { key: "border",  nameKey: "themeClrBorder" },
];
