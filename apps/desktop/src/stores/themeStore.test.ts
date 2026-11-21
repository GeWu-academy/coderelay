import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  CODE_THEME_IDS,
  CODE_THEME_PRESETS,
  DEFAULT_CODE_THEME_ID,
  DEFAULT_THEME_PRESET_ID,
  THEME_PRESETS,
  THEME_PRESET_IDS,
  isCodeThemeId,
  isThemePresetId,
} from "../types";
import {
  applyThemeToDocument,
  CODE_THEME_STORAGE_KEY,
  DEFAULT_BG_OPACITY,
  getCodeThemePalette,
  getInitialCodeTheme,
  getInitialCustomBackground,
  getInitialCustomBackgroundOpacity,
  getInitialThemePreset,
  getThemeColorSchemeMode,
  persistCodeTheme,
  persistCustomBackground,
  persistCustomBackgroundOpacity,
  persistThemePreset,
  resolveEffectiveCodeTheme,
  resolveEffectiveTheme,
  THEME_BG_OPACITY_STORAGE_KEY,
  THEME_BG_STORAGE_KEY,
  THEME_STORAGE_KEY,
  useThemeStore,
} from "./themeStore";

class MockStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe("Theme system SSOT & type guard", () => {
  it("maintains SSOT with THEME_PRESET_IDS and defaults to light (white)", () => {
    expect(THEME_PRESET_IDS).toEqual([
      "light",
      "dark",
      "midnight",
      "warm",
      "slate",
      "cyan",
      "sky",
      "pink",
      "red",
      "system",
    ]);
    expect(DEFAULT_THEME_PRESET_ID).toBe("light");
  });

  it("validates isThemePresetId type guard with valid non-empty and boundary values", () => {
    // Valid values
    for (const id of THEME_PRESET_IDS) {
      expect(isThemePresetId(id)).toBe(true);
    }

    // Boundary & invalid values
    expect(isThemePresetId("")).toBe(false);
    expect(isThemePresetId("LIGHT")).toBe(false);
    expect(isThemePresetId("dark ")).toBe(false);
    expect(isThemePresetId("cyberpunk")).toBe(false);
    expect(isThemePresetId(null)).toBe(false);
    expect(isThemePresetId(undefined)).toBe(false);
    expect(isThemePresetId(0)).toBe(false);
    expect(isThemePresetId(100)).toBe(false);
    expect(isThemePresetId({})).toBe(false);
    expect(isThemePresetId([])).toBe(false);
  });

  it("guarantees non-empty metadata and valid preview color tokens for all presets", () => {
    expect(THEME_PRESETS.length).toBe(THEME_PRESET_IDS.length);

    for (const preset of THEME_PRESETS) {
      expect(isThemePresetId(preset.id)).toBe(true);
      expect(preset.name.trim().length).toBeGreaterThan(0);
      expect(preset.subtitle.trim().length).toBeGreaterThan(0);
      expect(preset.description.trim().length).toBeGreaterThan(0);

      // Verify non-empty preview colors
      const { canvas, sidebar, surface, ink, accent, border } = preset.preview;
      expect(canvas.trim().length).toBeGreaterThan(0);
      expect(sidebar.trim().length).toBeGreaterThan(0);
      expect(surface.trim().length).toBeGreaterThan(0);
      expect(ink.trim().length).toBeGreaterThan(0);
      expect(accent.trim().length).toBeGreaterThan(0);
      expect(border.trim().length).toBeGreaterThan(0);

      // Mode validation
      if (preset.id === "system") {
        expect(preset.mode).toBe("system");
      } else if (
        preset.id === "light" ||
        preset.id === "warm" ||
        preset.id === "cyan" ||
        preset.id === "sky" ||
        preset.id === "pink" ||
        preset.id === "red"
      ) {
        expect(preset.mode).toBe("light");
      } else {
        expect(preset.mode).toBe("dark");
      }
    }
  });
});

describe("Theme resolution logic", () => {
  it("resolves fixed presets directly regardless of system scheme", () => {
    expect(resolveEffectiveTheme("light", "dark")).toBe("light");
    expect(resolveEffectiveTheme("dark", "light")).toBe("dark");
    expect(resolveEffectiveTheme("midnight", "light")).toBe("midnight");
    expect(resolveEffectiveTheme("warm", "dark")).toBe("warm");
    expect(resolveEffectiveTheme("slate", "light")).toBe("slate");
    expect(resolveEffectiveTheme("cyan", "dark")).toBe("cyan");
    expect(resolveEffectiveTheme("sky", "dark")).toBe("sky");
    expect(resolveEffectiveTheme("pink", "dark")).toBe("pink");
    expect(resolveEffectiveTheme("red", "dark")).toBe("red");
  });

  it("resolves system preset dynamically based on system color scheme", () => {
    expect(resolveEffectiveTheme("system", "light")).toBe("light");
    expect(resolveEffectiveTheme("system", "dark")).toBe("dark");
  });

  it("accurately categorizes colorScheme modes", () => {
    expect(getThemeColorSchemeMode("light")).toBe("light");
    expect(getThemeColorSchemeMode("warm")).toBe("light");
    expect(getThemeColorSchemeMode("dark")).toBe("dark");
    expect(getThemeColorSchemeMode("midnight")).toBe("dark");
    expect(getThemeColorSchemeMode("slate")).toBe("dark");
    expect(getThemeColorSchemeMode("cyan")).toBe("light");
    expect(getThemeColorSchemeMode("sky")).toBe("light");
    expect(getThemeColorSchemeMode("pink")).toBe("light");
    expect(getThemeColorSchemeMode("red")).toBe("light");
  });
});

