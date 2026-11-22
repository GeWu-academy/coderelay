import type { AgentEntry, ModelOption, SessionRecord, SessionTurn } from "./types";

export interface CliUsageStat {
  cliId: string;
  label: string;
  sessionCount: number;
  turnCount: number;
  sessionShare: number; // 0 to 1
  turnShare: number; // 0 to 1
  lastActiveAt: number;
  models: { modelId: string; count: number }[];
}

export interface ModelUsageStat {
  modelId: string;
  label: string;
  cliId: string;
  count: number;
  share: number; // 0 to 1
}

export interface DailyTrendPoint {
  dateKey: string; // "YYYY-MM-DD"
  displayDate: string; // "MM/DD"
  totalUpdates: number;
  byCli: Record<string, number>;
  byModel: Record<string, number>;
}

export interface HeatmapDay {
  date: string; // "YYYY-MM-DD"
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  dayOfWeek: number; // 0 (Sun) - 6 (Sat)
}

export interface HeatmapMonthLabel {
  month: string;
  weekIndex: number;
}

export interface HeatmapData {
  weeks: (HeatmapDay | null)[][]; // Array of weeks, each containing 7 days (index 0=Sun..6=Sat)
  monthLabels: HeatmapMonthLabel[];
  totalUpdates: number;
}

export interface StatsSummary {
  totalSessions: number;
  totalTurns: number;
  totalClis: number;
  mostUsedCli: CliUsageStat | null;
  mostUsedModel: ModelUsageStat | null;
  currentStreak: number;
  longestStreak: number;
  totalActiveDays: number;
}

export interface FullStatsOverview {
  summary: StatsSummary;
  cliStats: CliUsageStat[];
  modelStats: ModelUsageStat[];
  trendPoints: DailyTrendPoint[];
  heatmap: HeatmapData;
}

export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDisplayDate(dateKey: string): string {
  const parts = dateKey.split("-");
  if (parts.length === 3) {
    return `${parts[1]}/${parts[2]}`;
  }
  return dateKey;
}

export function getHeatmapLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 8) return 3;
  return 4;
}

export function aggregateCliStats(
  sessions: SessionRecord[],
  turnsMap: Record<string, SessionTurn[]>,
  agents: AgentEntry[],
): CliUsageStat[] {
  const agentLabelMap = new Map<string, string>();
  for (const agent of agents) {
    agentLabelMap.set(agent.id, agent.label);
  }

  const cliSessionCounts = new Map<string, number>();
  const cliTurnCounts = new Map<string, number>();
  const cliLastActive = new Map<string, number>();
  const cliModelsMap = new Map<string, Map<string, number>>();

  for (const session of sessions) {
    const cli = session.cliId || "unknown";
    cliSessionCounts.set(cli, (cliSessionCounts.get(cli) ?? 0) + 1);

    const prevActive = cliLastActive.get(cli) ?? 0;
    const sessionActive = Math.max(session.updatedAt || 0, session.createdAt || 0);
    if (sessionActive > prevActive) {
      cliLastActive.set(cli, sessionActive);
    }

    const turns = turnsMap[session.id] ?? [];
    if (turns.length > 0) {
      for (const turn of turns) {
        const turnCli = turn.cliId || cli;
        cliTurnCounts.set(turnCli, (cliTurnCounts.get(turnCli) ?? 0) + 1);

        if (turn.modelId) {
          if (!cliModelsMap.has(turnCli)) {
            cliModelsMap.set(turnCli, new Map());
          }
          const mCounts = cliModelsMap.get(turnCli)!;
          mCounts.set(turn.modelId, (mCounts.get(turn.modelId) ?? 0) + 1);
        }
      }
    } else {
      // Fallback: at least 1 turn per existing session
      cliTurnCounts.set(cli, (cliTurnCounts.get(cli) ?? 0) + 1);
    }
  }

  const totalSessions = sessions.length;
  let totalTurns = 0;
  for (const count of cliTurnCounts.values()) {
    totalTurns += count;
  }

  const allClis = new Set<string>([
    ...cliSessionCounts.keys(),
    ...cliTurnCounts.keys(),
  ]);

  const stats: CliUsageStat[] = [];
  for (const cliId of allClis) {
    const sCount = cliSessionCounts.get(cliId) ?? 0;
    const tCount = cliTurnCounts.get(cliId) ?? 0;
    const mCounts = cliModelsMap.get(cliId);
    const modelsList: { modelId: string; count: number }[] = [];
    if (mCounts) {
      for (const [modelId, count] of mCounts.entries()) {
        modelsList.push({ modelId, count });
      }
      modelsList.sort((a, b) => b.count - a.count);
    }

    stats.push({
      cliId,
      label: agentLabelMap.get(cliId) ?? cliId.toUpperCase(),
      sessionCount: sCount,
      turnCount: tCount,
      sessionShare: totalSessions > 0 ? sCount / totalSessions : 0,
      turnShare: totalTurns > 0 ? tCount / totalTurns : 0,
      lastActiveAt: cliLastActive.get(cliId) ?? 0,
      models: modelsList,
    });
  }

  stats.sort((a, b) => b.turnCount - a.turnCount || b.sessionCount - a.sessionCount);
  return stats;
}

