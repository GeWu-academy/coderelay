mod claude;
mod codex;
mod omp;
mod pi;

use std::borrow::Cow;
use std::collections::BTreeMap;
use std::time::Duration;

use serde::Serialize;

use crate::agent::AgentId;
use crate::host::{CommandRunner, ExecRequest};
use crate::scanner::DetectedCli;

pub use claude::ClaudePermissions;
pub use codex::CodexPermissions;
pub use omp::OmpPermissions;
pub use pi::PiPermissions;

/// Permission level id meaning "do not pass any permission flag; keep the CLI's own config".
pub const DEFAULT_PERMISSION_ID: &str = "default";

/// Default timeout for scanning a single CLI's `--help` output.
pub const DEFAULT_PERMISSION_SCAN_TIMEOUT: Duration = Duration::from_secs(4);

/// One user-selectable permission level of a CLI.
///
/// Each CLI module encapsulates its own `--help` scanner and argv mapping: the UI
/// lists `id`/`label`/`description`, and `args` is spliced into the CLI argv.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    pub id: Cow<'static, str>,
    pub label: Cow<'static, str>,
    pub description: Cow<'static, str>,
    #[serde(skip)]
    pub args: Vec<Cow<'static, str>>,
    /// Disables sandboxing/approvals; the UI should flag it visually.
    pub dangerous: bool,
}

/// Per-CLI permission provider encapsulating scanning and argv resolution.
pub trait CliPermissions: Sync {
    fn agent_id(&self) -> AgentId;
    fn options(&self) -> Vec<PermissionOption>;
    fn help_args(&self) -> &'static [&'static str];
    fn scan_from_help(&self, help_text: &str) -> Vec<PermissionOption>;
    fn resolve_args(&self, id: &str) -> Result<Vec<String>, String>;
}

pub(super) fn static_option(
    id: &'static str,
    label: &'static str,
    description: &'static str,
    args: &'static [&'static str],
    dangerous: bool,
) -> PermissionOption {
    PermissionOption {
        id: Cow::Borrowed(id),
        label: Cow::Borrowed(label),
        description: Cow::Borrowed(description),
        args: args.iter().copied().map(Cow::Borrowed).collect(),
        dangerous,
    }
}

pub(super) fn default_option() -> PermissionOption {
    static_option(
        DEFAULT_PERMISSION_ID,
        "默认",
        "沿用该 CLI 自身的配置",
        &[],
        false,
    )
}

const CODEX_PERMISSIONS: CodexPermissions = CodexPermissions;
const CLAUDE_PERMISSIONS: ClaudePermissions = ClaudePermissions;
const PI_PERMISSIONS: PiPermissions = PiPermissions;
const OMP_PERMISSIONS: OmpPermissions = OmpPermissions;

/// Return the dedicated permission provider for a given CLI.
pub const fn permission_provider(agent: AgentId) -> &'static dyn CliPermissions {
    match agent {
        AgentId::Codex => &CODEX_PERMISSIONS,
        AgentId::Claude => &CLAUDE_PERMISSIONS,
        AgentId::Pi => &PI_PERMISSIONS,
        AgentId::Omp => &OMP_PERMISSIONS,
    }
}

/// Return the static fallback permission options supported by a given CLI.
pub fn permission_options(agent: AgentId) -> Vec<PermissionOption> {
    permission_provider(agent).options()
}

/// Resolve a permission id to its argv fragment. `None` means the CLI default.
pub fn permission_args(agent: AgentId, permission: Option<&str>) -> Result<Vec<String>, String> {
    let Some(id) = permission else {
        return Ok(Vec::new());
    };
    permission_provider(agent).resolve_args(id)
}

/// Scan a single detected CLI's `--help` output to discover its supported permission options.
///
/// Unavailable CLIs return only the default option. If invoking `--help` fails or times out,
/// this falls back to the CLI's static `options()` catalog.
pub fn scan_agent_permissions(
    runner: &dyn CommandRunner,
    cli: &DetectedCli,
    environment: &BTreeMap<String, String>,
    timeout: Duration,
) -> Vec<PermissionOption> {
    let provider = permission_provider(cli.id);
    let Some(target) = cli.launch_target() else {
        return vec![default_option()];
    };

    let help_args: Vec<String> = provider
        .help_args()
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect();

    let (file, args) = if target.runtime == CliRuntime::Wsl {
        let mut command = vec![target.path];
        command.extend(help_args);
        (
            "wsl.exe".to_owned(),
            build_wsl_args(target.distro.as_deref(), &command),
        )
    } else {
        (target.path, help_args)
    };

    let request = ExecRequest::new(file, args)
        .with_timeout(timeout)
        .with_env(environment.clone());

    let Ok(output) = runner.exec(&request) else {
        return provider.options();
    };

    let combined = if output.stdout.trim().is_empty() {
        output.stderr
    } else if output.stderr.trim().is_empty() {
        output.stdout
    } else {
        format!("{}\n{}", output.stdout, output.stderr)
    };

    if combined.trim().is_empty() {
        return provider.options();
    }

    let scanned = provider.scan_from_help(&combined);
    if scanned.is_empty() {
        provider.options()
    } else {
        scanned
    }
}

