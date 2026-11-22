import { Spinner } from "@inkjs/ui";
import { Box, Text } from "ink";

import { CLI_IDS } from "../../models/cli";
import { theme } from "../theme";
import { cliDisplayName } from "./CliList";

export function ScanningView() {
  return (
    <Box flexDirection="column" paddingX={2}>
      <Box flexDirection="row">
        <Spinner type="dots" />
        <Text bold color={theme.text}>
          {" "}
          正在扫描本机编码代理…
        </Text>
      </Box>
      <Text color={theme.muted}>翻翻 PATH，看看谁已经就位。</Text>

      <Box flexDirection="column" marginTop={1}>
        {CLI_IDS.map((id, index) => (
          <Text key={id}>
            <Text color={theme.muted}>{String(index + 1).padStart(2, "0")}</Text>
            <Text color={theme.muted}>
              {"  "}
              {cliDisplayName(id)}
            </Text>
            <Text color={theme.muted}>{"  等待检测"}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}
