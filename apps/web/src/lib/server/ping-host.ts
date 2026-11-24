import { execFile } from "node:child_process";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { platform, env } from "node:process";
import { promisify } from "node:util";
import { normalizeHostAddress } from "./host-address.js";

const run = promisify(execFile);
export const pingLabels = {
  reachable: "Reachable",
  "no-reply": "No reply",
  unavailable: "Check unavailable",
};

type PingResult = {
  status: keyof typeof pingLabels;
  address: string | null;
  message: string;
};
const windowsPing = `
try {
  $ping = New-Object System.Net.NetworkInformation.Ping
  try {
    $reply = $ping.Send($env:CBP_PING_TARGET, 1500)
    if ($reply.Status -ne [System.Net.NetworkInformation.IPStatus]::Success) { exit 1 }
  } finally { $ping.Dispose() }
} catch { exit 2 }
`;

async function resolveAddress(target: string) {
  if (isIP(target)) return target;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { address } = await Promise.race([
      lookup(target),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("DNS lookup timed out")),
          2000,
        );
      }),
    ]);
    return address;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function pingHost(registeredName: string): Promise<PingResult> {
  const target = normalizeHostAddress(registeredName);
  if (!target)
    return {
      status: "unavailable",
      address: null,
      message: "The registered host address is invalid.",
    };

  const windows = platform === "win32";
  if (!windows && platform !== "linux") {
    return {
      status: "unavailable",
      address: null,
      message: "Ping is available on Windows and Linux servers.",
    };
  }

  let address: string | null = null;
  try {
    address = await resolveAddress(target);
    const executable = windows ? "powershell.exe" : "ping";
    const args = windows
      ? ["-NoProfile", "-NonInteractive", "-Command", windowsPing]
      : ["-n", "-c", "1", "-W", "2", address];
    await run(executable, args, {
      timeout: 5000,
      maxBuffer: 8192,
      windowsHide: true,
      env: windows ? { ...env, CBP_PING_TARGET: address } : undefined,
    });
    return {
      status: "reachable",
      address,
      message: "Received an ICMP reply from the host.",
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === 1
    ) {
      return {
        status: "no-reply",
        address,
        message: "No ICMP reply. Ping may be blocked by a firewall.",
      };
    }
    return {
      status: "unavailable",
      address,
      message:
        "CBP could not complete the check. Check name resolution and ping availability on the CBP server.",
    };
  }
}
