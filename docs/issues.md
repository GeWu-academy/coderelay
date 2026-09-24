# GitHub Issues 分类

仓库：[AlkaidSTART/coderelay](https://github.com/AlkaidSTART/coderelay)
共 67 个 Issue：Open 33，Closed 34。每个 Issue 按主要涉及层归入一个分类；标题、状态和链接来自 GitHub。

重新生成：`bun run issues:doc`（需安装并登录 GitHub CLI）。

## CLI 与 TUI (6：Open 5 / Closed 1)

- [#17 fix(tui): hybrid 模式下歧义判断未使用 routing rules](https://github.com/AlkaidSTART/coderelay/issues/17) — Open
- [#20 fix(tui): 无效配置会被静默忽略并回退到默认配置](https://github.com/AlkaidSTART/coderelay/issues/20) — Closed
- [#63 fix(run): manual 模式在非交互 run 命令中会静默执行自动路由](https://github.com/AlkaidSTART/coderelay/issues/63) — Open
- [#66 fix(tui): 自动路由不应被当前 activeId 的安装状态提前拦截](https://github.com/AlkaidSTART/coderelay/issues/66) — Open
- [#73 fix(tui): 取消 Jev 决策后旧 flow 仍可能启动 agent](https://github.com/AlkaidSTART/coderelay/issues/73) — Open
- [#91 fix(favorite): -C/--cwd 参数当前完全未使用](https://github.com/AlkaidSTART/coderelay/issues/91) — Open

## 配置与工作区 (7：Open 4 / Closed 3)

- [#19 fix(config): activation 保存可能在子目录创建 shadow config](https://github.com/AlkaidSTART/coderelay/issues/19) — Closed
- [#61 fix(config): /activate 会把项目配置的激活状态写到全局配置](https://github.com/AlkaidSTART/coderelay/issues/61) — Open
- [#62 fix(config): CLI 子命令默认不会加载 ~/.coderelay/config.yaml](https://github.com/AlkaidSTART/coderelay/issues/62) — Closed
- [#65 fix(workspace): 切换工作区后 routing.mode 不会从新配置刷新](https://github.com/AlkaidSTART/coderelay/issues/65) — Open
- [#77 fix(config): activation 配置 read-modify-write 存在多实例 lost update](https://github.com/AlkaidSTART/coderelay/issues/77) — Open
- [#84 fix(config): defaultAgent 禁用校验忽略未显式配置但默认启用的 agents](https://github.com/AlkaidSTART/coderelay/issues/84) — Open
- [#86 fix(workspace): last_workspace 持久化值从未恢复且启动时会立即被覆盖](https://github.com/AlkaidSTART/coderelay/issues/86) — Closed

## 扫描与模型探测 (16：Open 11 / Closed 5)

- [#21 fix(catalog): 自定义 agent command 在默认 CLI 未被扫描到时会被判定为未安装](https://github.com/AlkaidSTART/coderelay/issues/21) — Closed
- [#22 fix(codex): 模型探测不应强依赖 cc-switch-model-catalog.json](https://github.com/AlkaidSTART/coderelay/issues/22) — Closed
- [#40 fix(claude): 模型探测不应要求 settings.json 必须存在](https://github.com/AlkaidSTART/coderelay/issues/40) — Closed
- [#41 fix(pi): 模型探测不应强依赖 models.json](https://github.com/AlkaidSTART/coderelay/issues/41) — Open
- [#42 fix(omp): 模型探测不应仅依赖 config.yml 中的 modelRoles](https://github.com/AlkaidSTART/coderelay/issues/42) — Open
- [#44 fix(catalog): agents.<id>.env 未应用到模型探测环境](https://github.com/AlkaidSTART/coderelay/issues/44) — Open
- [#47 fix(wsl): WSL CLI 的模型探测错误读取宿主机配置目录](https://github.com/AlkaidSTART/coderelay/issues/47) — Open
- [#52 fix(codex): 模型探测忽略 CODEX_HOME](https://github.com/AlkaidSTART/coderelay/issues/52) — Open
- [#53 fix(pi): 模型探测忽略 PI_CODING_AGENT_DIR](https://github.com/AlkaidSTART/coderelay/issues/53) — Open
- [#54 fix(omp): 模型探测忽略 PI_CONFIG_DIR / PI_CODING_AGENT_DIR](https://github.com/AlkaidSTART/coderelay/issues/54) — Open
- [#55 fix(pi): models.json 探测会丢失 provider identity](https://github.com/AlkaidSTART/coderelay/issues/55) — Closed
- [#70 fix(codex): 模型探测未按当前 Codex 配置层/profile 解析实际运行模型](https://github.com/AlkaidSTART/coderelay/issues/70) — Open
- [#71 fix(scanner): 首个 version probe 失败的候选仍会压过后续可用安装](https://github.com/AlkaidSTART/coderelay/issues/71) — Open
- [#79 fix(claude): 模型探测未解析项目/local/managed settings 的有效配置层](https://github.com/AlkaidSTART/coderelay/issues/79) — Open
- [#80 fix(codex): 模型探测不应暴露 visibility=hide 的内部模型](https://github.com/AlkaidSTART/coderelay/issues/80) — Open
- [#81 fix(scanner): CODEX_CLI_PATH 被错误地当作 config.toml 键读取](https://github.com/AlkaidSTART/coderelay/issues/81) — Closed

## 路由与 Jev 决策 (12：Open 3 / Closed 9)

- [#16 fix(router): 配置中的 model strengths 会在模型目录构建时被静默丢弃](https://github.com/AlkaidSTART/coderelay/issues/16) — Closed
- [#18 fix(jev): 未知 choice 会静默回退到第一个候选](https://github.com/AlkaidSTART/coderelay/issues/18) — Closed
- [#43 fix(router): 各 CLI 的 native default model 会同时获得全局 default bonus](https://github.com/AlkaidSTART/coderelay/issues/43) — Open
- [#45 fix(jev): 路由请求会丢弃 files/language/contextSize/requiredStrengths](https://github.com/AlkaidSTART/coderelay/issues/45) — Open
- [#59 fix(jev): env.locaj 拼写错误已被运行时与测试共同固化](https://github.com/AlkaidSTART/coderelay/issues/59) — Closed
- [#68 fix(router): hybrid 策略不会用 rule priority 处理冲突或 tie](https://github.com/AlkaidSTART/coderelay/issues/68) — Closed
- [#72 fix(jev): 成功响应只做 TypeScript 强转，malformed JSON shape 可泄漏 TypeError](https://github.com/AlkaidSTART/coderelay/issues/72) — Closed
- [#78 fix(router): contextWindow 配置当前完全不会进入路由逻辑](https://github.com/AlkaidSTART/coderelay/issues/78) — Closed
- [#82 fix(models): 带冒号的 model id 会被 parseModelRef 误判为 agent:model](https://github.com/AlkaidSTART/coderelay/issues/82) — Open
- [#87 fix(jev): candidate cost 元数据未进入 Jev criteria](https://github.com/AlkaidSTART/coderelay/issues/87) — Closed
- [#88 fix(router): strength inference 的 substring 匹配会被普通单词误触发](https://github.com/AlkaidSTART/coderelay/issues/88) — Closed
- [#89 fix(router): buildRouteCandidates 会排除未显式配置但默认 enabled 的 CLI](https://github.com/AlkaidSTART/coderelay/issues/89) — Closed

## Runtime 与事件协议 (10：Open 1 / Closed 9)

- [#24 perf(runtime): stderrRest 会重复累积完整 stderr 且未被使用](https://github.com/AlkaidSTART/coderelay/issues/24) — Closed
- [#27 fix(runtime): completed 事件会导致 eventSummary 重复包含完整输出](https://github.com/AlkaidSTART/coderelay/issues/27) — Closed
- [#38 fix(omp): JSON event stream 与统一 structured parser 不兼容](https://github.com/AlkaidSTART/coderelay/issues/38) — Open
- [#49 fix(runtime): AgentRunResult.text 被 summarizeEvents 截断到 4000 字符](https://github.com/AlkaidSTART/coderelay/issues/49) — Closed
- [#50 fix(runtime): text protocol 被强制按行缓冲并会丢失空行](https://github.com/AlkaidSTART/coderelay/issues/50) — Closed
- [#56 perf(runtime): events 数组会保留完整生命周期全部事件](https://github.com/AlkaidSTART/coderelay/issues/56) — Closed
- [#57 fix(runtime): 已经 aborted 的 AbortSignal 在启动时不会立即终止任务](https://github.com/AlkaidSTART/coderelay/issues/57) — Closed
- [#74 fix(parser): text protocol 不应把普通 JSON 回答解析为 structured event](https://github.com/AlkaidSTART/coderelay/issues/74) — Closed
- [#75 fix(runtime): structured terminal events 不会影响最终 AgentRunResult.status](https://github.com/AlkaidSTART/coderelay/issues/75) — Closed
- [#83 fix(runtime): 用户 abort 可被后续 timeout 覆盖为 timeout](https://github.com/AlkaidSTART/coderelay/issues/83) — Closed

## Bash/WSL 与跨平台命令执行 (5：Open 4 / Closed 1)

- [#46 fix(wsl): Linux cwd 不应作为 wsl.exe 的 Windows spawn cwd](https://github.com/AlkaidSTART/coderelay/issues/46) — Open
- [#48 fix(windows): runAgentStream 无法启动 npm .cmd shim](https://github.com/AlkaidSTART/coderelay/issues/48) — Open
- [#51 fix(wsl): agents.<id>.env 不会自动传入 WSL Linux 环境](https://github.com/AlkaidSTART/coderelay/issues/51) — Open
- [#58 fix(wsl): toWslPath 硬编码 /mnt 无法支持自定义 automount root](https://github.com/AlkaidSTART/coderelay/issues/58) — Closed
- [#85 fix(wsl): distro 列表不能通过删除 NUL 正确解码非 ASCII UTF-16LE 名称](https://github.com/AlkaidSTART/coderelay/issues/85) — Open

## 会话与持久化 (11：Open 5 / Closed 6)

- [#23 fix(session): native session ID 无法从 agent 输出中被记录](https://github.com/AlkaidSTART/coderelay/issues/23) — Open
- [#25 fix(codex): native resume 忽略 session ID 并始终使用 --last](https://github.com/AlkaidSTART/coderelay/issues/25) — Closed
- [#26 fix(session): 跨 CLI 切回旧 agent 时会错误复用其 native session](https://github.com/AlkaidSTART/coderelay/issues/26) — Open
- [#28 fix(session): sessions.db 路径不会跟随实际发现的项目配置](https://github.com/AlkaidSTART/coderelay/issues/28) — Closed
- [#39 fix(pi): native resume 应使用 --session 而不是 --resume](https://github.com/AlkaidSTART/coderelay/issues/39) — Closed
- [#60 fix(workspace): 切换工作区时未重置 session/native context 导致跨项目串上下文](https://github.com/AlkaidSTART/coderelay/issues/60) — Open
- [#64 fix(session): 全局 sessions.db 的 retention 会跨 workspace 删除历史会话](https://github.com/AlkaidSTART/coderelay/issues/64) — Closed
- [#67 fix(session): 超长历史 prompt 会让 transcript 上下文整体被丢弃](https://github.com/AlkaidSTART/coderelay/issues/67) — Open
- [#69 fix(session): SQLite foreign key constraint 声明后未显式启用](https://github.com/AlkaidSTART/coderelay/issues/69) — Closed
- [#76 fix(session): 全局 sessions.db 缺少 busy_timeout 导致并发写入静默丢历史](https://github.com/AlkaidSTART/coderelay/issues/76) — Open
- [#90 fix(session): migration 不应把所有 ALTER TABLE 异常都当作已存在列忽略](https://github.com/AlkaidSTART/coderelay/issues/90) — Closed
