import { invoke } from "@tauri-apps/api/core";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { CheckIcon, CodeIcon, ImageIcon, PaletteIcon, RefreshIcon, TrashIcon } from "../../components/icons";
import { useNavigationStore } from "../../stores/navigationStore";
import { getCodeThemePalette, useThemeStore } from "../../stores/themeStore";
import { useWorkbenchStore } from "../../stores/workbenchStore";
import { CODE_THEME_PRESETS, THEME_PRESETS, type ConfigSource } from "../../types";
import { messageOf } from "../../utils";

export interface ConfigViewProps {
  configPath?: string;
  configBusy?: boolean;
  configDraft?: string;
  onConfigDraftChange?: (value: string) => void;
  onLoadConfigSource?: () => void;
  onSaveConfig?: () => void;
}

const ICON_BTN_CLASS =
  "grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-transparent text-muted transition-colors duration-140 enabled:hover:bg-surface-subtle enabled:hover:text-ink disabled:opacity-35";

export function ConfigView({
  configPath: controlledPath,
  configBusy: controlledBusy,
  configDraft: controlledDraft,
  onConfigDraftChange,
  onLoadConfigSource,
  onSaveConfig,
}: ConfigViewProps = {}) {
  const isControlled = controlledDraft !== undefined || onConfigDraftChange !== undefined;

  const workspaceInput = useWorkbenchStore((s) => s.workspaceInput);
  const loadDiscovery = useWorkbenchStore((s) => s.loadDiscovery);
  const setView = useNavigationStore((s) => s.setView);

  const [internalSource, setInternalSource] = useState<ConfigSource | null>(null);
  const [internalDraft, setInternalDraft] = useState("");
  const [internalBusy, setInternalBusy] = useState(false);
  const [internalError, setInternalError] = useState<string | null>(null);

  const loadInternalConfig = useCallback(async (): Promise<void> => {
    setInternalBusy(true);
    setInternalError(null);
    try {
      const source = await invoke<ConfigSource>("read_config_source", {
        request: {
          cwd: workspaceInput.trim() || null,
          configPath: null,
        },
      });
      setInternalSource(source);
      setInternalDraft(source.raw);
    } catch (error) {
      setInternalError(messageOf(error));
    } finally {
      setInternalBusy(false);
    }
  }, [workspaceInput]);

  useEffect(() => {
    if (isControlled) {
      return;
    }
    void loadInternalConfig();
  }, [isControlled, loadInternalConfig]);

  async function saveInternalConfig(): Promise<void> {
    setInternalBusy(true);
    setInternalError(null);
    try {
      const path = await invoke<string>("save_config", {
        request: {
          workspace: {
            cwd: workspaceInput.trim() || null,
            configPath: null,
          },
          raw: internalDraft,
        },
      });
      setInternalSource((current) =>
        current
          ? { ...current, path, exists: true, raw: internalDraft }
          : { path, exists: true, raw: internalDraft },
      );
      await loadDiscovery(workspaceInput);
      setView("config");
    } catch (error) {
      setInternalError(messageOf(error));
    } finally {
      setInternalBusy(false);
    }
  }

  const configPath = controlledPath ?? internalSource?.path;
  const configBusy = controlledBusy ?? internalBusy;
  const configDraft = controlledDraft ?? internalDraft;
  const handleDraftChange = onConfigDraftChange ?? setInternalDraft;
  const handleReload = onLoadConfigSource ?? (() => void loadInternalConfig());
  const handleSave = onSaveConfig ?? (() => void saveInternalConfig());
  const currentPreset = useThemeStore((s) => s.preset);
  const effectiveTheme = useThemeStore((s) => s.effectiveTheme);
  const setPreset = useThemeStore((s) => s.setPreset);
  const currentCodeTheme = useThemeStore((s) => s.codeTheme);
  const effectiveCodeTheme = useThemeStore((s) => s.effectiveCodeTheme);
  const setCodeTheme = useThemeStore((s) => s.setCodeTheme);
  const customBackground = useThemeStore((s) => s.customBackground);
  const customBackgroundOpacity = useThemeStore((s) => s.customBackgroundOpacity);
  const setCustomBackground = useThemeStore((s) => s.setCustomBackground);
  const setCustomBackgroundOpacity = useThemeStore((s) => s.setCustomBackgroundOpacity);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBackgroundUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        if (file.size <= 500 * 1024 || typeof document === "undefined") {
          setCustomBackground(result);
          return;
        }
        const img = new Image();
        img.onload = () => {
          try {
            const maxDimension = 1920;
            let width = img.width;
            let height = img.height;
            if (width > maxDimension || height > maxDimension) {
              if (width > height) {
                height = Math.round((height * maxDimension) / width);
                width = maxDimension;
              } else {
                width = Math.round((width * maxDimension) / height);
                height = maxDimension;
              }
            }
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(img, 0, 0, width, height);
              setCustomBackground(canvas.toDataURL("image/jpeg", 0.82));
            } else {
              setCustomBackground(result);
            }
          } catch {
            setCustomBackground(result);
          }
        };
        img.onerror = () => {
          setCustomBackground(result);
        };
        img.src = result;
      }
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const activePreset =
    THEME_PRESETS.find((p) => p.id === currentPreset) ?? THEME_PRESETS[0];
  const activeCodeTheme =
    CODE_THEME_PRESETS.find((p) => p.id === currentCodeTheme) ??
    CODE_THEME_PRESETS[0];
  const resolvedCodePreset =
    CODE_THEME_PRESETS.find((p) => p.id === effectiveCodeTheme) ??
    CODE_THEME_PRESETS[1];

  return (
    <motion.section
      key="config"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-10 py-7 max-[900px]:px-6 max-[900px]:py-5"
      aria-live="polite"
    >
      <div className="mx-auto flex h-full w-[min(920px,100%)] flex-col gap-3.5">
        <div className="flex items-center justify-between gap-4 border-b border-line pb-3.5">
          <span className="truncate font-code text-xs text-muted-strong">
            {configPath ?? ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              aria-label="Reload"
              className={ICON_BTN_CLASS}
              disabled={configBusy}
              onClick={handleReload}
              title="Reload"
              type="button"
            >
              <RefreshIcon size={15} />
            </button>
            <button
              aria-label="Save"
              className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-ink text-canvas transition-all duration-140 enabled:hover:opacity-85 disabled:bg-surface-subtle disabled:text-muted"
              disabled={configBusy || !configDraft.trim()}
              onClick={handleSave}
              title="Save"
              type="button"
            >
              <CheckIcon size={15} />
            </button>
          </div>
        </div>

        {internalError ? (
          <div className="rounded-xl border border-line bg-surface-subtle px-4 py-3 text-xs text-ink">
            {internalError}
          </div>
        ) : null}

        {/* Theme Presets Selection (ChatGPT Style) */}
        <section
          className="flex flex-col gap-3 rounded-xl border border-line bg-sidebar p-3.5"
          aria-label="主题预设"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <PaletteIcon size={16} />
              <span className="text-xs font-semibold tracking-[-0.01em] text-ink">
                主题外观
              </span>
              <span className="text-[11px] text-muted">
                模 ChatGPT 多风格配色预设，默认纯白
              </span>
            </div>
            <span className="font-code text-[11px] text-muted-strong">
              当前：{activePreset?.name ?? "默认白"}
              {activePreset?.subtitle ? ` (${activePreset.subtitle})` : ""}
              {currentPreset === "system" ? ` → ${effectiveTheme}` : ""}
            </span>
          </div>

          <div
            className="grid grid-cols-3 gap-2.5 max-[860px]:grid-cols-2 max-[560px]:grid-cols-1"
            role="radiogroup"
            aria-label="选择主题外观预设"
          >
            {THEME_PRESETS.map((preset) => {
              const isSelected = currentPreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setPreset(preset.id)}
                  className={`group relative flex flex-col gap-2 rounded-[11px] border p-2.5 text-left transition-all duration-140 ${
                    isSelected
                      ? "border-ink bg-surface shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)]"
                      : "border-line bg-surface/50 hover:border-line-strong hover:bg-surface"
                  }`}
                >
                  {/* Miniature UI Mockup */}
                  <div
                    className="relative flex h-14 w-full overflow-hidden rounded-[7px] border border-line"
                    style={{ backgroundColor: preset.preview.canvas }}
                  >
                    {/* Rail & Sidebar mockup */}
                    <div
                      className="flex w-1/3 flex-col gap-1 border-r border-line p-1.5"
                      style={{ backgroundColor: preset.preview.sidebar }}
                    >
                      <div
                        className="h-1.5 w-3/4 rounded-full opacity-45"
                        style={{ backgroundColor: preset.preview.ink }}
                      />
                      <div
                        className="h-1.5 w-1/2 rounded-full opacity-25"
                        style={{ backgroundColor: preset.preview.ink }}
                      />
                      <div
                        className="mt-auto h-1.5 w-2/3 rounded-full opacity-35"
                        style={{ backgroundColor: preset.preview.ink }}
                      />
                    </div>

                    {/* Canvas & message mockup */}
                    <div className="relative flex flex-1 flex-col justify-between p-1.5">
                      <div className="flex flex-col gap-1">
                        <div
                          className="h-1.5 w-2/5 rounded-full opacity-65"
                          style={{ backgroundColor: preset.preview.ink }}
                        />
                        <div
                          className="h-1.5 w-4/5 rounded-full opacity-35"
                          style={{ backgroundColor: preset.preview.ink }}
                        />
                      </div>
                      <div
                        className="h-2.5 w-full rounded border"
                        style={{
                          backgroundColor: preset.preview.surface,
                          borderColor: preset.preview.border,
                        }}
                      />
                    </div>

                    {/* Active check badge */}
                    {isSelected ? (
                      <div className="absolute top-1 right-1 grid h-4 w-4 place-items-center rounded-full bg-ink text-canvas shadow-xs">
                        <CheckIcon size={10} />
                      </div>
                    ) : null}
                  </div>

                  {/* Preset Label & Description */}
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold text-ink">
                        {preset.name}
                      </span>
                      <span className="rounded bg-surface-subtle px-1.5 py-0.5 font-code text-[10px] text-muted-strong">
                        {preset.subtitle}
                      </span>
                    </div>
                    <p className="line-clamp-1 text-[11px] leading-tight text-muted">
                      {preset.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* 自定义背景图配置 */}
          <div className="mt-1 flex flex-col gap-2.5 border-t border-line/60 pt-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <ImageIcon size={15} />
                <span className="text-xs font-semibold text-ink">自定义背景图</span>
                <span className="text-[11px] text-muted">支持上传本地图片作为沉浸背景</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  aria-label="上传背景图片文件"
                  className="hidden"
                  onChange={handleBackgroundUpload}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-hover"
                >
                  <ImageIcon size={13} />
                  <span>{customBackground ? "更换背景" : "上传图片"}</span>
                </button>
                {customBackground ? (
                  <button
                    type="button"
                    onClick={() => setCustomBackground(null)}
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-muted transition-colors hover:border-danger/30 hover:text-danger"
                    title="移除背景"
                  >
                    <TrashIcon size={12} />
                    <span>清除</span>
                  </button>
                ) : null}
              </div>
            </div>

            {customBackground ? (
              <div className="flex items-center gap-4 rounded-lg border border-line bg-surface/40 p-2">
                <div
                  data-testid="bg-preview-thumbnail"
                  className="h-10 w-16 shrink-0 overflow-hidden rounded border border-line bg-cover bg-center"
                  style={{ backgroundImage: `url(${customBackground})` }}
                />
                <div className="flex flex-1 items-center gap-3">
                  <label htmlFor="bg-opacity-slider" className="shrink-0 text-xs text-muted">
                    不透明度
                  </label>
                  <input
                    id="bg-opacity-slider"
                    type="range"
                    min="5"
                    max="60"
                    step="1"
                    value={Math.round(customBackgroundOpacity * 100)}
                    onChange={(e) => setCustomBackgroundOpacity(Number(e.target.value) / 100)}
                    className="h-1.5 flex-1 cursor-pointer accent-accent"
                  />
                  <span className="w-9 font-code text-right text-xs text-muted-strong">
                    {Math.round(customBackgroundOpacity * 100)}%
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* Code Syntax Color Style Selection */}
        <section
          className="flex flex-col gap-3 rounded-xl border border-line bg-sidebar p-3.5"
          aria-label="代码颜色风格"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CodeIcon size={16} />
              <span className="text-xs font-semibold tracking-[-0.01em] text-ink">
                代码颜色风格
              </span>
              <span className="text-[11px] text-muted">
                代码文件浏览器的语法高亮配色
              </span>
            </div>
            <span className="font-code text-[11px] text-muted-strong">
              当前：{activeCodeTheme?.name ?? "跟随主题"}
              {currentCodeTheme === "auto"
                ? ` → ${resolvedCodePreset?.name ?? "GitHub Light"}`
                : ""}
            </span>
          </div>

          <div
            className="grid grid-cols-3 gap-2.5 max-[860px]:grid-cols-2 max-[560px]:grid-cols-1"
            role="radiogroup"
            aria-label="选择代码颜色风格"
          >
            {CODE_THEME_PRESETS.map((codePreset) => {
              const isSelected = currentCodeTheme === codePreset.id;
              const previewPalette =
                codePreset.id === "auto"
                  ? getCodeThemePalette(effectiveCodeTheme)
                  : codePreset.palette;
              return (
                <button
                  key={codePreset.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setCodeTheme(codePreset.id)}
                  className={`group relative flex flex-col gap-2 rounded-[11px] border p-2.5 text-left transition-all duration-140 ${
                    isSelected
                      ? "border-ink bg-surface shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)]"
                      : "border-line bg-surface/50 hover:border-line-strong hover:bg-surface"
                  }`}
                >
                  {/* Miniature Code Snippet Preview */}
                  <div
                    className="relative flex h-14 w-full flex-col justify-center gap-0.5 overflow-hidden rounded-[7px] border border-line px-2.5 py-1.5 font-code text-[10px] leading-[1.35]"
                    style={{
                      backgroundColor: previewPalette.background,
                      color: previewPalette.foreground,
                    }}
                  >
                    <div className="truncate">
                      <span style={{ color: previewPalette.comment }}>{"// syntax"}</span>
                    </div>
                    <div className="truncate">
                      <span style={{ color: previewPalette.keyword }}>fn </span>
                      <span style={{ color: previewPalette.func }}>relay</span>
                      <span>(</span>
                      <span style={{ color: previewPalette.type }}>Str</span>
                      <span>) {"{"}</span>
                    </div>
                    <div className="truncate pl-2">
                      <span style={{ color: previewPalette.keyword }}>return </span>
                      <span style={{ color: previewPalette.string }}>"ok"</span>
                      <span>;</span>
                    </div>

                    {isSelected ? (
                      <div className="absolute top-1 right-1 grid h-4 w-4 place-items-center rounded-full bg-ink text-canvas shadow-xs">
                        <CheckIcon size={10} />
                      </div>
                    ) : null}
                  </div>

                  {/* Preset Label & Description */}
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold text-ink">
                        {codePreset.name}
                      </span>
                      <span className="rounded bg-surface-subtle px-1.5 py-0.5 font-code text-[10px] text-muted-strong">
                        {codePreset.subtitle}
                      </span>
                    </div>
                    <p className="line-clamp-1 text-[11px] leading-tight text-muted">
                      {codePreset.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <textarea
          aria-label="Config YAML"
          className="min-h-[420px] w-full flex-1 resize-none rounded-[14px] border border-line bg-sidebar p-[18px] font-code text-xs leading-[1.7] text-ink transition-colors duration-140 outline-none [tab-size:2] focus:border-line-strong"
          onChange={(event) => handleDraftChange(event.target.value)}
          spellCheck={false}
          value={configDraft}
        />
      </div>
    </motion.section>
  );
}