/// Scan all detected CLIs in parallel to build each CLI's live permission options.
pub fn scan_permissions(
    runner: &(dyn CommandRunner + Sync),
    detected: &[DetectedCli],
    environment: &BTreeMap<String, String>,
    timeout: Duration,
) -> Vec<(AgentId, Vec<PermissionOption>)> {
    std::thread::scope(|scope| {
        let handles: Vec<_> = detected
            .iter()
            .map(|cli| {
                let id = cli.id;
                let handle =
                    scope.spawn(move || scan_agent_permissions(runner, cli, environment, timeout));
                (id, handle)
            })
            .collect();

        handles
            .into_iter()
            .map(|(id, handle)| {
                let options = handle.join().unwrap_or_else(|_| permission_options(id));
                (id, options)
            })
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::agent_ids;
    use crate::host::{CommandError, ExecOutput};
    use crate::scanner::CliSource;

    struct MockRunner {
        outputs: BTreeMap<String, Result<ExecOutput, String>>,
    }

    impl CommandRunner for MockRunner {
        fn exec(&self, request: &ExecRequest) -> Result<ExecOutput, CommandError> {
            match self.outputs.get(&request.file) {
                Some(Ok(output)) => Ok(output.clone()),
                Some(Err(_reason)) => Err(CommandError::Timeout {
                    timeout: Duration::from_secs(1),
                }),
                None => Err(CommandError::NotFound {
                    file: request.file.clone(),
                }),
            }
        }
    }

    fn detected_cli(id: AgentId, path: &str, available: bool) -> DetectedCli {
        DetectedCli {
            id,
            bin: id.as_str().to_owned(),
            path: path.to_owned(),
            version: Some("1.0.0".to_owned()),
            available,
            runtime: CliRuntime::Local,
            source: CliSource::Path,
            distro: None,
            mount_root: None,
            candidates: Vec::new(),
            diagnostics: Vec::new(),
        }
    }

    #[test]
    fn every_agent_provider_matches_agent_id_and_starts_with_default() {
        for agent in agent_ids() {
            let provider = permission_provider(agent);
            assert_eq!(provider.agent_id(), agent);

            let options = permission_options(agent);
            assert_eq!(options[0].id, DEFAULT_PERMISSION_ID);
            assert!(options[0].args.is_empty());
            for (index, item) in options.iter().enumerate() {
                assert!(options[..index].iter().all(|other| other.id != item.id));
            }
        }
    }

    #[test]
    fn maps_claude_plan_and_codex_read_only() {
        assert_eq!(
            permission_args(AgentId::Claude, Some("plan")).unwrap(),
            vec!["--permission-mode", "plan"]
        );
        assert_eq!(
            permission_args(AgentId::Codex, Some("read-only")).unwrap(),
            vec!["--sandbox", "read-only"]
        );
        assert_eq!(
            permission_args(AgentId::Omp, Some("yolo")).unwrap(),
            vec!["--approval-mode", "yolo"]
        );
    }

    #[test]
    fn pi_read_only_allows_only_non_mutating_tools() {
        let args = permission_args(AgentId::Pi, Some("read-only")).unwrap();
        assert_eq!(args, vec!["--tools", "read,grep,find,ls"]);
        for mutating in ["bash", "edit", "write", "powershell"] {
            assert!(!args[1].split(',').any(|tool| tool == mutating));
        }
    }

    #[test]
    fn none_and_default_add_no_args() {
        assert!(permission_args(AgentId::Codex, None).unwrap().is_empty());
        assert!(
            permission_args(AgentId::Claude, Some(DEFAULT_PERMISSION_ID))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn rejects_level_of_another_cli() {
        assert!(permission_args(AgentId::Codex, Some("plan")).is_err());
        assert!(permission_args(AgentId::Pi, Some("yolo")).is_err());
        assert!(permission_args(AgentId::Omp, Some("read-only")).is_err());
    }

    #[test]
    fn dangerous_flag_only_on_full_access_levels() {
        let dangerous: Vec<_> = permission_options(AgentId::Claude)
            .into_iter()
            .filter(|item| item.dangerous)
            .map(|item| item.id)
            .collect();
        assert_eq!(dangerous, vec!["bypassPermissions"]);
    }

    #[test]
    fn scans_real_help_outputs_per_cli() {
        let mut outputs = BTreeMap::new();
        outputs.insert(
            "/usr/bin/codex".to_owned(),
            Ok(ExecOutput {
                stdout: r#"
  -s, --sandbox <SANDBOX_MODE>
          [possible values: read-only, workspace-write, danger-full-access]
      --approve-for-me
      --dangerously-bypass-approvals-and-sandbox
"#
                .to_owned(),
                stderr: String::new(),
            }),
        );
        outputs.insert(
            "/usr/bin/claude".to_owned(),
            Ok(ExecOutput {
                stdout: r#"
  --permission-mode <mode>              Permission mode to use for the session
                                        (choices: "acceptEdits", "auto",
                                        "bypassPermissions", "manual",
                                        "dontAsk", "plan")
"#
                .to_owned(),
                stderr: String::new(),
            }),
        );
        outputs.insert(
            "/usr/bin/pi".to_owned(),
            Ok(ExecOutput {
                stdout: "  --tools, -t <tools>   Comma-separated allowlist\n".to_owned(),
                stderr: String::new(),
            }),
        );
        outputs.insert(
            "/usr/bin/omp".to_owned(),
            Ok(ExecOutput {
                stdout: "  --approval-mode=<value>  Override tools.approvalMode (always-ask|write|yolo)\n"
                    .to_owned(),
                stderr: String::new(),
            }),
        );

        let runner = MockRunner { outputs };
        let detected = vec![
            detected_cli(AgentId::Codex, "/usr/bin/codex", true),
            detected_cli(AgentId::Claude, "/usr/bin/claude", true),
            detected_cli(AgentId::Pi, "/usr/bin/pi", true),
            detected_cli(AgentId::Omp, "/usr/bin/omp", true),
        ];

        let scanned = scan_permissions(
            &runner,
            &detected,
            &BTreeMap::new(),
            DEFAULT_PERMISSION_SCAN_TIMEOUT,
        );

        let by_id: BTreeMap<_, _> = scanned.into_iter().collect();
        let codex_ids: Vec<_> = by_id[&AgentId::Codex]
            .iter()
            .map(|o| o.id.as_ref())
            .collect();
        assert_eq!(
            codex_ids,
            vec![
                "default",
                "read-only",
                "workspace-write",
                "approve-for-me",
                "full-access"
            ]
        );

        let claude_ids: Vec<_> = by_id[&AgentId::Claude]
            .iter()
            .map(|o| o.id.as_ref())
            .collect();
        assert_eq!(
            claude_ids,
            vec![
                "default",
                "acceptEdits",
                "auto",
                "bypassPermissions",
                "manual",
                "dontAsk",
                "plan",
            ]
        );

        let pi_ids: Vec<_> = by_id[&AgentId::Pi].iter().map(|o| o.id.as_ref()).collect();
        assert_eq!(pi_ids, vec!["default", "read-only"]);

        let omp_ids: Vec<_> = by_id[&AgentId::Omp].iter().map(|o| o.id.as_ref()).collect();
        assert_eq!(omp_ids, vec!["default", "always-ask", "write", "yolo"]);
    }

    #[test]
    fn unavailable_cli_returns_only_default_and_failed_scan_falls_back() {
        let mut outputs = BTreeMap::new();
        outputs.insert("/usr/bin/codex".to_owned(), Err("timed out".to_owned()));
        let runner = MockRunner { outputs };

        let unavailable = detected_cli(AgentId::Pi, "", false);
        let pi_opts = scan_agent_permissions(
            &runner,
            &unavailable,
            &BTreeMap::new(),
            DEFAULT_PERMISSION_SCAN_TIMEOUT,
        );
        assert_eq!(pi_opts.len(), 1);
        assert_eq!(pi_opts[0].id, DEFAULT_PERMISSION_ID);

        let timed_out_codex = detected_cli(AgentId::Codex, "/usr/bin/codex", true);
        let codex_opts = scan_agent_permissions(
            &runner,
            &timed_out_codex,
            &BTreeMap::new(),
            DEFAULT_PERMISSION_SCAN_TIMEOUT,
        );
        assert_eq!(codex_opts, permission_options(AgentId::Codex));
    }
}
