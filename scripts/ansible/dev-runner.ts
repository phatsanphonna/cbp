import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const script = `${root}/scripts/ansible/dev-runner.sh`;
const distro = Bun.env.CBP_ANSIBLE_WSL_DISTRO || 'Ubuntu';
const wslPidFile =
  process.platform === 'win32' ? `/tmp/cbp-ansible-dev-${randomUUID()}.pid` : undefined;
let command: string[];

if (process.platform === 'win32') {
  const convert = Bun.spawn(['wsl.exe', '-d', distro, '--exec', 'wslpath', '-a', root], {
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const wslRoot = (await new Response(convert.stdout).text()).trim();
  if ((await convert.exited) !== 0 || !wslRoot) {
    console.log(`Ansible runner skipped: WSL distro ${distro} is unavailable.`);
    process.exit(0);
  }
  command = [
    'wsl.exe',
    '-d',
    distro,
    '--exec',
    'env',
    `CBP_ANSIBLE_DEV_PID_FILE=${wslPidFile}`,
    'bash',
    `${wslRoot}/scripts/ansible/dev-runner.sh`,
    wslRoot,
  ];
} else {
  command = ['bash', script, root];
}

const child = Bun.spawn(command, {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
let stopping = false;
let forceStop: ReturnType<typeof setTimeout> | undefined;
let stopWsl: Promise<void> | undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) {
      child.kill('SIGKILL');
      return;
    }
    stopping = true;
    if (wslPidFile) {
      const stopScript = `if [[ -s '${wslPidFile}' ]]; then pid="$(cat '${wslPidFile}')"; kill -TERM "$pid" 2>/dev/null; rm -f '${wslPidFile}'; else exit 1; fi`;
      try {
        const stopper = Bun.spawn(['wsl.exe', '-d', distro, '--exec', 'bash', '-c', stopScript], {
          stdout: 'ignore',
          stderr: 'ignore',
        });
        stopWsl = stopper.exited.then((code) => {
          if (code !== 0) child.kill(signal);
        });
      } catch {
        child.kill(signal);
      }
    } else {
      child.kill(signal);
    }
    forceStop = setTimeout(() => child.kill('SIGKILL'), 15_000);
    forceStop.unref();
  });
}
process.exitCode = await child.exited;
if (forceStop) clearTimeout(forceStop);
await stopWsl;