export function aggregateModelStats(
  sessions: SessionRecord[],
  turnsMap: Record<string, SessionTurn[]>,
  catalogOptions: ModelOption[],
): ModelUsageStat[] {
  const modelOptionMap = new Map<string, ModelOption>();
  for (const opt of catalogOptions) {
    modelOptionMap.set(opt.modelId, opt);
  }

  const modelCounts = new Map<string, { count: number; cliId: string }>();

  for (const session of sessions) {
    const turns = turnsMap[session.id] ?? [];
    for (const turn of turns) {
      if (turn.modelId) {
        const existing = modelCounts.get(turn.modelId);
        if (existing) {
          existing.count += 1;
        } else {
          modelCounts.set(turn.modelId, {
            count: 1,
            cliId: turn.cliId || session.cliId,
          });
        }
      }
    }
  }

  let totalModelCalls = 0;
  for (const info of modelCounts.values()) {
    totalModelCalls += info.count;
  }

  const result: ModelUsageStat[] = [];
  for (const [modelId, info] of modelCounts.entries()) {
    const opt = modelOptionMap.get(modelId);
    result.push({
      modelId,
      label: opt?.label ?? modelId,
      cliId: opt?.cliId ?? info.cliId,
      count: info.count,
      share: totalModelCalls > 0 ? info.count / totalModelCalls : 0,
    });
  }

  result.sort((a, b) => b.count - a.count);
  return result;
}

export function buildDailyTrendPoints(
  sessions: SessionRecord[],
  turnsMap: Record<string, SessionTurn[]>,
  daysCount = 14,
  referenceDate = new Date(),
): DailyTrendPoint[] {
  const points: DailyTrendPoint[] = [];
  const map = new Map<
    string,
    { total: number; byCli: Record<string, number>; byModel: Record<string, number> }
  >();

  // Initialize all days in chronological order
  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - i);
    const key = formatDateKey(d);
    map.set(key, { total: 0, byCli: {}, byModel: {} });
  }

  // Populate counts from turns or session activity
  for (const session of sessions) {
    const turns = turnsMap[session.id] ?? [];
    if (turns.length > 0) {
      for (const turn of turns) {
        const d = new Date(turn.createdAt || session.updatedAt || session.createdAt);
        const key = formatDateKey(d);
        const bucket = map.get(key);
        if (bucket) {
          bucket.total += 1;
          const cli = turn.cliId || session.cliId;
          bucket.byCli[cli] = (bucket.byCli[cli] ?? 0) + 1;
          if (turn.modelId) {
            bucket.byModel[turn.modelId] = (bucket.byModel[turn.modelId] ?? 0) + 1;
          }
        }
      }
    } else {
      // Fallback: session updatedAt & createdAt
      const d = new Date(session.updatedAt || session.createdAt);
      const key = formatDateKey(d);
      const bucket = map.get(key);
      if (bucket) {
        bucket.total += 1;
        const cli = session.cliId;
        bucket.byCli[cli] = (bucket.byCli[cli] ?? 0) + 1;
      }
    }
  }

  for (const [dateKey, data] of map.entries()) {
    points.push({
      dateKey,
      displayDate: formatDisplayDate(dateKey),
      totalUpdates: data.total,
      byCli: data.byCli,
      byModel: data.byModel,
    });
  }

  return points;
}

export function buildContributionHeatmap(
  sessions: SessionRecord[],
  turnsMap: Record<string, SessionTurn[]>,
  weeksCount = 20,
  referenceDate = new Date(),
): HeatmapData {
  // Aggregate all update counts by dateKey
  const dateCounts = new Map<string, number>();

  for (const session of sessions) {
    const turns = turnsMap[session.id] ?? [];
    if (turns.length > 0) {
      for (const turn of turns) {
        const d = new Date(turn.createdAt || session.updatedAt || session.createdAt);
        const key = formatDateKey(d);
        dateCounts.set(key, (dateCounts.get(key) ?? 0) + 1);
      }
    } else {
      const updatedKey = formatDateKey(new Date(session.updatedAt || session.createdAt));
      dateCounts.set(updatedKey, (dateCounts.get(updatedKey) ?? 0) + 1);
      if (session.createdAt && session.updatedAt && session.createdAt !== session.updatedAt) {
        const createdKey = formatDateKey(new Date(session.createdAt));
        if (createdKey !== updatedKey) {
          dateCounts.set(createdKey, (dateCounts.get(createdKey) ?? 0) + 1);
        }
      }
    }
  }

  // End at the current week's Saturday (or Sunday) to align full columns
  const end = new Date(referenceDate);
  const endDayOfWeek = end.getDay(); // 0 is Sun, 6 is Sat
  const daysUntilSaturday = 6 - endDayOfWeek;
  const gridEnd = new Date(end);
  gridEnd.setDate(gridEnd.getDate() + daysUntilSaturday);

  // Total days to display = weeksCount * 7
  const totalDays = weeksCount * 7;
  const gridStart = new Date(gridEnd);
  gridStart.setDate(gridStart.getDate() - totalDays + 1);

  const weeks: (HeatmapDay | null)[][] = [];
  const monthLabels: HeatmapMonthLabel[] = [];
  let totalUpdates = 0;

  let currentWeek: (HeatmapDay | null)[] = [];
  let lastMonth = -1;

  for (let i = 0; i < totalDays; i++) {
    const curr = new Date(gridStart);
    curr.setDate(curr.getDate() + i);

    const dayOfWeek = curr.getDay(); // 0 = Sun .. 6 = Sat
    const dateKey = formatDateKey(curr);

    // If day is past referenceDate, we can treat it as null/future or 0 count
    const isFuture = curr.getTime() > end.getTime();
    const count = isFuture ? 0 : dateCounts.get(dateKey) ?? 0;
    if (!isFuture) {
      totalUpdates += count;
    }

    const dayObj: HeatmapDay = {
      date: dateKey,
      count,
      level: isFuture ? 0 : getHeatmapLevel(count),
      dayOfWeek,
    };

    currentWeek.push(dayObj);

    // If Sunday or first day of a week, check month label
    if (dayOfWeek === 0) {
      const month = curr.getMonth();
      if (month !== lastMonth) {
        const monthNames = [
          "1月",
          "2月",
          "3月",
          "4月",
          "5月",
          "6月",
          "7月",
          "8月",
          "9月",
          "10月",
          "11月",
          "12月",
        ];
        monthLabels.push({
          month: monthNames[month] ?? `${month + 1}月`,
          weekIndex: weeks.length,
        });
        lastMonth = month;
      }
    }

    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push(null);
    }
    weeks.push(currentWeek);
  }

  return {
    weeks,
    monthLabels,
    totalUpdates,
  };
}

