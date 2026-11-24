import { X509Certificate } from "node:crypto";
import { certificatePemBlocks } from "./certificate-chain.js";

const maxPemBytes = 32 * 1024;

export function publicAgentCaPem(pem: string) {
  if (Buffer.byteLength(pem) > maxPemBytes) return null;
  const blocks = certificatePemBlocks(pem);
  if (!blocks) return null;
  try {
    return (
      blocks
        .map((block) => new X509Certificate(block).toString().trim())
        .join("\n") + "\n"
    );
  } catch {
    return null;
  }
}

export async function readAgentCaPem(path: string) {
  try {
    return publicAgentCaPem(
      await Bun.file(path)
        .slice(0, maxPemBytes + 1)
        .text(),
    );
  } catch {
    return null;
  }
}
