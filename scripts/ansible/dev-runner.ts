import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const script = `${root}/scripts/ansible/dev-runner.sh`;
const distro = Bun.env.CBP_ANSIBLE_WSL_DISTRO || "Ubuntu";
let command: string[];

if (process.platform === "win32") {
  const convert = Bun.spawn(
    ["wsl.exe", "-d", distro, "--exec", "wslpath", "-a", root],
    { stdout: "pipe", stderr: "ignore" },
  );
  const wslRoot = (await new Response(convert.stdout).text()).trim();
  if (await convert.exited !== 0 || !wslRoot) {
    console.log(`Ansible runner skipped: WSL distro ${distro} is unavailable.`);
    process.exit(0);
  }
  command = ["wsl.exe", "-d", distro, "--exec", "bash", `${wslRoot}/scripts/ansible/dev-runner.sh`, wslRoot];
} else {
  command = ["bash", script, root];
}

const child = Bun.spawn(command, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
process.exitCode = await child.exited;
