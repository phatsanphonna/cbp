import { open, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const architectures = [
  { id: 'amd64', label: 'Linux (x86-64)', machine: 62 },
  { id: 'arm64', label: 'Linux (ARM64)', machine: 183 }
] as const;

const maxBinarySize = 32 * 1024 * 1024;

function binaryPath(arch: string) {
  return resolve(process.env.CBP_AGENT_DOWNLOAD_DIR || '.agent-downloads', `cbp-agent-linux-${arch}`);
}

export async function agentDownloadOptions() {
  const available = await Promise.all(architectures.map(async ({ id, label }) => {
    const info = await stat(binaryPath(id)).catch(() => null);
    return info?.isFile() && info.size >= 64 && info.size <= maxBinarySize ? { id, label } : null;
  }));
  return available.filter((option) => option !== null);
}

export async function readAgentDownload(arch: string) {
  const architecture = architectures.find(({ id }) => id === arch);
  if (!architecture) return null;

  const file = await open(binaryPath(arch), 'r').catch(() => null);
  if (!file) return null;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 64 || info.size > maxBinarySize) return null;
    const binary = new Uint8Array(info.size);
    for (let offset = 0; offset < binary.length;) {
      const { bytesRead } = await file.read(binary, offset, binary.length - offset, offset);
      if (!bytesRead) return null;
      offset += bytesRead;
    }
    const header = new DataView(binary.buffer);
    const type = header.getUint16(16, true);
    if (header.getUint32(0) !== 0x7f454c46 || binary[4] !== 2 || binary[5] !== 1 ||
        (type !== 2 && type !== 3) || header.getUint16(18, true) !== architecture.machine) return null;
    return binary;
  } catch {
    return null;
  } finally {
    await file.close();
  }
}
