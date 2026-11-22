import { create } from "zustand";
import {
  CODE_THEME_PRESETS,
  DEFAULT_CODE_THEME_ID,
  DEFAULT_FOLDER_STYLE_ID,
  DEFAULT_THEME_PRESET_ID,
  isCodeThemeId,
  isFolderStyleId,
  isThemePresetId,
  type CodeThemeId,
  type CodeThemePalette,
  type FolderStyleId,
  type ResolvedCodeThemeId,
  type ThemePresetId,
} from "../types";

export const THEME_STORAGE_KEY = "coderelay_theme_preset";
export const CODE_THEME_STORAGE_KEY = "coderelay_code_theme";
export const FOLDER_STYLE_STORAGE_KEY = "coderelay_folder_style";
export const THEME_BG_STORAGE_KEY = "coderelay_custom_background";
export const THEME_BG_OPACITY_STORAGE_KEY = "coderelay_custom_bg_opacity";
export const DEFAULT_BG_OPACITY = 0.25;

export type ResolvedTheme = Exclude<ThemePresetId, "system">;
export type ColorSchemeMode = "light" | "dark";

export interface ThemeState {
  preset: ThemePresetId;
  effectiveTheme: ResolvedTheme;
  colorScheme: ColorSchemeMode;
  codeTheme: CodeThemeId;
  effectiveCodeTheme: ResolvedCodeThemeId;
  folderStyle: FolderStyleId;
  customBackground: string | null;
  customBackgroundOpacity: number;
  setPreset: (preset: ThemePresetId) => void;
  setCodeTheme: (codeTheme: CodeThemeId) => void;
  setFolderStyle: (folderStyle: FolderStyleId) => void;
  setCustomBackground: (backgroundUrl: string | null) => void;
  setCustomBackgroundOpacity: (opacity: number) => void;
}

export function getSystemColorScheme(): ColorSchemeMode {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveEffectiveTheme(
  preset: ThemePresetId,
  systemMode: ColorSchemeMode = getSystemColorScheme(),
): ResolvedTheme {
  if (preset === "system") {
    return systemMode === "dark" ? "dark" : "light";
  }
  return preset;
}

export function getThemeColorSchemeMode(theme: ResolvedTheme): ColorSchemeMode {
  switch (theme) {
    case "dark":
    case "midnight":
    case "slate":
      return "dark";
    case "light":
    case "warm":
    case "cyan":
    case "sky":
    case "pink":
    case "red":
    default:
      return "light";
  }
}

export function applyThemeToDocument(
  preset: ThemePresetId,
  systemMode: ColorSchemeMode = getSystemColorScheme(),
  customBg: string | null = getInitialCustomBackground(),
): { effectiveTheme: ResolvedTheme; colorScheme: ColorSchemeMode } {
  const effectiveTheme = resolveEffectiveTheme(preset, systemMode);
  const colorScheme = getThemeColorSchemeMode(effectiveTheme);

  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("data-theme", effectiveTheme);
    document.documentElement.setAttribute("data-theme-preset", preset);
    document.documentElement.setAttribute("data-theme-mode", colorScheme);
    document.documentElement.style.colorScheme = colorScheme;
    if (customBg) {
      document.documentElement.setAttribute("data-has-custom-bg", "true");
    } else {
      document.documentElement.removeAttribute("data-has-custom-bg");
    }
  }

  return { effectiveTheme, colorScheme };
}

export function getInitialThemePreset(): ThemePresetId {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_THEME_PRESET_ID;
  }
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && isThemePresetId(stored)) {
      return stored;
    }
    return DEFAULT_THEME_PRESET_ID;
  } catch {
    return DEFAULT_THEME_PRESET_ID;
  }
}

export function persistThemePreset(preset: ThemePresetId): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preset);
  } catch {
    // ignore quota/security errors
  }
}

export function getInitialCustomBackground(): string | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    return window.localStorage.getItem(THEME_BG_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function getInitialCustomBackgroundOpacity(): number {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_BG_OPACITY;
  }
  try {
    const stored = window.localStorage.getItem(THEME_BG_OPACITY_STORAGE_KEY);
    if (stored !== null) {
      const val = Number.parseFloat(stored);
      if (!Number.isNaN(val) && val >= 0.05 && val <= 1) {
        return val;
      }
    }
    return DEFAULT_BG_OPACITY;
  } catch {
    return DEFAULT_BG_OPACITY;
  }
}

export function persistCustomBackground(bg: string | null): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    if (bg) {
      window.localStorage.setItem(THEME_BG_STORAGE_KEY, bg);
    } else {
      window.localStorage.removeItem(THEME_BG_STORAGE_KEY);
    }
  } catch {
    // ignore quota/security errors
  }
}

export function persistCustomBackgroundOpacity(opacity: number): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(THEME_BG_OPACITY_STORAGE_KEY, String(opacity));
  } catch {
    // ignore errors
  }
}

export function resolveEffectiveCodeTheme(
  codeTheme: CodeThemeId,
  colorScheme: ColorSchemeMode,
): ResolvedCodeThemeId {
  if (codeTheme === "auto") {
    return colorScheme === "dark" ? "one-dark" : "github-light";
  }
  return codeTheme;
}

