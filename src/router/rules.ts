import type { RouteRule } from "../config/schema";
import type { RouteCandidate, RouteRequest, RuleMatch } from "./types";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert a small, shell-style glob into a regular expression.
 *
 * Supported syntax: `*`, `**`, and `?`. This intentionally avoids a runtime
 * dependency because routing only needs file-pattern matching.
 */
export function globToRegExp(glob: string): RegExp {
  const normalized = glob.replaceAll("\\", "/");
  let source = "";

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === "*" && next === "*") {
      const afterNext = normalized[index + 2];
      if (afterNext === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(char ?? "");
  }

  return new RegExp(`^${source}$`);
}

export function matchesFileGlob(pattern: string, filePath: string): boolean {
  const normalizedPath = filePath.replaceAll("\\", "/");
  if (globToRegExp(pattern).test(normalizedPath)) {
    return true;
  }

  if (!pattern.includes("*") && !pattern.includes("?")) {
    const basename = normalizedPath.split("/").at(-1);
    return basename === pattern;
  }

  return false;
}

function matchesAnyKeyword(prompt: string, keywords: readonly string[]): boolean {
  const normalizedPrompt = prompt.toLocaleLowerCase();
  return keywords.some((keyword) => normalizedPrompt.includes(keyword.toLocaleLowerCase()));
}

function matchesAnyPattern(prompt: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => new RegExp(pattern, "i").test(prompt));
}

function matchesLanguage(
  requestLanguage: string | undefined,
  languages: readonly string[],
): boolean {
  if (!requestLanguage) {
    return false;
  }

  const normalized = requestLanguage.toLocaleLowerCase();
  return languages.some((language) => language.toLocaleLowerCase() === normalized);
}

function matchesFile(request: RouteRequest, patterns: readonly string[]): boolean {
  const files = request.files ?? [];
  return files.some((file) => patterns.some((pattern) => matchesFileGlob(pattern, file)));
}

/** Test all conditions in a rule; conditions are combined with AND. */
export function matchesRule(request: RouteRequest, rule: RouteRule): boolean {
  const when = rule.when;
  if (!when) {
    return true;
  }

  if (when.keywords && !matchesAnyKeyword(request.prompt, when.keywords)) {
    return false;
  }

  if (when.patterns && !matchesAnyPattern(request.prompt, when.patterns)) {
    return false;
  }

  if (when.languages && !matchesLanguage(request.language, when.languages)) {
    return false;
  }

  if (when.files && !matchesFile(request, when.files)) {
    return false;
  }

  if (when.minPromptLength !== undefined && request.prompt.length < when.minPromptLength) {
    return false;
  }

  if (when.maxPromptLength !== undefined && request.prompt.length > when.maxPromptLength) {
    return false;
  }

  return true;
}

export function ruleMatchesCandidate(rule: RouteRule, candidate: RouteCandidate): boolean {
  if (rule.use.agent && rule.use.agent !== candidate.agent) {
    return false;
  }

  if (rule.use.model && rule.use.model !== candidate.model) {
    return false;
  }

  return true;
}

function describeRule(rule: RouteRule): string {
  const target = [rule.use.agent, rule.use.model].filter(Boolean).join(":");
  return `matched rule "${rule.name}"${target ? ` -> ${target}` : ""}`;
}

/** Return matching rules ordered by descending priority. */
export function matchRules(request: RouteRequest, rules: readonly RouteRule[]): RuleMatch[] {
  return rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => matchesRule(request, rule))
    .sort((left, right) => {
      const priority = right.rule.priority - left.rule.priority;
      return priority === 0 ? left.index - right.index : priority;
    })
    .map(({ rule }) => ({ rule, reason: describeRule(rule) }));
}

export function matchRulesForCandidate(
  request: RouteRequest,
  candidate: RouteCandidate,
  rules: readonly RouteRule[],
): RuleMatch[] {
  return matchRules(request, rules).filter(({ rule }) => ruleMatchesCandidate(rule, candidate));
}
