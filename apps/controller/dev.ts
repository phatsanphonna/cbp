import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const env = { ...Bun.env };
const windows = process.platform === 'win32';
const cert = resolve(root, env.CBP_CONTROLLER_TLS_CERT || 'controller-fullchain.pem');
const key = resolve(root, env.CBP_CONTROLLER_TLS_KEY || 'controller.key');

if (!(await Bun.file(cert).exists()) || !(await Bun.file(key).exists())) {
  const message =
    'Controller TLS files are required. Set CBP_CONTROLLER_TLS_CERT and CBP_CONTROLLER_TLS_KEY, or place controller-fullchain.pem and controller.key in the repository root.';
  if (env.CBP_CONTROLLER_TLS_CERT || env.CBP_CONTROLLER_TLS_KEY) {
    console.error(message);
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
}

const installedGo = join(env.ProgramFiles || 'C:\\Program Files', 'Go', 'bin', 'go.exe');
const go =
  Bun.which('go') ?? (windows && (await Bun.file(installedGo).exists()) ? installedGo : null);
if (!go) {
  console.error('Install Go or add it to PATH to run the controller.');
  process.exit(1);
}
if (env.CBP_CONTROLLER_TOKEN && !env.CBP_WEB_URL) {
  env.CBP_WEB_URL = env.BETTER_AUTH_URL || 'http://127.0.0.1:5173';
}

// Live reload via air (config: apps/controller/.air.toml). Uses an installed `air`, else `go run`.
const air = Bun.which('air');
const child = Bun.spawn(
  [
    ...(air ? [air] : [go, 'run', 'github.com/air-verse/air@v1.67.4']),
    '-c',
    'apps/controller/.air.toml',
    '--',
    'serve',
    '-listen',
    env.CBP_CONTROLLER_LISTEN || '127.0.0.1:50051',
    '-tls-cert',
    cert,
    '-tls-key',
    key,
  ],
  { cwd: root, env, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
);
let stopping = false;
const stop = () => {
  stopping = true;
  child.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
const code = await child.exited;
process.exitCode = stopping ? 0 : code;
