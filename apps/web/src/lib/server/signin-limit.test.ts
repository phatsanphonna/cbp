import { expect, test } from "bun:test";
import {
  allowAccountSignIn,
  allowSignIn,
  reserveCredentialCheck,
} from "./signin-limit.js";

test("repeated attempts delay a login for that client only", () => {
  const address = "192.0.2.10";
  for (let attempt = 0; attempt < 3; attempt++) {
    expect(allowSignIn(address, 100)?.("operator")).toBe(true);
  }
  expect(allowSignIn(address, 100)?.("operator")).toBe(false);
  expect(allowSignIn(address, 100)?.("viewer")).toBe(true);
  expect(allowSignIn("192.0.2.11", 100)?.("operator")).toBe(true);
  expect(allowSignIn(address, 1100)?.("operator")).toBe(true);
  expect(allowSignIn(address, 2100)?.("operator")).toBe(false);
  expect(allowSignIn(address, 3100)?.("operator")).toBe(true);
});

test("the client limit counts requests before they have a login", () => {
  for (let attempt = 0; attempt < 20; attempt++) {
    expect(allowSignIn("192.0.2.20", 100)).toBeFunction();
  }
  expect(allowSignIn("192.0.2.20", 100)).toBeNull();
  expect(allowSignIn("192.0.2.20", 60_100)).toBeFunction();
});

test("aliases share the account limit across clients", () => {
  for (let attempt = 0; attempt < 8; attempt++) {
    const login = attempt % 2 ? "operator" : "operator@example.test";
    expect(allowSignIn(`192.0.2.${30 + attempt}`, 100)?.(login)).toBe(true);
    expect(allowAccountSignIn("operator-id", login, 100)).toBeFunction();
  }
  expect(allowAccountSignIn("operator-id", "operator", 100)).toBeNull();
  expect(allowAccountSignIn("viewer-id", "viewer", 100)).toBeFunction();
  expect(
    allowAccountSignIn("operator-id", "operator@example.test", 60_100),
  ).toBeFunction();
});

test("a successful sign-in clears previous attempts", () => {
  let success: (() => void) | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    success = allowAccountSignIn("success-id", "success", 60_100);
  }
  expect(allowAccountSignIn("success-id", "success", 60_100)).toBeNull();
  success?.();
  expect(allowAccountSignIn("success-id", "success", 60_100)).toBeFunction();
});

test("credential checks share a global pool of four slots", () => {
  const releases = Array.from({ length: 4 }, reserveCredentialCheck);
  const first = releases.pop();
  try {
    expect(first).toBeFunction();
    expect(releases.every(Boolean)).toBe(true);
    expect(reserveCredentialCheck()).toBeNull();
  } finally {
    first?.();
    for (const release of releases) release?.();
  }
  const next = reserveCredentialCheck();
  expect(next).toBeFunction();
  next?.();
});
