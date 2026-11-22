use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use coderelay_core::host::{
    CommandError, CommandRunner, ExecOutput, ExecRequest, FileSystem, FsError,
};
use coderelay_core::scanner::{
    CliRuntime, CliSource, DiagnosticLevel, ScannerOptions, detect_host_agent, scan_coding_clis,
};

#[derive(Default)]
struct FakeHost {
    files: BTreeSet<String>,
    executable: BTreeSet<String>,
    outputs: BTreeMap<String, ExecOutput>,
    directories: BTreeMap<String, Vec<String>>,
}

impl FakeHost {
    fn command_key(request: &ExecRequest) -> String {
        [request.file.clone()]
            .into_iter()
            .chain(request.args.iter().cloned())
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn with_executable(mut self, path: &str) -> Self {
        self.files.insert(path.to_owned());
        self.executable.insert(path.to_owned());
        self
    }

    fn with_output(mut self, command: &str, stdout: &str) -> Self {
        self.outputs.insert(
            command.to_owned(),
            ExecOutput {
                stdout: stdout.to_owned(),
                stderr: String::new(),
            },
        );
        self
    }
}

impl CommandRunner for FakeHost {
    fn exec(&self, request: &ExecRequest) -> Result<ExecOutput, CommandError> {
        self.outputs
            .get(&Self::command_key(request))
            .cloned()
            .ok_or_else(|| CommandError::NotFound {
                file: request.file.clone(),
            })
    }
}

impl FileSystem for FakeHost {
    fn is_executable(&self, path: &Path) -> bool {
        self.executable.contains(path.to_string_lossy().as_ref())
    }

    fn read_to_string(&self, path: &Path) -> Result<String, FsError> {
        let path = path.to_string_lossy().into_owned();
        self.files
            .contains(&path)
            .then(String::new)
            .ok_or(FsError::NotFound {
                path: Path::new(&path).to_path_buf(),
            })
    }

