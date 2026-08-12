/**
 * Adapted from OpenClaw (MIT) — src/daemon/systemd-unit.ts (subset)
 */
function systemdEscapeArg(value) {
  const s = String(value);
  if (!/[\s"\\]/.test(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function assertNoSystemdLineBreaks(value, label) {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${label} must not contain line breaks`);
  }
}

function renderEnvLines(environment = {}) {
  return Object.entries(environment).map(([k, v]) => {
    assertNoSystemdLineBreaks(k, "Environment key");
    assertNoSystemdLineBreaks(String(v), "Environment value");
    return `Environment=${k}=${systemdEscapeArg(String(v))}`;
  });
}

export function renderSystemdUnit({
  description,
  workingDirectory,
  programArguments,
  environment,
  environmentFiles,
} = {}) {
  const args = programArguments || [];
  const execStart = args.map(systemdEscapeArg).join(" ");
  const descriptionValue = (description || "XClaw Gateway").trim();
  assertNoSystemdLineBreaks(descriptionValue, "Systemd Description");

  const lines = [
    "[Unit]",
    `Description=${descriptionValue}`,
    "After=network-online.target",
    "Wants=network-online.target",
    "StartLimitBurst=5",
    "StartLimitIntervalSec=60",
    "",
    "[Service]",
    `ExecStart=${execStart}`,
    "Restart=always",
    "RestartSec=5",
    "TimeoutStopSec=30",
    "TimeoutStartSec=30",
    "SuccessExitStatus=0 143",
    "OOMPolicy=continue",
    "KillMode=control-group",
    workingDirectory ? `WorkingDirectory=${systemdEscapeArg(workingDirectory)}` : null,
    ...(environmentFiles || []).map((f) => `EnvironmentFile=${systemdEscapeArg(f)}`),
    ...renderEnvLines(environment || {}),
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ];
  return lines.filter((l) => l !== null).join("\n");
}