describe("Theme DOM application & localStorage persistence", () => {
  let mockStorage: MockStorage;
  const mockAttrs = new Map<string, string>();
  const origWindow = globalThis.window;
  const origDocument = globalThis.document;

  beforeEach(() => {
    mockStorage = new MockStorage();
    mockAttrs.clear();

    const mockDoc = {
      documentElement: {
        setAttribute: (name: string, value: string) => mockAttrs.set(name, value),
        getAttribute: (name: string) => mockAttrs.get(name) ?? null,
        removeAttribute: (name: string) => mockAttrs.delete(name),
        style: { colorScheme: "" },
      },
    };

    const mockWin = {
      localStorage: mockStorage,
      matchMedia: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    };

    globalThis.window = mockWin as unknown as Window & typeof globalThis;
    globalThis.document = mockDoc as unknown as Document;
    globalThis.localStorage = mockStorage;
  });

  afterEach(() => {
    globalThis.window = origWindow;
    globalThis.document = origDocument;
    // @ts-expect-error cleanup mock
    delete globalThis.localStorage;
  });

  it("applies theme attributes directly to documentElement", () => {
    const resDark = applyThemeToDocument("dark", "light");
    expect(resDark.effectiveTheme).toBe("dark");
    expect(resDark.colorScheme).toBe("dark");
    expect(mockAttrs.get("data-theme")).toBe("dark");
    expect(mockAttrs.get("data-theme-preset")).toBe("dark");
    expect(mockAttrs.get("data-theme-mode")).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    const resWarm = applyThemeToDocument("warm", "dark");
    expect(resWarm.effectiveTheme).toBe("warm");
    expect(resWarm.colorScheme).toBe("light");
    expect(mockAttrs.get("data-theme")).toBe("warm");
    expect(mockAttrs.get("data-theme-preset")).toBe("warm");
    expect(mockAttrs.get("data-theme-mode")).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");

    const resSystem = applyThemeToDocument("system", "dark");
    expect(resSystem.effectiveTheme).toBe("dark");
    expect(resSystem.colorScheme).toBe("dark");
    expect(mockAttrs.get("data-theme")).toBe("dark");
    expect(mockAttrs.get("data-theme-preset")).toBe("system");
    expect(mockAttrs.get("data-theme-mode")).toBe("dark");
  });

  it("reads and persists theme preset in localStorage safely with fallback", () => {
    // When empty, returns default light theme
    expect(getInitialThemePreset()).toBe("light");

    // Persist and read back
    persistThemePreset("midnight");
    expect(mockStorage.getItem(THEME_STORAGE_KEY)).toBe("midnight");
    expect(getInitialThemePreset()).toBe("midnight");

    // Invalid or corrupted value falls back to default light theme
    mockStorage.setItem(THEME_STORAGE_KEY, "corrupted_theme_xyz");
    expect(getInitialThemePreset()).toBe("light");

    mockStorage.setItem(THEME_STORAGE_KEY, "");
    expect(getInitialThemePreset()).toBe("light");
  });

  it("updates store and document when setPreset is invoked", () => {
    useThemeStore.getState().setPreset("warm");
    expect(useThemeStore.getState().preset).toBe("warm");
    expect(useThemeStore.getState().effectiveTheme).toBe("warm");
    expect(useThemeStore.getState().colorScheme).toBe("light");
    expect(mockStorage.getItem(THEME_STORAGE_KEY)).toBe("warm");
    expect(mockAttrs.get("data-theme")).toBe("warm");

    useThemeStore.getState().setPreset("slate");
    expect(useThemeStore.getState().preset).toBe("slate");
    expect(useThemeStore.getState().effectiveTheme).toBe("slate");
    expect(useThemeStore.getState().colorScheme).toBe("dark");
    expect(mockStorage.getItem(THEME_STORAGE_KEY)).toBe("slate");
    expect(mockAttrs.get("data-theme")).toBe("slate");

    // Reset back to default light theme
    useThemeStore.getState().setPreset("light");
    expect(useThemeStore.getState().preset).toBe("light");
    expect(useThemeStore.getState().effectiveTheme).toBe("light");
    expect(useThemeStore.getState().colorScheme).toBe("light");
    expect(mockStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(mockAttrs.get("data-theme")).toBe("light");
  });

  it("handles custom background setting, opacity adjustment, and persistence", () => {
    const sampleImage =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    // Initially no background and default opacity
    expect(getInitialCustomBackground()).toBeNull();
    expect(getInitialCustomBackgroundOpacity()).toBe(DEFAULT_BG_OPACITY);

    // Persist and read back background
    persistCustomBackground(sampleImage);
    expect(mockStorage.getItem(THEME_BG_STORAGE_KEY)).toBe(sampleImage);
    expect(getInitialCustomBackground()).toBe(sampleImage);

    // Persist and read back opacity with valid and boundary values
    persistCustomBackgroundOpacity(0.35);
    expect(mockStorage.getItem(THEME_BG_OPACITY_STORAGE_KEY)).toBe("0.35");
    expect(getInitialCustomBackgroundOpacity()).toBe(0.35);

    // Boundary & invalid opacity falls back to default
    mockStorage.setItem(THEME_BG_OPACITY_STORAGE_KEY, "invalid_num");
    expect(getInitialCustomBackgroundOpacity()).toBe(DEFAULT_BG_OPACITY);

    mockStorage.setItem(THEME_BG_OPACITY_STORAGE_KEY, "0.01"); // Below 0.05
    expect(getInitialCustomBackgroundOpacity()).toBe(DEFAULT_BG_OPACITY);

    // Setting custom background via store updates document attribute and store state
    useThemeStore.getState().setCustomBackground(sampleImage);
    expect(useThemeStore.getState().customBackground).toBe(sampleImage);
    expect(mockAttrs.get("data-has-custom-bg")).toBe("true");

    useThemeStore.getState().setCustomBackgroundOpacity(0.42);
    expect(useThemeStore.getState().customBackgroundOpacity).toBe(0.42);

    // Clearing custom background removes document attribute
    useThemeStore.getState().setCustomBackground(null);
    expect(useThemeStore.getState().customBackground).toBeNull();
    expect(mockAttrs.has("data-has-custom-bg")).toBe(false);
  });
});

describe("Code theme SSOT, resolution & persistence", () => {
  const mockStorage = new MockStorage();
  let origWindow: Window & typeof globalThis;

  beforeEach(() => {
    origWindow = globalThis.window;
    mockStorage.clear();
    Object.defineProperty(globalThis, "window", {
      value: {
        localStorage: mockStorage,
        matchMedia: () => ({ matches: false }),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    globalThis.window = origWindow;
    mockStorage.clear();
  });

  it("maintains SSOT with CODE_THEME_IDS and validates isCodeThemeId", () => {
    expect(DEFAULT_CODE_THEME_ID).toBe("auto");
    expect(CODE_THEME_PRESETS.map((p) => p.id)).toEqual([...CODE_THEME_IDS]);

    for (const id of CODE_THEME_IDS) {
      expect(isCodeThemeId(id)).toBe(true);
    }
    expect(isCodeThemeId("monokai")).toBe(true);
    expect(isCodeThemeId("unknown-code-theme")).toBe(false);
    expect(isCodeThemeId(null)).toBe(false);
    expect(isCodeThemeId("")).toBe(false);

    for (const preset of CODE_THEME_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.palette.background.length).toBeGreaterThan(0);
      expect(preset.palette.keyword.length).toBeGreaterThan(0);
      expect(preset.palette.string.length).toBeGreaterThan(0);
    }
  });

  it("resolves auto code theme from colorScheme and keeps fixed themes unchanged", () => {
    expect(resolveEffectiveCodeTheme("auto", "light")).toBe("github-light");
    expect(resolveEffectiveCodeTheme("auto", "dark")).toBe("one-dark");
    expect(resolveEffectiveCodeTheme("dracula", "light")).toBe("dracula");
    expect(resolveEffectiveCodeTheme("solarized-light", "dark")).toBe("solarized-light");

    const draculaPalette = getCodeThemePalette("dracula");
    expect(draculaPalette.background).toBe("#282a36");
  });

  it("persists code theme in localStorage and updates effectiveCodeTheme with setCodeTheme / setPreset", () => {
    persistCodeTheme("tokyo-night");
    expect(mockStorage.getItem(CODE_THEME_STORAGE_KEY)).toBe("tokyo-night");
    expect(getInitialCodeTheme()).toBe("tokyo-night");

    mockStorage.setItem(CODE_THEME_STORAGE_KEY, "invalid-value");
    expect(getInitialCodeTheme()).toBe("auto");

    useThemeStore.getState().setPreset("light");
    useThemeStore.getState().setCodeTheme("auto");
    expect(useThemeStore.getState().effectiveCodeTheme).toBe("github-light");

    useThemeStore.getState().setPreset("dark");
    expect(useThemeStore.getState().effectiveCodeTheme).toBe("one-dark");

    useThemeStore.getState().setCodeTheme("monokai");
    expect(useThemeStore.getState().codeTheme).toBe("monokai");
    expect(useThemeStore.getState().effectiveCodeTheme).toBe("monokai");
    expect(mockStorage.getItem(CODE_THEME_STORAGE_KEY)).toBe("monokai");

    // Reset
    useThemeStore.getState().setPreset("light");
    useThemeStore.getState().setCodeTheme("auto");
  });
});