    fn read_dir(&self, path: &Path) -> Result<Vec<String>, FsError> {
        let path = path.to_string_lossy().into_owned();
        self.directories
            .get(&path)
            .cloned()
            .ok_or(FsError::NotFound {
                path: Path::new(&path).to_path_buf(),
            })
    }
}

fn windows_options(home: &str, env: &[(&str, &str)]) -> ScannerOptions {
    ScannerOptions {
        platform: coderelay_core::host::Platform::Win32,
        home_dir: home.into(),
        environment: env
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect(),
        resolve_timeout: Duration::from_millis(100),
        version_timeout: Duration::from_millis(100),
        version_args: vec![vec!["--version".to_owned()]],
    }
}

fn linux_options(home: &str, env: &[(&str, &str)]) -> ScannerOptions {
    ScannerOptions {
        platform: coderelay_core::host::Platform::Linux,
        home_dir: home.into(),
        environment: env
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect(),
        resolve_timeout: Duration::from_millis(100),
        version_timeout: Duration::from_millis(100),
        version_args: vec![vec!["--version".to_owned()]],
    }
}

#[test]
fn windows_where_keeps_every_candidate_and_selects_the_first() {
    let first = "C:\\fixture\\codex\\codex.exe";
    let second = "C:\\fixture-alt\\codex.exe";
    let host = FakeHost::default()
        .with_executable(first)
        .with_executable(second)
        .with_output(
            "where codex",
            "\r\nC:\\fixture\\codex\\codex.exe\r\nC:\\fixture-alt\\codex.exe\r\n",
        )
        .with_output(
            "C:\\fixture\\codex\\codex.exe --version",
            "codex-cli 0.139.0\r\n",
        )
        .with_output(
            "C:\\fixture-alt\\codex.exe --version",
            "codex-cli 0.130.0\r\n",
        );
    let options = windows_options(
        "C:\\fixture-home",
        &[("PATH", "C:\\fixture\\codex;C:\\fixture-alt")],
    );

    let detected = scan_coding_clis(&host, &options);
    let codex = &detected[0];
    assert!(codex.available);
    assert_eq!(codex.path, first);
    assert_eq!(codex.version.as_deref(), Some("codex-cli 0.139.0"));
    assert_eq!(codex.runtime, CliRuntime::Local);
    assert_eq!(codex.candidates.len(), 2);
    assert_eq!(codex.candidates[1].path, second);
}

#[test]
fn windows_pathext_shim_is_attributed_to_npm_and_warns_when_not_on_path() {
    let claude = "C:\\fixture-home\\AppData\\Roaming\\npm\\claude.cmd";
    let host = FakeHost::default()
        .with_executable(claude)
        .with_output(&format!("{claude} --version"), "2.0.1 (Claude Code)\r\n");
    let options = windows_options(
        "C:\\fixture-home",
        &[
            ("PATH", "C:\\fixture-windows"),
            ("PATHEXT", ".CMD;.EXE"),
            ("APPDATA", "C:\\fixture-home\\AppData\\Roaming"),
        ],
    );

    let detected = scan_coding_clis(&host, &options);
    let cli = detected
        .iter()
        .find(|item| item.id.as_str() == "claude")
        .expect("claude");
    assert_eq!(cli.path, claude);
    assert_eq!(cli.source, CliSource::Npm);
    assert!(cli.diagnostics.iter().any(|entry| {
        entry.level == DiagnosticLevel::Warn && entry.message.contains("不在当前 PATH")
    }));
}

#[test]
fn codex_environment_override_is_used_and_version_probed() {
    let codex = "/opt/coderelay-fixture/codex";
    let host = FakeHost::default().with_executable(codex).with_output(
        "/opt/coderelay-fixture/codex --version",
        "codex-cli 0.155.0\n",
    );
    let options = linux_options(
        "/coderelay-fixture-home",
        &[("CODEX_CLI_PATH", "/opt/coderelay-fixture/codex")],
    );

    let detected = scan_coding_clis(&host, &options);
    let codex = detected
        .iter()
        .find(|item| item.id.as_str() == "codex")
        .expect("codex");
    assert!(codex.available);
    assert_eq!(codex.path, "/opt/coderelay-fixture/codex");
    assert_eq!(codex.source, CliSource::Installer);
    assert_eq!(codex.version.as_deref(), Some("codex-cli 0.155.0"));
}

#[test]
fn latest_claude_version_directory_is_used_with_numeric_ordering() {
    let home_dir = PathBuf::from("/coderelay-fixture-home");
    let versions_dir = home_dir.join(".local/share/claude/versions");
    let v278 = versions_dir.join("2.1.278").to_string_lossy().into_owned();
    let v275 = versions_dir.join("2.1.275").to_string_lossy().into_owned();
    let mut host = FakeHost::default()
        .with_executable(&v278)
        .with_executable(&v275)
        .with_output(&format!("{v278} --version"), "2.1.278\n");
    host.directories.insert(
        versions_dir.to_string_lossy().into_owned(),
        vec![
            "2.1.275".to_owned(),
            "2.1.278".to_owned(),
            "2.1.270".to_owned(),
        ],
    );
    let home = home_dir.to_string_lossy().into_owned();
    let options = linux_options(&home, &[]);

    let detected = scan_coding_clis(&host, &options);
    let claude = detected
        .iter()
        .find(|item| item.id.as_str() == "claude")
        .expect("claude");
    assert_eq!(claude.path, v278);
    assert_eq!(claude.version.as_deref(), Some("2.1.278"));
}

#[test]
fn host_agent_markers_are_detected_from_environment() {
    let claude = BTreeMap::from([("CLAUDE_CODE_CHILD_SESSION".to_owned(), "1".to_owned())]);
    let pi = BTreeMap::from([("PI_CODING_AGENT".to_owned(), "true".to_owned())]);
    assert_eq!(
        detect_host_agent(&claude).map(|agent| agent.as_str()),
        Some("claude")
    );
    assert_eq!(
        detect_host_agent(&pi).map(|agent| agent.as_str()),
        Some("pi")
    );
    assert!(detect_host_agent(&BTreeMap::new()).is_none());
}
