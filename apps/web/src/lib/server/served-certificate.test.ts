import { expect, test } from "bun:test";
import { parseServedCertificateExpiry } from "./served-certificate.js";

test("served certificate expiry parses valid UTC times including expired certificates", () => {
  expect(
    parseServedCertificateExpiry("2020-02-29T12:34:56Z")?.toISOString(),
  ).toBe("2020-02-29T12:34:56.000Z");
});

test("served certificate expiry rejects invalid dates and unexpected input", () => {
  for (const value of [
    "2026-02-29T12:34:56Z",
    "0000-01-01T00:00:00Z",
    "2026-01-01",
    null,
    123,
  ]) {
    expect(parseServedCertificateExpiry(value)).toBeNull();
  }
});
