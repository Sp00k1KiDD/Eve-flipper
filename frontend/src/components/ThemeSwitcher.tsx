import { useEffect, useRef, useState } from "react";
import { useI18n, type TranslationKey } from "../lib/i18n";
import {
  useTheme, PALETTES, FONT_SIZE_PX, PALETTE_COLOR_FIELDS,
  readCurrentColors, deriveAndApply, validateImportedPalette,
  type ThemeMode, type FontSize, type CustomPalette, type CustomPaletteColors,
} from "../lib/useTheme";

// ===================================================================
// Constants
// ===================================================================

const MODES: { id: ThemeMode; icon: string; nameKey: string }[] = [
  { id: "dark",  icon: "\u{1F319}", nameKey: "themeDark" },
  { id: "light", icon: "\u{2600}\u{FE0F}", nameKey: "themeLight" },
  { id: "auto",  icon: "\u{1F4BB}", nameKey: "themeAuto" },
];

const FONT_SIZES: { id: FontSize; label: string }[] = [
  { id: "xs", label: "XS" },
  { id: "sm", label: "S" },
  { id: "md", label: "M" },
  { id: "lg", label: "L" },
  { id: "xl", label: "XL" },
];

// ===================================================================
// Main component
// ===================================================================

export function ThemeSwitcher() {
  const { t } = useI18n();
  const {
    mode, palette, fontSize, customPalettes,
    setMode, setPalette, setFontSize,
    saveCustomPalette, deleteCustomPalette, reapplyTheme,
  } = useTheme();

  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Editor state: null = normal view, object = editing a palette
  const [editing, setEditing] = useState<{ cp: CustomPalette; isNew: boolean } | null>(null);
  const [toast, setToast] = useState("");

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  });

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 2000);
    return () => clearTimeout(id);
  }, [toast]);

  function handleClose() {
    if (editing) {
      // Cancel preview and restore real theme
      reapplyTheme();
      setEditing(null);
    }
    setOpen(false);
  }

  // ---- Create new custom palette from current look ----
  function handleNewPalette() {
    const colors = readCurrentColors();
    const cp: CustomPalette = {
      id: `custom_${Date.now()}`,
      name: t("themeNewPalette"),
      dark: { ...colors },
      light: { ...colors },
    };
    setEditing({ cp, isNew: true });
    // Apply preview immediately
    deriveAndApply(document.documentElement, colors);
  }

  // ---- Edit existing custom palette ----
  function handleEditPalette(cp: CustomPalette) {
    setEditing({ cp: deepClone(cp), isNew: false });
  }

  // ---- Save from editor ----
  function handleSave(cp: CustomPalette) {
    saveCustomPalette(cp);
    setPalette(cp.id);
    setEditing(null);
  }

  // ---- Delete from editor ----
  function handleDelete(id: string) {
    deleteCustomPalette(id);
    setEditing(null);
  }

  // ---- Cancel editor ----
  function handleCancelEdit() {
    reapplyTheme();
    setEditing(null);
  }

  // ---- Import palette from clipboard ----
  async function handleImport() {
    try {
      const text = await navigator.clipboard.readText();
      const data = JSON.parse(text);
      const cp = validateImportedPalette(data);
      if (!cp) {
        setToast(t("themeImportError"));
        return;
      }
      saveCustomPalette(cp);
      setPalette(cp.id);
      setToast(t("themeImported"));
    } catch {
      setToast(t("themeImportError"));
    }
  }

  // ---- Export palette to clipboard ----
  async function handleExport(cp: CustomPalette) {
    const exportData = { name: cp.name, dark: cp.dark, light: cp.light };
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
      setToast(t("themeExported"));
    } catch {
      setToast(t("themeExportError"));
    }
  }

  // ---- Determine if current palette is a custom one (for showing edit btn) ----
  const activeCustom = customPalettes.find(p => p.id === palette);

  return (
    <div className="relative">
      {/* Toggle button */}
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        className="flex items-center justify-center h-[34px] w-[34px] rounded-sm
                   bg-eve-panel border border-eve-border hover:border-eve-accent/50
                   transition-colors cursor-pointer"
        title={t("themeTitle")}
        aria-label={t("themeTitle")}
      >
        <svg className="w-4 h-4 text-eve-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z" />
        </svg>
      </button>

      {/* Toast notification */}
      {toast && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-[60] px-3 py-1.5 rounded-sm
                        bg-eve-accent text-eve-dark text-[11px] font-medium whitespace-nowrap shadow-lg">
          {toast}
        </div>
      )}

      {open && !editing && (
        <div
          ref={panelRef}
          className="fixed right-2 left-2 top-14 sm:absolute sm:left-auto sm:top-[calc(100%+6px)] sm:right-0 z-50 sm:w-72
                     bg-eve-panel border border-eve-border rounded-sm shadow-xl shadow-black/30
                     max-h-[80vh] overflow-y-auto"
        >
          {/* Mode selector */}
          <div className="px-3 pt-3 pb-2">
            <div className="text-[10px] text-eve-dim uppercase tracking-wider font-medium mb-2">{t("themeMode")}</div>
            <div className="flex gap-1">
              {MODES.map(m => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={`flex-1 flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-sm text-[11px] font-medium transition-all border min-w-0
                    ${mode === m.id
                      ? "border-eve-accent/50 bg-eve-accent/10 text-eve-accent"
                      : "border-eve-border bg-eve-dark text-eve-dim hover:text-eve-text hover:border-eve-border-light"
                    }`}
                >
                  <span className="text-xs leading-none shrink-0">{m.icon}</span>
                  <span className="truncate">{t(m.nameKey as TranslationKey)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-eve-border mx-3" />

          {/* Palette selector */}
          <div className="px-3 pt-2 pb-2">
            <div className="text-[10px] text-eve-dim uppercase tracking-wider font-medium mb-2">{t("themePalette")}</div>
            <div className="grid grid-cols-3 gap-1.5">
              {/* Built-in palettes */}
              {PALETTES.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPalette(p.id)}
                  className={`flex flex-col items-center gap-1 px-2 py-2 rounded-sm text-[10px] font-medium transition-all border
                    ${palette === p.id
                      ? "border-eve-accent/60 bg-eve-accent/10 text-eve-accent"
                      : "border-eve-border bg-eve-dark text-eve-dim hover:text-eve-text hover:border-eve-border-light"
                    }`}
                >
                  <div className="flex gap-0.5">
                    <span className="w-4 h-4 rounded-full border border-white/10" style={{ backgroundColor: p.bg }} />
                    <span className="w-4 h-4 rounded-full border border-white/10" style={{ backgroundColor: p.accent }} />
                  </div>
                  <span className="leading-tight whitespace-nowrap">{t(p.nameKey as TranslationKey)}</span>
                </button>
              ))}

              {/* Custom palettes */}
              {customPalettes.map(cp => (
                <button
                  key={cp.id}
                  onClick={() => setPalette(cp.id)}
                  className={`relative flex flex-col items-center gap-1 px-2 py-2 rounded-sm text-[10px] font-medium transition-all border group
                    ${palette === cp.id
                      ? "border-eve-accent/60 bg-eve-accent/10 text-eve-accent"
                      : "border-eve-border bg-eve-dark text-eve-dim hover:text-eve-text hover:border-eve-border-light"
                    }`}
                >
                  <div className="flex gap-0.5">
                    <span className="w-4 h-4 rounded-full border border-white/10" style={{ backgroundColor: cp.dark.bg }} />
                    <span className="w-4 h-4 rounded-full border border-white/10" style={{ backgroundColor: cp.dark.accent }} />
                  </div>
                  <span className="leading-tight truncate max-w-full">{cp.name}</span>
                  {/* Edit icon on hover */}
                  <span
                    onClick={(e) => { e.stopPropagation(); handleEditPalette(cp); }}
                    className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center
                               rounded-sm bg-eve-panel/80 text-eve-dim hover:text-eve-accent
                               opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-[9px]"
                    title={t("themeEditPalette")}
                  >
                    &#9998;
                  </span>
                </button>
              ))}

              {/* "+" New palette button */}
              <button
                onClick={handleNewPalette}
                className="flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-sm text-[10px] font-medium
                           transition-all border border-dashed border-eve-border text-eve-dim
                           hover:text-eve-accent hover:border-eve-accent/40 bg-eve-dark"
                title={t("themeNewPalette")}
              >
                <span className="text-base leading-none">+</span>
                <span className="leading-tight whitespace-nowrap">{t("themeNew")}</span>
              </button>
            </div>

            {/* Edit / Export buttons for active custom palette */}
            {activeCustom && (
              <div className="flex gap-1.5 mt-2">
                <button
                  onClick={() => handleEditPalette(activeCustom)}
                  className="flex-1 text-[10px] py-1 rounded-sm border border-eve-border text-eve-dim
                             hover:text-eve-accent hover:border-eve-accent/40 transition-colors"
                >
                  {t("themeEditPalette")}
                </button>
                <button
                  onClick={() => handleExport(activeCustom)}
                  className="flex-1 text-[10px] py-1 rounded-sm border border-eve-border text-eve-dim
                             hover:text-eve-accent hover:border-eve-accent/40 transition-colors"
                >
                  {t("themeExport")}
                </button>
              </div>
            )}

            {/* Import button (always visible) */}
            <button
              onClick={handleImport}
              className="w-full text-[10px] py-1 mt-1.5 rounded-sm border border-dashed border-eve-border
                         text-eve-dim hover:text-eve-accent hover:border-eve-accent/40 transition-colors"
            >
              {t("themeImport")}
            </button>
          </div>

          <div className="border-t border-eve-border mx-3" />

          {/* Font size selector */}
          <div className="px-3 pt-2 pb-3">
            <div className="text-[10px] text-eve-dim uppercase tracking-wider font-medium mb-2">{t("themeFontSize")}</div>
            <div className="flex gap-1">
              {FONT_SIZES.map(fs => (
                <button
                  key={fs.id}
                  onClick={() => setFontSize(fs.id)}
                  className={`flex-1 flex flex-col items-center gap-0.5 px-1 py-1.5 rounded-sm transition-all border min-w-0
                    ${fontSize === fs.id
                      ? "border-eve-accent/50 bg-eve-accent/10 text-eve-accent"
                      : "border-eve-border bg-eve-dark text-eve-dim hover:text-eve-text hover:border-eve-border-light"
                    }`}
                >
                  <span style={{ fontSize: `${FONT_SIZE_PX[fs.id]}px` }} className="font-semibold leading-none">A</span>
                  <span className="text-[9px] leading-none">{fs.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================= */}
      {/* Palette Editor Panel                                           */}
      {/* ============================================================= */}
      {open && editing && (
        <PaletteEditor
          ref={panelRef}
          cp={editing.cp}
          isNew={editing.isNew}
          onSave={handleSave}
          onDelete={handleDelete}
          onCancel={handleCancelEdit}
          onExport={handleExport}
          onToast={setToast}
        />
      )}
    </div>
  );
}

// ===================================================================
// Palette Editor (inline panel)
// ===================================================================

import { forwardRef } from "react";

interface PaletteEditorProps {
  cp: CustomPalette;
  isNew: boolean;
  onSave: (cp: CustomPalette) => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
  onExport: (cp: CustomPalette) => void;
  onToast: (msg: string) => void;
}

const PaletteEditor = forwardRef<HTMLDivElement, PaletteEditorProps>(
  function PaletteEditor({ cp: initial, isNew, onSave, onDelete, onCancel, onExport, onToast }, ref) {
    const { t } = useI18n();
    const { mode } = useTheme();

    const [name, setName] = useState(initial.name);
    const [darkColors, setDarkColors] = useState<CustomPaletteColors>({ ...initial.dark });
    const [lightColors, setLightColors] = useState<CustomPaletteColors>({ ...initial.light });
    const [editMode, setEditMode] = useState<"dark" | "light">(
      mode === "light" ? "light" : "dark",
    );

    const colors = editMode === "dark" ? darkColors : lightColors;

    // Live preview: apply colors on every change
    function updateColor(key: keyof CustomPaletteColors, value: string) {
      const newColors = { ...colors, [key]: value };
      if (editMode === "dark") setDarkColors(newColors);
      else setLightColors(newColors);
      deriveAndApply(document.documentElement, newColors);
    }

    function handleSave() {
      onSave({ id: initial.id, name, dark: darkColors, light: lightColors });
    }

    async function handleImportInEditor() {
      try {
        const text = await navigator.clipboard.readText();
        const data = JSON.parse(text);
        const imported = validateImportedPalette(data);
        if (!imported) {
          onToast(t("themeImportError"));
          return;
        }
        setName(imported.name);
        setDarkColors({ ...imported.dark });
        setLightColors({ ...imported.light });
        const applyColors = editMode === "dark" ? imported.dark : imported.light;
        deriveAndApply(document.documentElement, applyColors);
        onToast(t("themeImported"));
      } catch {
        onToast(t("themeImportError"));
      }
    }

    return (
      <div
        ref={ref}
        className="fixed right-2 left-2 top-14 sm:absolute sm:left-auto sm:top-[calc(100%+6px)] sm:right-0 z-50 sm:w-80
                   bg-eve-panel border border-eve-border rounded-sm shadow-xl shadow-black/30
                   max-h-[80vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <button
            onClick={onCancel}
            className="text-eve-dim hover:text-eve-accent transition-colors text-sm"
            title={t("themeBack")}
          >
            &larr;
          </button>
          <span className="text-[10px] text-eve-dim uppercase tracking-wider font-medium">
            {isNew ? t("themeNewPalette") : t("themeEditPalette")}
          </span>
        </div>

        {/* Name */}
        <div className="px-3 pb-2">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={24}
            className="w-full bg-eve-input border border-eve-border rounded-sm px-2 py-1
                       text-[11px] text-eve-text placeholder:text-eve-dim/50
                       focus:outline-none focus:border-eve-accent/50"
            placeholder={t("themePaletteName")}
          />
        </div>

        {/* Dark / Light mode toggle for editing */}
        <div className="px-3 pb-2">
          <div className="flex gap-1">
            {(["dark", "light"] as const).map(m => (
              <button
                key={m}
                onClick={() => {
                  setEditMode(m);
                  const c = m === "dark" ? darkColors : lightColors;
                  deriveAndApply(document.documentElement, c);
                }}
                className={`flex-1 text-[10px] py-1 rounded-sm border font-medium transition-all
                  ${editMode === m
                    ? "border-eve-accent/50 bg-eve-accent/10 text-eve-accent"
                    : "border-eve-border bg-eve-dark text-eve-dim hover:text-eve-text"
                  }`}
              >
                {m === "dark" ? t("themeDark") : t("themeLight")}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-eve-border mx-3" />

        {/* Color pickers — 2-column grid */}
        <div className="px-3 pt-2 pb-2">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {PALETTE_COLOR_FIELDS.map(f => (
              <label key={f.key} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="color"
                  value={colors[f.key]}
                  onChange={e => updateColor(f.key, e.target.value)}
                  className="w-6 h-6 rounded-sm border border-eve-border cursor-pointer
                             [&::-webkit-color-swatch-wrapper]:p-0.5
                             [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-none"
                />
                <span className="text-[10px] text-eve-dim group-hover:text-eve-text transition-colors leading-tight">
                  {t(f.nameKey as TranslationKey)}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="border-t border-eve-border mx-3" />

        {/* Import / Export */}
        <div className="px-3 pt-2 pb-2 flex gap-1.5">
          <button
            onClick={handleImportInEditor}
            className="flex-1 text-[10px] py-1 rounded-sm border border-eve-border text-eve-dim
                       hover:text-eve-accent hover:border-eve-accent/40 transition-colors"
          >
            {t("themeImport")}
          </button>
          <button
            onClick={() => onExport({ id: initial.id, name, dark: darkColors, light: lightColors })}
            className="flex-1 text-[10px] py-1 rounded-sm border border-eve-border text-eve-dim
                       hover:text-eve-accent hover:border-eve-accent/40 transition-colors"
          >
            {t("themeExport")}
          </button>
        </div>

        <div className="border-t border-eve-border mx-3" />

        {/* Action buttons */}
        <div className="px-3 pt-2 pb-3 flex gap-1.5">
          <button
            onClick={handleSave}
            className="flex-1 text-[10px] py-1.5 rounded-sm font-medium
                       bg-eve-accent/20 border border-eve-accent/40 text-eve-accent
                       hover:bg-eve-accent/30 transition-colors"
          >
            {t("themeSavePalette")}
          </button>
          {!isNew && (
            <button
              onClick={() => onDelete(initial.id)}
              className="px-3 text-[10px] py-1.5 rounded-sm font-medium
                         bg-eve-error/10 border border-eve-error/30 text-eve-error
                         hover:bg-eve-error/20 transition-colors"
              title={t("themeDeletePalette")}
            >
              &#128465;
            </button>
          )}
          <button
            onClick={onCancel}
            className="flex-1 text-[10px] py-1.5 rounded-sm font-medium
                       border border-eve-border text-eve-dim
                       hover:text-eve-text hover:border-eve-border-light transition-colors"
          >
            {t("themeCancel")}
          </button>
        </div>
      </div>
    );
  },
);

// ===================================================================
// Helpers
// ===================================================================

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