export function computeStreaks(
  sessions: SessionRecord[],
  turnsMap: Record<string, SessionTurn[]>,
  referenceDate = new Date(),
): { currentStreak: number; longestStreak: number; totalActiveDays: number } {
  const activeDates = new Set<string>();

  for (const session of sessions) {
    const turns = turnsMap[session.id] ?? [];
    if (turns.length > 0) {
      for (const turn of turns) {
        activeDates.add(formatDateKey(new Date(turn.createdAt || session.updatedAt)));
      }
    } else {
      activeDates.add(formatDateKey(new Date(session.updatedAt || session.createdAt)));
    }
  }

  const totalActiveDays = activeDates.size;
  if (totalActiveDays === 0) {
    return { currentStreak: 0, longestStreak: 0, totalActiveDays: 0 };
  }

  // Calculate current streak
  let currentStreak = 0;
  const checkDate = new Date(referenceDate);
  const todayKey = formatDateKey(checkDate);

  if (!activeDates.has(todayKey)) {
    // Check if yesterday was active
    checkDate.setDate(checkDate.getDate() - 1);
  }

  while (activeDates.has(formatDateKey(checkDate))) {
    currentStreak += 1;
    checkDate.setDate(checkDate.getDate() - 1);
  }

  // Calculate longest streak across sorted dates
  const sortedDates = Array.from(activeDates).sort();
  let longestStreak = 0;
  let tempStreak = 0;
  let prevTime: number | null = null;

  for (const dStr of sortedDates) {
    const parts = dStr.split("-").map(Number);
    const y = parts[0];
    const m = parts[1];
    const d = parts[2];
    if (y === undefined || m === undefined || d === undefined) {
      continue;
    }
    const time = new Date(y, m - 1, d).getTime();
    const oneDay = 86400000;

    if (prevTime === null) {
      tempStreak = 1;
    } else if (Math.round((time - prevTime) / oneDay) === 1) {
      tempStreak += 1;
    } else {
      tempStreak = 1;
    }

    if (tempStreak > longestStreak) {
      longestStreak = tempStreak;
    }
    prevTime = time;
  }

  return {
    currentStreak,
    longestStreak,
    totalActiveDays,
  };
}

export function computeOverview(
  sessions: SessionRecord[],
  turnsMap: Record<string, SessionTurn[]>,
  agents: AgentEntry[],
  catalogOptions: ModelOption[],
  referenceDate = new Date(),
): FullStatsOverview {
  const cliStats = aggregateCliStats(sessions, turnsMap, agents);
  const modelStats = aggregateModelStats(sessions, turnsMap, catalogOptions);
  const trendPoints = buildDailyTrendPoints(sessions, turnsMap, 14, referenceDate);
  const heatmap = buildContributionHeatmap(sessions, turnsMap, 20, referenceDate);
  const streaks = computeStreaks(sessions, turnsMap, referenceDate);

  let totalTurns = 0;
  for (const c of cliStats) {
    totalTurns += c.turnCount;
  }

  return {
    summary: {
      totalSessions: sessions.length,
      totalTurns,
      totalClis: cliStats.length,
      mostUsedCli: cliStats[0] ?? null,
      mostUsedModel: modelStats[0] ?? null,
      currentStreak: streaks.currentStreak,
      longestStreak: streaks.longestStreak,
      totalActiveDays: streaks.totalActiveDays,
    },
    cliStats,
    modelStats,
    trendPoints,
    heatmap,
  };
}
