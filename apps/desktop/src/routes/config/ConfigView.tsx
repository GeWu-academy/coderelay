import { invoke } from "@tauri-apps/api/core";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  CheckIcon,
  CodeIcon,
  FolderIcon,
  ImageIcon,
  PaletteIcon,
  RefreshIcon,
  TrashIcon,
} from "../../components/icons";
import { useNavigationStore } from "../../stores/navigationStore";
import {
  getCodeThemePalette,
  resolveEffectiveCodeTheme,
  useThemeStore,
} from "../../stores/themeStore";
import { useWorkbenchStore } from "../../stores/workbenchStore";
import {
  CODE_THEME_PRESETS,
  FOLDER_STYLE_PRESETS,
  THEME_PRESETS,
  type ConfigSource,
} from "../../types";
import { messageOf } from "../../utils";
import { tokenColor, tokenizeCodeLines } from "../../utils/codeHighlight";
import { SemanticFolderIcon } from "../files/folderStyles";

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

const PILL_BASE_CLASS =
  "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors duration-140";
const PILL_ACTIVE_CLASS =
  "border-ink bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]";
const PILL_IDLE_CLASS =
  "border-line bg-surface/40 text-muted-strong hover:border-line-strong hover:bg-surface hover:text-ink";

const CODE_PREVIEW_LINES = [
  "// 语法高亮示例",
  "const hi = (n: number) =>",
  '  greet("ok", n + 1);',
] as const;

const CODE_PREVIEW_TOKEN_LINES = tokenizeCodeLines(CODE_PREVIEW_LINES, "ts");

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
  const setPreset = useThemeStore((s) => s.setPreset);
  const currentCodeTheme = useThemeStore((s) => s.codeTheme);
  const colorScheme = useThemeStore((s) => s.colorScheme);
  const setCodeTheme = useThemeStore((s) => s.setCodeTheme);
  const currentFolderStyle = useThemeStore((s) => s.folderStyle);
  const setFolderStyle = useThemeStore((s) => s.setFolderStyle);
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

        {/* Appearance & Style Settings (Compact) */}
        <section
          className="flex flex-col divide-y divide-line/60 rounded-xl border border-line bg-sidebar px-3.5 py-1"
          aria-label="外观样式"
        >
          {/* 主题外观 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
            <div className="flex w-24 shrink-0 items-center gap-1.5 text-xs font-medium text-ink">
              <PaletteIcon size={14} />
              <span>主题外观</span>
            </div>
            <div
              className="flex flex-1 flex-wrap items-center gap-1.5"
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
                    className={`${PILL_BASE_CLASS} ${isSelected ? PILL_ACTIVE_CLASS : PILL_IDLE_CLASS}`}
                  >
                    <span className="inline-flex h-3.5 w-3.5 shrink-0 overflow-hidden rounded-full border border-line-strong">
                      <span
                        className="h-full w-1/2"
                        style={{ backgroundColor: preset.preview.sidebar }}
                      />
                      <span
                        className="h-full w-1/2"
                        style={{ backgroundColor: preset.preview.canvas }}
                      />
                    </span>
                    <span>{preset.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 代码颜色风格 */}
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2 py-2.5">
            <div className="flex w-24 shrink-0 items-center gap-1.5 pt-1 text-xs font-medium text-ink">
              <CodeIcon size={14} />
              <span>代码颜色风格</span>
            </div>
            <div
              className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3"
              role="radiogroup"
              aria-label="选择代码颜色风格"
            >
              {CODE_THEME_PRESETS.map((codePreset) => {
                const isSelected = currentCodeTheme === codePreset.id;
                const previewPalette =
                  codePreset.id === "auto"
                    ? getCodeThemePalette(resolveEffectiveCodeTheme("auto", colorScheme))
                    : codePreset.palette;
                return (
                  <button
                    key={codePreset.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    data-code-theme-option={codePreset.id}
                    onClick={() => setCodeTheme(codePreset.id)}
                    className={`group flex cursor-pointer flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-colors duration-140 ${
                      isSelected
                        ? "border-ink bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                        : "border-line bg-surface/40 hover:border-line-strong hover:bg-surface"
                    }`}
                  >
                    <div
                      aria-hidden="true"
                      className="overflow-hidden rounded-[6px] border border-black/10 px-2 py-1.5 font-code text-[10px] leading-[1.45]"
                      style={{
                        backgroundColor: previewPalette.background,
                        color: previewPalette.foreground,
                      }}
                    >
                      {CODE_PREVIEW_TOKEN_LINES.map((tokens, lineIdx) => (
                        <div key={lineIdx} className="flex items-baseline gap-1.5 whitespace-pre">
                          <span
                            className="w-2.5 shrink-0 select-none text-right text-[9px] opacity-70"
                            style={{ color: previewPalette.lineNumber }}
                          >
                            {lineIdx + 1}
                          </span>
                          <span className="truncate">
                            {tokens.map((token, tokenIdx) => (
                              <span
                                key={tokenIdx}
                                style={{ color: tokenColor(token.type, previewPalette) }}
                              >
                                {token.text}
                              </span>
                            ))}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-1 px-0.5">
                      <span
                        className={`truncate text-xs ${
                          isSelected ? "font-medium text-ink" : "text-muted-strong group-hover:text-ink"
                        }`}
                      >
                        {codePreset.name}
                      </span>
                      <span className="shrink-0 rounded bg-surface-subtle px-1 py-0.5 text-[10px] leading-none text-muted">
                        {codePreset.subtitle}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 文件夹样式 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
            <div className="flex w-24 shrink-0 items-center gap-1.5 text-xs font-medium text-ink">
              <FolderIcon size={14} />
              <span>文件夹样式</span>
            </div>
            <div
              className="flex flex-1 flex-wrap items-center gap-1.5"
              role="radiogroup"
              aria-label="选择文件夹样式预设"
            >
              {FOLDER_STYLE_PRESETS.map((folderPreset) => {
                const isSelected = currentFolderStyle === folderPreset.id;
                return (
                  <button
                    key={folderPreset.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setFolderStyle(folderPreset.id)}
                    className={`${PILL_BASE_CLASS} ${isSelected ? PILL_ACTIVE_CLASS : PILL_IDLE_CLASS}`}
                  >
                    <SemanticFolderIcon
                      name="apps"
                      isExpanded={false}
                      styleId={folderPreset.id}
                      size={13}
                    />
                    <span>{folderPreset.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 自定义背景图 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
            <div className="flex w-24 shrink-0 items-center gap-1.5 text-xs font-medium text-ink">
              <ImageIcon size={14} />
              <span>自定义背景图</span>
            </div>
            <div className="flex flex-1 flex-wrap items-center gap-2">
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
                <>
                  <div
                    data-testid="bg-preview-thumbnail"
                    className="h-6 w-10 shrink-0 overflow-hidden rounded border border-line bg-cover bg-center"
                    style={{ backgroundImage: `url(${customBackground})` }}
                  />
                  <div className="flex min-w-[160px] flex-1 items-center gap-2">
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
                    <span className="w-8 font-code text-right text-xs text-muted-strong">
                      {Math.round(customBackgroundOpacity * 100)}%
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCustomBackground(null)}
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-muted transition-colors hover:border-danger/30 hover:text-danger"
                    title="移除背景"
                  >
                    <TrashIcon size={12} />
                    <span>清除</span>
                  </button>
                </>
              ) : null}
            </div>
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
