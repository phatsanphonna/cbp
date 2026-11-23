import { expect, test } from "bun:test";
import { linuxAgentEnrollmentCommand } from "./agent-enrollment-command.js";

const command = (caFile?: string) =>
  linuxAgentEnrollmentCommand(
    "host-id",
    "sample-code",
    "controller.example.test:50051",
    caFile,
  );

test("stages a relative CA path under /etc/cbp for systemd", () => {
  const result = command("./controller-ca.pem");
  expect(result).toContain(
    "install -D -T -o root -g root -m 0644 -- './controller-ca.pem' '/etc/cbp/controller-ca.pem'",
  );
  expect(result).toContain("fi &&\nCBP_AGENT_ENROLLMENT_CODE='sample-code'");
  expect(result).toContain("cbp-agent register --host 'host-id'");
  expect(result).toEndWith(
    "--ca '/etc/cbp/controller-ca.pem' --install-service",
  );
});

test("keeps an absolute configured path and quotes shell arguments", () => {
  const result = command("/etc/cbp/team's CA.pem");
  expect(result).toContain("[ ! -e '/etc/cbp/team'\\''s CA.pem' ]");
  expect(result).toContain(
    "-- './team'\\''s CA.pem' '/etc/cbp/team'\\''s CA.pem'",
  );
  expect(result).toEndWith(
    "--ca '/etc/cbp/team'\\''s CA.pem' --install-service",
  );
});

test("uses the system trust store when a private CA is unset", () => {
  const result = command();
  expect(result).toContain("command -v cbp-agent");
  expect(result).toContain(
    "install -D -T -o root -g root -m 0755 -- './cbp-agent-linux' '/usr/local/bin/cbp-agent'",
  );
  expect(result).toEndWith(
    "cbp-agent register --host 'host-id' --controller 'controller.example.test:50051' --credential-file '/var/lib/cbp/agent.credential' --install-service",
  );
  expect(result).not.toContain("--ca ");
});