const FALLBACK_CODE_PALETTE: CodeThemePalette = {
  background: "#ffffff",
  foreground: "#24292f",
  lineNumber: "#8c959f",
  lineHover: "rgba(0, 0, 0, 0.035)",
  keyword: "#cf222e",
  string: "#0a3069",
  comment: "#6e7781",
  number: "#0550ae",
  type: "#953800",
  func: "#8250df",
  operator: "#cf222e",
  property: "#0550ae",
};

export function getCodeThemePalette(
  resolvedCodeTheme: ResolvedCodeThemeId,
): CodeThemePalette {
  const found = CODE_THEME_PRESETS.find((item) => item.id === resolvedCodeTheme);
  return found?.palette ?? CODE_THEME_PRESETS[1]?.palette ?? FALLBACK_CODE_PALETTE;
}

export function getInitialCodeTheme(): CodeThemeId {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_CODE_THEME_ID;
  }
  try {
    const stored = window.localStorage.getItem(CODE_THEME_STORAGE_KEY);
    if (stored && isCodeThemeId(stored)) {
      return stored;
    }
    return DEFAULT_CODE_THEME_ID;
  } catch {
    return DEFAULT_CODE_THEME_ID;
  }
}

export function persistCodeTheme(codeTheme: CodeThemeId): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(CODE_THEME_STORAGE_KEY, codeTheme);
  } catch {
    // ignore quota/security errors
  }
}

export function getInitialFolderStyle(): FolderStyleId {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_FOLDER_STYLE_ID;
  }
  try {
    const stored = window.localStorage.getItem(FOLDER_STYLE_STORAGE_KEY);
    if (stored && isFolderStyleId(stored)) {
      return stored;
    }
    return DEFAULT_FOLDER_STYLE_ID;
  } catch {
    return DEFAULT_FOLDER_STYLE_ID;
  }
}

export function persistFolderStyle(folderStyle: FolderStyleId): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(FOLDER_STYLE_STORAGE_KEY, folderStyle);
  } catch {
    // ignore quota/security errors
  }
}

const initialPreset = getInitialThemePreset();
const initialBg = getInitialCustomBackground();
const initialBgOpacity = getInitialCustomBackgroundOpacity();
const initialResolved = applyThemeToDocument(initialPreset, undefined, initialBg);
const initialCodeTheme = getInitialCodeTheme();
const initialEffectiveCodeTheme = resolveEffectiveCodeTheme(
  initialCodeTheme,
  initialResolved.colorScheme,
);
const initialFolderStyle = getInitialFolderStyle();

export const useThemeStore = create<ThemeState>((set, get) => ({
  preset: initialPreset,
  effectiveTheme: initialResolved.effectiveTheme,
  colorScheme: initialResolved.colorScheme,
  codeTheme: initialCodeTheme,
  effectiveCodeTheme: initialEffectiveCodeTheme,
  folderStyle: initialFolderStyle,
  customBackground: initialBg,
  customBackgroundOpacity: initialBgOpacity,

  setPreset: (preset: ThemePresetId) => {
    persistThemePreset(preset);
    const { effectiveTheme, colorScheme } = applyThemeToDocument(
      preset,
      undefined,
      get().customBackground,
    );
    const effectiveCodeTheme = resolveEffectiveCodeTheme(
      get().codeTheme,
      colorScheme,
    );
    set({ preset, effectiveTheme, colorScheme, effectiveCodeTheme });
  },

  setCodeTheme: (codeTheme: CodeThemeId) => {
    persistCodeTheme(codeTheme);
    const effectiveCodeTheme = resolveEffectiveCodeTheme(
      codeTheme,
      get().colorScheme,
    );
    set({ codeTheme, effectiveCodeTheme });
  },

  setFolderStyle: (folderStyle: FolderStyleId) => {
    persistFolderStyle(folderStyle);
    set({ folderStyle });
  },

  setCustomBackground: (backgroundUrl: string | null) => {
    persistCustomBackground(backgroundUrl);
    if (typeof document !== "undefined" && document.documentElement) {
      if (backgroundUrl) {
        document.documentElement.setAttribute("data-has-custom-bg", "true");
      } else {
        document.documentElement.removeAttribute("data-has-custom-bg");
      }
    }
    set({ customBackground: backgroundUrl });
  },

  setCustomBackgroundOpacity: (opacity: number) => {
    persistCustomBackgroundOpacity(opacity);
    set({ customBackgroundOpacity: opacity });
  },
}));

// Set up system preference listener
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleMediaChange = (event: MediaQueryListEvent) => {
    const currentPreset = useThemeStore.getState().preset;
    if (currentPreset === "system") {
      const systemMode = event.matches ? "dark" : "light";
      const { effectiveTheme, colorScheme } = applyThemeToDocument(
        "system",
        systemMode,
      );
      const effectiveCodeTheme = resolveEffectiveCodeTheme(
        useThemeStore.getState().codeTheme,
        colorScheme,
      );
      useThemeStore.setState({ effectiveTheme, colorScheme, effectiveCodeTheme });
    }
  };

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", handleMediaChange);
  } else if (typeof mediaQuery.addListener === "function") {
    mediaQuery.addListener(handleMediaChange);
  }
}
