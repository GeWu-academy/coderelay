import { invoke } from "@tauri-apps/api/core";
import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { CheckIcon, CloseIcon, KeyIcon } from "../../components/icons";
import type { JevSettings } from "../../types";
import { messageOf } from "../../utils";

export interface ApiKeyViewProps {
  jevBusy?: boolean;
  jevSettings?: JevSettings | null;
  jevApiKeyInput?: string;
  notice?: string | null;
  onJevApiKeyInputChange?: (value: string) => void;
  onSaveJevApiKey?: () => void;
  onClearJevApiKey?: () => void;
}

const ICON_BTN_CLASS =
  "grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-transparent text-muted transition-colors duration-140 enabled:hover:bg-surface-subtle enabled:hover:text-ink disabled:opacity-35";

export function ApiKeyView({
  jevBusy: controlledBusy,
  jevSettings: controlledSettings,
  jevApiKeyInput: controlledInput,
  notice: controlledNotice,
  onJevApiKeyInputChange,
  onSaveJevApiKey,
  onClearJevApiKey,
}: ApiKeyViewProps = {}) {
  const isControlled = controlledSettings !== undefined || onJevApiKeyInputChange !== undefined;

  const [internalBusy, setInternalBusy] = useState(false);
  const [internalSettings, setInternalSettings] = useState<JevSettings | null>(null);
  const [internalInput, setInternalInput] = useState("");
  const [internalNotice, setInternalNotice] = useState<string | null>(null);
  const [internalError, setInternalError] = useState<string | null>(null);

  useEffect(() => {
    if (isControlled) {
      return;
    }
    let cancelled = false;
    void invoke<JevSettings>("get_jev_settings")
      .then((settings) => {
        if (!cancelled) {
          setInternalSettings(settings);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setInternalError(messageOf(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isControlled]);

  async function handleInternalSave(): Promise<void> {
    const apiKey = internalInput.trim();
    if (!apiKey) {
      return;
    }
    setInternalBusy(true);
    setInternalNotice(null);
    setInternalError(null);
    try {
      const settings = await invoke<JevSettings>("save_jev_api_key", { apiKey });
      setInternalSettings(settings);
      setInternalInput("");
      setInternalNotice("API Key 已保存到本地 SQLite。");
    } catch (error) {
      setInternalError(messageOf(error));
    } finally {
      setInternalBusy(false);
    }
  }

  async function handleInternalClear(): Promise<void> {
    setInternalBusy(true);
    setInternalNotice(null);
    setInternalError(null);
    try {
      const settings = await invoke<JevSettings>("clear_jev_api_key");
      setInternalSettings(settings);
      setInternalInput("");
      setInternalNotice("已从本地 SQLite 清除 API Key。");
    } catch (error) {
      setInternalError(messageOf(error));
    } finally {
      setInternalBusy(false);
    }
  }

  const jevBusy = controlledBusy ?? internalBusy;
  const jevSettings = controlledSettings !== undefined ? controlledSettings : internalSettings;
  const jevApiKeyInput = controlledInput ?? internalInput;
  const notice =
    controlledNotice !== undefined ? controlledNotice : (internalError ?? internalNotice);
  const handleInputChange = onJevApiKeyInputChange ?? setInternalInput;
  const handleSave = onSaveJevApiKey ?? (() => void handleInternalSave());
  const handleClear = onClearJevApiKey ?? (() => void handleInternalClear());
  const isConfigured = Boolean(jevSettings?.stored || jevSettings?.environmentConfigured);
  const statusLabel = jevSettings?.stored
    ? "已存储在本地安全数据库 (SQLite)"
    : jevSettings?.environmentConfigured
      ? "已从环境变量 (TYPESAFE_API_KEY) 配置"
      : "未配置";

  return (
    <motion.section
      key="apikeys"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto px-10 py-7 max-[900px]:px-6 max-[900px]:py-5"
      aria-live="polite"
    >
      <div className="mx-auto flex h-full w-[min(920px,100%)] flex-col gap-6">
        <div className="flex flex-col gap-1 border-b border-line pb-4">
          <h1 className="text-base font-semibold text-ink">API 密钥管理</h1>
          <p className="text-xs text-muted-strong">
            管理智能路由决策与外部服务所需的 API 密钥，敏感凭据仅保存在本地安全数据库。
          </p>
        </div>

        {notice ? (
          <div className="rounded-xl border border-line bg-surface-subtle px-4 py-3 text-xs text-ink transition-all">
            {notice}
          </div>
        ) : null}

        <div className="flex flex-col gap-4 rounded-xl border border-line bg-sidebar p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-subtle text-ink">
                <KeyIcon size={16} />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-ink">TypeSafe JEV 决策路由</span>
                <span className="text-xs text-muted">用于智能模型路由分析与复杂代码生成决策</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 rounded-full border border-line bg-surface-subtle px-2.5 py-1 text-xs text-muted-strong">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-300 data-[tone=ready]:bg-success"
                data-tone={isConfigured ? "ready" : "idle"}
              />
              <span>{statusLabel}</span>
            </div>
          </div>

          <div
            className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-1.5 text-muted-strong focus-within:border-line-strong"
            aria-label="TypeSafe API Key Input"
          >
            <input
              autoComplete="off"
              className="min-w-0 flex-1 border-0 bg-transparent font-code text-xs text-ink placeholder:text-zinc-400 focus:outline-none"
              disabled={jevBusy}
              id="jev-api-key"
              onChange={(event) => handleInputChange(event.target.value)}
              placeholder={jevSettings?.stored ? "••••••••••••••••••••" : "填入 TYPESAFE_API_KEY"}
              spellCheck={false}
              type="password"
              value={jevApiKeyInput}
            />

            <button
              aria-label="Save API Key"
              className={ICON_BTN_CLASS}
              disabled={jevBusy || !jevApiKeyInput.trim()}
              onClick={handleSave}
              title="保存 API Key"
              type="button"
            >
              <CheckIcon size={15} />
            </button>

            {jevSettings?.stored ? (
              <button
                aria-label="Clear API Key"
                className={ICON_BTN_CLASS}
                disabled={jevBusy}
                onClick={handleClear}
                title="清除已存 API Key"
                type="button"
              >
                <CloseIcon size={14} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
