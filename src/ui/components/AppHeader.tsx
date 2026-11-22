import { Box, Text } from "ink";

import type { RoutingMode } from "../../config/schema";
import { theme } from "../theme";

export interface AppHeaderProps {
  readonly mode?: RoutingMode;
}

export function AppHeader({ mode }: AppHeaderProps) {
  const modeBadge =
    mode === "jev" ? "[决策: JEV]" : mode === "manual" ? "[决策: 手动]" : "[决策: 本地]";
  const modeColor = mode === "jev" ? theme.ok : mode === "manual" ? theme.accent : theme.muted;

  return (
    <Box flexDirection="row" paddingX={2} paddingTop={1} justifyContent="space-between">
      <Box flexDirection="row">
        <Text bold color={theme.brand}>
          code
        </Text>
        <Text bold color={theme.text}>
          relay
        </Text>
        <Text color={theme.muted}>{"  ·  "}</Text>
        <Text color={theme.muted}>本地 agent 接力台</Text>
      </Box>
      {mode ? (
        <Box>
          <Text bold color={modeColor}>
            {modeBadge}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
