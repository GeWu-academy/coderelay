import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import {
  computeOverview,
  formatDisplayDate,
  type DailyTrendPoint,
  type FullStatsOverview,
  type HeatmapDay,
} from "../stats";
import type { AgentEntry, ModelOption, SessionDetail, SessionRecord, SessionTurn } from "../types";
import { formatTimestamp, workspaceName } from "../utils";
import { HistoryIcon, RefreshIcon, RouteIcon, StatsIcon, TerminalIcon } from "./icons";

export interface StatsViewProps {
  workspaceInput: string;
  sessions: SessionRecord[];
  agents: AgentEntry[];
  catalogOptions: ModelOption[];
  turnsMap?: Record<string, SessionTurn[]>;
  loadSessionTurns?: (sessionId: string) => Promise<SessionTurn[]>;
  onRefreshSessions?: () => void;
  onOpenSession?: (sessionId: string) => void;
}

type ChartMetric = "cli" | "model" | "total";

export function StatsView({
  workspaceInput,
  sessions,
  agents,
  catalogOptions,
  turnsMap: externalTurnsMap,
  loadSessionTurns,
  onRefreshSessions,
  onOpenSession,
}: StatsViewProps) {
  const [internalTurnsMap, setInternalTurnsMap] = useState<Record<string, SessionTurn[]>>({});
  const [loadingTurns, setLoadingTurns] = useState(false);
  const [activeTab, setActiveTab] = useState<ChartMetric>("cli");
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const [hoveredHeatmapDay, setHoveredHeatmapDay] = useState<HeatmapDay | null>(null);

  const turnsMap = externalTurnsMap ?? internalTurnsMap;

  // Asynchronously load turns for sessions if loadSessionTurns is provided and no external turnsMap given
  useEffect(() => {
    const loader = loadSessionTurns;
    if (externalTurnsMap || !loader || sessions.length === 0) {
      return;
    }
    let isMounted = true;
    async function fetchTurns(activeLoader: (sessionId: string) => Promise<SessionTurn[]>) {
      setLoadingTurns(true);
      try {
        const results = await Promise.all(
          sessions.slice(0, 100).map(async (s) => {
            try {
              const turns = await activeLoader(s.id);
              return [s.id, turns] as const;
            } catch {
              return [s.id, []] as const;
            }
          }),
        );
        if (isMounted) {
          setInternalTurnsMap(Object.fromEntries(results));
        }
      } finally {
        if (isMounted) {
          setLoadingTurns(false);
        }
      }
    }
    void fetchTurns(loader);
    return () => {
      isMounted = false;
    };
  }, [sessions, loadSessionTurns, externalTurnsMap]);

  const overview: FullStatsOverview = useMemo(() => {
    return computeOverview(sessions, turnsMap, agents, catalogOptions);
  }, [sessions, turnsMap, agents, catalogOptions]);

  const { summary, cliStats, modelStats, trendPoints, heatmap } = overview;

  return (
    <motion.section
      key="stats"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      className="min-h-0 flex-1 overflow-auto px-10 py-7 max-[900px]:px-6 max-[900px]:py-5"
      aria-live="polite"
    >
      <div className="mx-auto flex w-[min(980px,100%)] flex-col gap-6">
        {/* Header Bar */}
        <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-code text-xs text-muted-strong">
                {workspaceName(workspaceInput)}
              </span>
              <span className="rounded-full bg-surface-subtle px-2 py-0.5 font-code text-[10px] text-muted">
                {sessions.length} 个会话
              </span>
            </div>
            <h2 className="m-0 text-lg font-semibold tracking-[-0.015em] text-ink">
              效能统计与数据看板
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {onRefreshSessions ? (
              <button
                aria-label="Refresh Stats"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-transparent text-muted transition-colors duration-140 enabled:hover:bg-surface-subtle enabled:hover:text-ink disabled:opacity-35"
                onClick={onRefreshSessions}
                title="刷新统计数据"
                type="button"
              >
                <RefreshIcon size={16} />
              </button>
            ) : null}
          </div>
        </div>

        {/* Top KPI Cards */}
        <div className="grid grid-cols-4 gap-3.5 max-[800px]:grid-cols-2 max-[500px]:grid-cols-1">
          <div className="rounded-xl border border-line bg-surface p-4 transition-all hover:border-line-strong">
            <div className="flex items-center justify-between text-muted">
              <span className="text-[12px] font-medium">累计对话与交互</span>
              <HistoryIcon />
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="font-code text-2xl font-bold tracking-tight text-ink">
                {summary.totalSessions}
              </span>
              <span className="text-xs text-muted">个会话</span>
              <span className="font-code text-sm font-semibold text-muted-strong">
                / {summary.totalTurns} 轮
              </span>
            </div>
            <div className="mt-1 text-[11px] text-muted">包含多轮交互与单步执行</div>
          </div>

          <div className="rounded-xl border border-line bg-surface p-4 transition-all hover:border-line-strong">
            <div className="flex items-center justify-between text-muted">
              <span className="text-[12px] font-medium">主力 CLI Agent</span>
              <TerminalIcon size={16} />
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="font-code text-2xl font-bold tracking-tight text-ink uppercase">
                {summary.mostUsedCli?.cliId ?? "无"}
              </span>
              {summary.mostUsedCli ? (
                <span className="rounded bg-surface-subtle px-1.5 py-0.5 font-code text-[11px] text-muted-strong">
                  {Math.round(summary.mostUsedCli.turnShare * 100)}% 占比
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-[11px] text-muted">
              {summary.mostUsedCli
                ? `${summary.mostUsedCli.turnCount} 轮对话 (${summary.mostUsedCli.sessionCount} 会话)`
                : "暂无数据"}
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface p-4 transition-all hover:border-line-strong">
            <div className="flex items-center justify-between text-muted">
              <span className="text-[12px] font-medium">高频选择模型</span>
              <RouteIcon size={16} />
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="truncate font-code text-lg font-bold tracking-tight text-ink">
                {summary.mostUsedModel?.label ?? "自适应推荐"}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-muted">
              {summary.mostUsedModel
                ? `共调用 ${summary.mostUsedModel.count} 次 (${Math.round(summary.mostUsedModel.share * 100)}%)`
                : "尚未选择模型"}
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface p-4 transition-all hover:border-line-strong">
            <div className="flex items-center justify-between text-muted">
              <span className="text-[12px] font-medium">连续活跃天数</span>
              <StatsIcon size={16} />
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="font-code text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                {summary.currentStreak}
              </span>
              <span className="text-xs text-muted">天连续</span>
              <span className="text-xs text-muted">/ 累计 {summary.totalActiveDays} 天</span>
            </div>
            <div className="mt-1 text-[11px] text-muted">
              最长记录 {summary.longestStreak} 天
            </div>
          </div>
        </div>

        {/* Section 1: CLI Usage & Conversations (Requirement 1) */}
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-center justify-between pb-4">
            <div>
              <h3 className="m-0 text-[15px] font-semibold tracking-[-0.015em] text-ink">
                CLI 使用频率与对话排行
              </h3>
              <p className="mt-1 mb-0 text-[12px] text-muted">
                统计各命令行 Agent 承接的会话量、交互轮次与活跃占比
              </p>
            </div>
            <span className="rounded-full bg-surface-subtle px-2.5 py-1 font-code text-[11px] text-muted-strong">
              已接入 {cliStats.length} 个 CLI
            </span>
          </div>

          {cliStats.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted">暂无 CLI 调用记录</div>
          ) : (
            <div className="flex flex-col gap-3">
              {cliStats.map((item, index) => {
                const isTop = index === 0 && item.turnCount > 0;
                return (
                  <div
                    key={item.cliId}
                    className="flex flex-col gap-2 rounded-xl border border-line bg-surface-subtle/50 p-3.5 transition-all hover:border-line-strong hover:bg-surface-subtle"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`grid h-6 w-6 place-items-center rounded-md font-code text-xs font-bold ${
                            isTop
                              ? "bg-ink text-white"
                              : "bg-surface text-muted-strong border border-line"
                          }`}
                        >
                          #{index + 1}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-ink">{item.label}</span>
                          <span className="rounded bg-surface px-1.5 py-0.5 font-code text-[10px] text-muted uppercase border border-line">
                            {item.cliId}
                          </span>
                          {isTop ? (
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                              最高频使用
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs font-medium">
                        <span className="text-ink">
                          <strong className="font-code text-[13px]">{item.sessionCount}</strong>{" "}
                          <span className="text-muted">次会话</span>
                        </span>
                        <span className="text-ink">
                          <strong className="font-code text-[13px]">{item.turnCount}</strong>{" "}
                          <span className="text-muted">轮对话</span>
                        </span>
                        <span className="font-code text-[13px] text-muted-strong">
                          {Math.round(item.turnShare * 100)}%
                        </span>
                      </div>
                    </div>

                    {/* Usage Share Progress Bar */}
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface">
                      <div
                        className="h-full rounded-full bg-ink transition-all duration-300"
                        style={{ width: `${Math.max(item.turnShare * 100, 2)}%` }}
                      />
                    </div>

                    {/* Associated Models & Last Active */}
                    <div className="flex items-center justify-between text-[11px] text-muted">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>调用的模型:</span>
                        {item.models.length > 0 ? (
                          item.models.map((m) => (
                            <span
                              key={m.modelId}
                              className="rounded bg-surface px-1.5 py-0.5 font-code text-[10px] text-ink-soft border border-line"
                            >
                              {m.modelId} ({m.count})
                            </span>
                          ))
                        ) : (
                          <span className="text-muted">默认配置</span>
                        )}
                      </div>
                      {item.lastActiveAt ? (
                        <span>最近更新: {formatTimestamp(item.lastActiveAt)}</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Section 2: Model & Trend Line Chart (Requirement 2) */}
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-center justify-between pb-3 flex-wrap gap-3">
            <div>
              <h3 className="m-0 text-[15px] font-semibold tracking-[-0.015em] text-ink">
                智能模型选择与活跃趋势
              </h3>
              <p className="mt-1 mb-0 text-[12px] text-muted">
                自动推荐模型与各 CLI 调用趋势折线图 (近 14 日)
              </p>
            </div>

            {/* Metric Mode Switcher */}
            <div className="flex items-center gap-1 rounded-lg border border-line bg-surface-subtle p-1">
              <button
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                  activeTab === "cli"
                    ? "bg-surface text-ink shadow-xs"
                    : "text-muted hover:text-ink"
                }`}
                onClick={() => setActiveTab("cli")}
                type="button"
              >
                按 CLI 统计
              </button>
              <button
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                  activeTab === "model"
                    ? "bg-surface text-ink shadow-xs"
                    : "text-muted hover:text-ink"
                }`}
                onClick={() => setActiveTab("model")}
                type="button"
              >
                按模型统计
              </button>
              <button
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                  activeTab === "total"
                    ? "bg-surface text-ink shadow-xs"
                    : "text-muted hover:text-ink"
                }`}
                onClick={() => setActiveTab("total")}
                type="button"
              >
                总交互量
              </button>
            </div>
          </div>

          {/* Minimalist Line Chart Component */}
          <MinimalistLineChart
            data={trendPoints}
            activeTab={activeTab}
            cliStats={cliStats}
            modelStats={modelStats}
            hoveredIndex={hoveredPointIndex}
            onHoverIndex={setHoveredPointIndex}
          />

          {/* Model Statistics Chips */}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="text-[11px] font-medium text-muted">已选模型分布:</span>
            {modelStats.length === 0 ? (
              <span className="text-[11px] text-muted">暂无模型调用数据</span>
            ) : (
              modelStats.map((m) => (
                <div
                  key={m.modelId}
                  className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-subtle px-2.5 py-1 text-xs"
                >
                  <span className="font-medium text-ink">{m.label}</span>
                  <span className="rounded bg-surface px-1 py-0.2 font-code text-[10px] text-muted border border-line">
                    {m.cliId}
                  </span>
                  <span className="font-code text-xs text-muted-strong font-semibold">
                    {m.count} 次 ({Math.round(m.share * 100)}%)
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Section 3: GitHub-Style Contribution Heatmap (Requirement 3) */}
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-center justify-between pb-3">
            <div>
              <h3 className="m-0 text-[15px] font-semibold tracking-[-0.015em] text-ink">
                对话更新活跃热力图
              </h3>
              <p className="mt-1 mb-0 text-[12px] text-muted">
                模仿 GitHub 贡献网格，统计每日对话轮次与任务更新频率
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-code text-xs font-semibold text-ink">
                过去 20 周共 {heatmap.totalUpdates} 次更新
              </span>
            </div>
          </div>

          {/* Heatmap Grid */}
          <div className="relative overflow-x-auto pb-2">
            <div className="inline-block min-w-full">
              {/* Month Header */}
              <div className="flex h-5 items-end pl-7 pb-1 text-[10px] font-mono text-muted select-none">
                {heatmap.monthLabels.map((ml, idx) => (
                  <span
                    key={`${ml.month}-${idx}`}
                    style={{
                      position: "relative",
                      left: `${ml.weekIndex * 15}px`,
                      marginRight: "-15px",
                    }}
                  >
                    {ml.month}
                  </span>
                ))}
              </div>

              <div className="flex gap-1.5 items-start">
                {/* Weekday labels */}
                <div className="flex flex-col justify-between h-[105px] pr-1.5 text-[9.5px] font-mono text-muted select-none py-0.5">
                  <span>周一</span>
                  <span>周三</span>
                  <span>周五</span>
                </div>

                {/* Heatmap Weeks & Days */}
                <div className="flex gap-[3px]">
                  {heatmap.weeks.map((week, wIndex) => (
                    <div key={`week-${wIndex}`} className="flex flex-col gap-[3px]">
                      {week.map((day, dIndex) => {
                        if (!day) {
                          return (
                            <div
                              key={`empty-${wIndex}-${dIndex}`}
                              className="h-3 w-3 rounded-[2.5px] bg-transparent"
                            />
                          );
                        }

                        const levelClass = getHeatmapCellColor(day.level);

                        return (
                          <div
                            key={day.date}
                            className={`h-3 w-3 cursor-pointer rounded-[2.5px] transition-all hover:scale-125 hover:z-10 ${levelClass}`}
                            onMouseEnter={() => setHoveredHeatmapDay(day)}
                            onMouseLeave={() => setHoveredHeatmapDay(null)}
                            title={`${day.date}: ${day.count} 次更新`}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              {/* Heatmap Footer Legend & Hover Tooltip */}
              <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
                <div className="flex items-center gap-2">
                  {hoveredHeatmapDay ? (
                    <span className="font-code text-xs text-ink">
                      {hoveredHeatmapDay.date}:{" "}
                      <strong>{hoveredHeatmapDay.count}</strong> 次对话更新
                    </span>
                  ) : (
                    <span>鼠标悬停方格查看每日详情</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[11px]">少</span>
                  <div className="h-3 w-3 rounded-[2px] bg-surface-subtle border border-line" />
                  <div className="h-3 w-3 rounded-[2px] bg-emerald-200 dark:bg-emerald-950/70 border border-emerald-300/40" />
                  <div className="h-3 w-3 rounded-[2px] bg-emerald-300 dark:bg-emerald-800 border border-emerald-400/50" />
                  <div className="h-3 w-3 rounded-[2px] bg-emerald-400 dark:bg-emerald-600 border border-emerald-500/50" />
                  <div className="h-3 w-3 rounded-[2px] bg-emerald-600 dark:bg-emerald-400 border border-emerald-700/50" />
                  <span className="text-[11px]">多</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

function getHeatmapCellColor(level: 0 | 1 | 2 | 3 | 4): string {
  switch (level) {
    case 1:
      return "bg-emerald-200 dark:bg-emerald-950/70 border border-emerald-300/40";
    case 2:
      return "bg-emerald-300 dark:bg-emerald-800 border border-emerald-400/50";
    case 3:
      return "bg-emerald-400 dark:bg-emerald-600 border border-emerald-500/50";
    case 4:
      return "bg-emerald-600 dark:bg-emerald-400 border border-emerald-700/50";
    case 0:
    default:
      return "bg-surface-subtle border border-line";
  }
}

interface MinimalistLineChartProps {
  data: DailyTrendPoint[];
  activeTab: ChartMetric;
  cliStats: FullStatsOverview["cliStats"];
  modelStats: FullStatsOverview["modelStats"];
  hoveredIndex: number | null;
  onHoverIndex: (index: number | null) => void;
}

interface ChartSeries {
  key: string;
  label: string;
  stroke: string;
  fill: string;
  values: number[];
}

function MinimalistLineChart({
  data,
  activeTab,
  cliStats,
  modelStats,
  hoveredIndex,
  onHoverIndex,
}: MinimalistLineChartProps) {
  const width = 640;
  const height = 180;
  const padding = { top: 15, right: 20, bottom: 25, left: 35 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Build series based on activeTab
  const seriesList: ChartSeries[] = useMemo(() => {
    if (activeTab === "total") {
      return [
        {
          key: "total",
          label: "总交互量",
          stroke: "var(--color-ink)",
          fill: "var(--color-ink)",
          values: data.map((d) => d.totalUpdates),
        },
      ];
    }

    if (activeTab === "cli") {
      const topClis = cliStats.slice(0, 3);
      const colors = [
        { stroke: "#18181b", fill: "#18181b" },
        { stroke: "#10b981", fill: "#10b981" },
        { stroke: "#6366f1", fill: "#6366f1" },
      ];
      return topClis.map((cli, i) => ({
        key: cli.cliId,
        label: cli.label,
        stroke: colors[i % colors.length]?.stroke ?? "#18181b",
        fill: colors[i % colors.length]?.fill ?? "#18181b",
        values: data.map((d) => d.byCli[cli.cliId] ?? 0),
      }));
    }

    // "model" tab
    const topModels = modelStats.slice(0, 3);
    const colors = [
      { stroke: "#3b82f6", fill: "#3b82f6" },
      { stroke: "#8b5cf6", fill: "#8b5cf6" },
      { stroke: "#f59e0b", fill: "#f59e0b" },
    ];
    return topModels.map((m, i) => ({
      key: m.modelId,
      label: m.label,
      stroke: colors[i % colors.length]?.stroke ?? "#3b82f6",
      fill: colors[i % colors.length]?.fill ?? "#3b82f6",
      values: data.map((d) => d.byModel[m.modelId] ?? 0),
    }));
  }, [activeTab, cliStats, modelStats, data]);

  // Compute maximum value for Y-axis scaling
  const maxValue = useMemo(() => {
    let max = 1;
    for (const s of seriesList) {
      for (const v of s.values) {
        if (v > max) max = v;
      }
    }
    // Round up to nice number
    return Math.ceil(max * 1.15);
  }, [seriesList]);

  // Generate SVG path for a series
  const getCoordinates = (values: number[]) => {
    const n = Math.max(values.length, 1);
    return values.map((val, idx) => {
      const x = padding.left + (idx / Math.max(n - 1, 1)) * chartWidth;
      const y = padding.top + chartHeight - (val / maxValue) * chartHeight;
      return { x, y };
    });
  };

  const buildPathD = (coords: { x: number; y: number }[]) => {
    if (coords.length === 0) return "";
    let d = `M ${coords[0]!.x.toFixed(1)} ${coords[0]!.y.toFixed(1)}`;
    for (let i = 1; i < coords.length; i++) {
      const curr = coords[i]!;
      const prev = coords[i - 1]!;
      const cpX1 = prev.x + (curr.x - prev.x) / 2;
      const cpX2 = cpX1;
      d += ` C ${cpX1.toFixed(1)} ${prev.y.toFixed(1)}, ${cpX2.toFixed(1)} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
    }
    return d;
  };

  const buildAreaD = (coords: { x: number; y: number }[]) => {
    if (coords.length === 0) return "";
    const lineD = buildPathD(coords);
    const last = coords[coords.length - 1]!;
    const first = coords[0]!;
    const baseline = padding.top + chartHeight;
    return `${lineD} L ${last.x.toFixed(1)} ${baseline} L ${first.x.toFixed(1)} ${baseline} Z`;
  };

  const hoveredDataPoint = hoveredIndex !== null ? data[hoveredIndex] : null;

  return (
    <div className="relative w-full">
      {/* Legend */}
      <div className="mb-2 flex items-center justify-end gap-3 text-xs">
        {seriesList.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: s.stroke }}
            />
            <span className="font-medium text-muted-strong">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="w-full overflow-hidden rounded-xl bg-surface-subtle/40 p-2">
        <svg
          className="w-full overflow-visible"
          height={height}
          preserveAspectRatio="none"
          viewBox={`0 0 ${width} ${height}`}
          onMouseLeave={() => onHoverIndex(null)}
        >
          <defs>
            {seriesList.map((s, idx) => (
              <linearGradient
                key={`grad-${s.key}`}
                id={`grad-${idx}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={s.fill} stopOpacity="0.18" />
                <stop offset="100%" stopColor={s.fill} stopOpacity="0.0" />
              </linearGradient>
            ))}
          </defs>

          {/* Grid lines */}
          <line
            x1={padding.left}
            y1={padding.top}
            x2={width - padding.right}
            y2={padding.top}
            stroke="var(--color-line)"
            strokeDasharray="3 3"
          />
          <line
            x1={padding.left}
            y1={padding.top + chartHeight / 2}
            x2={width - padding.right}
            y2={padding.top + chartHeight / 2}
            stroke="var(--color-line)"
            strokeDasharray="3 3"
          />
          <line
            x1={padding.left}
            y1={padding.top + chartHeight}
            x2={width - padding.right}
            y2={padding.top + chartHeight}
            stroke="var(--color-line-strong)"
          />

          {/* Y Axis ticks */}
          <text
            x={padding.left - 6}
            y={padding.top + 4}
            textAnchor="end"
            fontSize="10"
            fontFamily="monospace"
            fill="var(--color-muted)"
          >
            {maxValue}
          </text>
          <text
            x={padding.left - 6}
            y={padding.top + chartHeight / 2 + 3}
            textAnchor="end"
            fontSize="10"
            fontFamily="monospace"
            fill="var(--color-muted)"
          >
            {Math.round(maxValue / 2)}
          </text>
          <text
            x={padding.left - 6}
            y={padding.top + chartHeight}
            textAnchor="end"
            fontSize="10"
            fontFamily="monospace"
            fill="var(--color-muted)"
          >
            0
          </text>

          {/* Series Areas and Lines */}
          {seriesList.map((s, idx) => {
            const coords = getCoordinates(s.values);
            return (
              <g key={s.key}>
                <path d={buildAreaD(coords)} fill={`url(#grad-${idx})`} />
                <path
                  d={buildPathD(coords)}
                  fill="none"
                  stroke={s.stroke}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {coords.map((c, ptIdx) => (
                  <circle
                    key={`pt-${ptIdx}`}
                    cx={c.x}
                    cy={c.y}
                    r={hoveredIndex === ptIdx ? "4" : "2"}
                    fill={s.stroke}
                    className="transition-all"
                  />
                ))}
              </g>
            );
          })}

          {/* Hover guideline */}
          {hoveredIndex !== null && data.length > 0 && (
            <line
              x1={padding.left + (hoveredIndex / Math.max(data.length - 1, 1)) * chartWidth}
              y1={padding.top}
              x2={padding.left + (hoveredIndex / Math.max(data.length - 1, 1)) * chartWidth}
              y2={padding.top + chartHeight}
              stroke="var(--color-ink)"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
          )}

          {/* X Axis ticks */}
          {data.map((d, idx) => {
            // Display roughly 5-7 evenly spaced date ticks
            const step = Math.max(Math.floor(data.length / 5), 1);
            if (idx % step !== 0 && idx !== data.length - 1) return null;
            const x = padding.left + (idx / Math.max(data.length - 1, 1)) * chartWidth;
            return (
              <text
                key={d.dateKey}
                x={x}
                y={height - 6}
                textAnchor="middle"
                fontSize="10"
                fontFamily="monospace"
                fill="var(--color-muted)"
              >
                {d.displayDate}
              </text>
            );
          })}

          {/* Hover detection overlay columns */}
          {data.map((_, idx) => {
            const colWidth = chartWidth / data.length;
            const x = padding.left + idx * colWidth;
            return (
              <rect
                key={`hit-${idx}`}
                x={x - colWidth / 2}
                y={padding.top}
                width={colWidth}
                height={chartHeight}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => onHoverIndex(idx)}
              />
            );
          })}
        </svg>
      </div>

      {/* Hover Tooltip Popup */}
      {hoveredDataPoint && (
        <div className="mt-2 flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-1.5 text-xs shadow-xs">
          <span className="font-code font-medium text-ink">
            日期: {hoveredDataPoint.dateKey}
          </span>
          <div className="flex items-center gap-3">
            {seriesList.map((s) => (
              <span key={s.key} className="text-muted">
                {s.label}:{" "}
                <strong className="font-code text-ink">
                  {s.values[hoveredIndex ?? 0] ?? 0}
                </strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
