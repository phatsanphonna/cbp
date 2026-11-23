import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  randomBytes,
  X509Certificate,
} from "node:crypto";

const maxKeySize = 16_384;
const invalidKey =
  "Provide a matching unencrypted PEM private key up to 16 KB.";

export async function readDeploymentKey(
  fields: FormData,
  fullchain: string,
): Promise<{ pem: string } | { message: string }> {
  const upload = fields.get("privateKey");
  const pasted = fields.get("privateKeyPem");
  const file = upload instanceof File && upload.size > 0 ? upload : null;
  const text = typeof pasted === "string" ? pasted : "";
  if (
    (upload !== null && !(upload instanceof File)) ||
    (pasted !== null && typeof pasted !== "string") ||
    (file?.size ?? 0) > maxKeySize ||
    Buffer.byteLength(text, "utf8") > maxKeySize
  ) {
    return { message: invalidKey };
  }
  if (file && text.trim()) {
    return {
      message:
        "Upload a private key file or paste the PEM contents. Choose one.",
    };
  }

  const pem = (file ? await file.text() : text).trim();
  if (
    !/^-----BEGIN (PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY)-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END \1-----$/.test(
      pem,
    )
  ) {
    return { message: invalidKey };
  }
  try {
    const key = createPrivateKey(pem);
    return new X509Certificate(fullchain).checkPrivateKey(key)
      ? { pem: key.export({ format: "pem", type: "pkcs8" }).toString() }
      : { message: invalidKey };
  } catch {
    return { message: invalidKey };
  }
}

export function sealDeploymentKey(key: Buffer, id: string, pem: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(id));
  const encrypted = Buffer.concat([cipher.update(pem, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}

export function openDeploymentKey(key: Buffer, id: string, sealed: string) {
  const bytes = Buffer.from(sealed, "base64url");
  const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(id));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([
    cipher.update(bytes.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
