import { posix } from "node:path";
import { normalizeHostAddress } from "./host-address.js";

export function normalizeAgentControllerAddress(value: string | undefined) {
  const parts = /^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/.exec(
    value?.trim() ?? "",
  );
  if (!parts) return null;
  const host = normalizeHostAddress(parts[1] ?? parts[2]);
  const port = Number(parts[3]);
  if (
    !host ||
    port < 1 ||
    port > 65535 ||
    Boolean(parts[1]) !== host.includes(":")
  )
    return null;
  return `${host.includes(":") ? `[${host}]` : host}:${port}`;
}

export function linuxAgentEnrollmentCommand(
  hostId: string,
  code: string,
  address: string,
  caFile?: string,
) {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const agentPath = 'PATH="/usr/local/bin:$PATH"';
  const steps = [
    "# If cbp-agent is missing, copy the Linux binary here as ./cbp-agent-linux.",
    `if ! ${agentPath} command -v cbp-agent >/dev/null 2>&1; then`,
    "  install -D -T -o root -g root -m 0755 -- './cbp-agent-linux' '/usr/local/bin/cbp-agent'",
    "fi &&",
  ];
  const args = [
    `CBP_AGENT_ENROLLMENT_CODE=${quote(code)}`,
    agentPath,
    "cbp-agent",
    "register",
    `--host ${quote(hostId)}`,
    `--controller ${quote(address)}`,
    `--credential-file ${quote("/var/lib/cbp/agent.credential")}`,
  ];
  if (caFile) {
    const { source, destination } = agentCaPaths(caFile);
    const target = quote(destination);
    steps.push(
      "# If the CA is not installed yet, place the trusted PEM at the source path below.",
      `if [ ! -e ${target} ] && [ ! -L ${target} ]; then`,
      `  install -D -T -o root -g root -m 0644 -- ${quote(source)} ${target}`,
      "fi &&",
    );
    args.push(`--ca ${target}`);
  }
  return [...steps, [...args, "--install-service"].join(" ")].join("\n");
}

export function agentCaPaths(caFile: string) {
  const absolute = posix.isAbsolute(caFile);
  const filename = posix.basename(caFile);
  return {
    filename,
    source: absolute ? `./${filename}` : caFile,
    destination: absolute
      ? posix.normalize(caFile)
      : posix.join("/etc/cbp", filename),
  };
}
