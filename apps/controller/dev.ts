import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const env = { ...Bun.env };
const windows = process.platform === 'win32';
const cert = resolve(root, env.CBP_CONTROLLER_TLS_CERT || 'controller-fullchain.pem');
const key = resolve(root, env.CBP_CONTROLLER_TLS_KEY || 'controller.key');

if (!await Bun.file(cert).exists() || !await Bun.file(key).exists()) {
  const message = 'Controller TLS files are required. Set CBP_CONTROLLER_TLS_CERT and CBP_CONTROLLER_TLS_KEY, or place controller-fullchain.pem and controller.key in the repository root.';
  if (env.CBP_CONTROLLER_TLS_CERT || env.CBP_CONTROLLER_TLS_KEY) {
    console.error(message);
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
}

const installedGo = join(env.ProgramFiles || 'C:\\Program Files', 'Go', 'bin', 'go.exe');
const go = Bun.which('go') ?? (windows && await Bun.file(installedGo).exists() ? installedGo : null);
if (!go) {
  console.error('Install Go or add it to PATH to run the controller.');
  process.exit(1);
}
if (env.CBP_CONTROLLER_TOKEN && !env.CBP_WEB_URL) {
  env.CBP_WEB_URL = env.BETTER_AUTH_URL || 'http://127.0.0.1:5173';
}

const directory = await mkdtemp(join(tmpdir(), 'cbp-controller-'));
const executable = join(directory, windows ? 'cbp-controller.exe' : 'cbp-controller');
const options = { cwd: root, env, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' } as const;
let child: ReturnType<typeof Bun.spawn> | undefined;
let stopping = false;

function stop() {
  stopping = true;
  child?.kill();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

try {
  child = Bun.spawn([go, 'build', '-o', executable, './apps/controller'], options);
  const built = await child.exited;
  if (built === 0 && !stopping) {
    child = Bun.spawn([
      executable, 'serve',
      '-listen', env.CBP_CONTROLLER_LISTEN || '127.0.0.1:50051',
      '-tls-cert', cert,
      '-tls-key', key
    ], options);
    process.exitCode = await child.exited;
  } else {
    process.exitCode = built;
  }
} finally {
  if (stopping) process.exitCode = 0;
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  await rm(executable, { force: true });
  await rmdir(directory);
}
