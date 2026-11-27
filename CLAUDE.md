# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

Project skills are available in `.claude/skills/`. Their skill files point to the canonical content in `.agents/skills/`.

## Extra commands

- Single web test file: `bun test apps/web/src/lib/server/<name>.test.ts`; filter by name with `-t '<pattern>'`.
- Single Go test: `go test ./apps/agent -run TestName` (same for `./apps/controller`).
- Database schema: `bun --filter @cbp/database db:push` (Drizzle push for dev). Role grants, the restricted `cbp_web` login, and controller/alert/access-control tables come from `bun --filter @cbp/database db:setup-controller`, which needs the database owner connection. Run it after schema changes that touch those areas.
- Database security integration tests need a disposable DB: set `CBP_TEST_DATABASE_URL` and run `bun test packages/database/src/deployment-security.test.ts`.
- Local Postgres: `docker compose --env-file .cbp-dev/.env -f compose.dev.yaml up --wait` (listens on `127.0.0.1:5433`).
- Web and database scripts load the root `.env.local` via `--env-file`, so run them through the package scripts, not bare `vite`.

## Architecture

CBP manages TLS certificates and deploys them to Linux hosts. There are three runtime pieces plus an optional worker:

- **Web (`apps/web`, SvelteKit on Bun)** is the source of truth. It owns PostgreSQL access (through `@cbp/database`), auth (better-auth), and all business logic. `src/hooks.server.ts` runs background timers (deployment-job expiry, alert reconciliation and notification delivery, Let's Encrypt and self-signed renewals, Vault secret cleanup) and enforces route permissions. Page-level gates use `hasPermission`; form-action writes go through `canWriteRouteAction` in `src/lib/server/access-control.ts`. Admins are `CBP_ADMIN_EMAILS` or users with the `sudo` permission, which can be granted directly or through a group.
- **Controller (`apps/controller`, Go)** is a gRPC-over-TLS front door for agents. It holds no business state: every RPC is forwarded over HTTPS to the web app's `/api/internal/controller/*` endpoints, authenticated with `CBP_CONTROLLER_TOKEN`. Adding an agent capability usually means touching `packages/agent-rpc/agent.proto` and `rpc.go`, the controller forwarder, the agent, and a new internal web route, which must also be added to `controllerRoutes` in `hooks.server.ts`.
- **Agent (`apps/agent`, Go)** runs on target Linux hosts as a systemd service. It dials out to the controller, enrolls once, checks in, and polls `ClaimDeployment` to install certificates. Linux-only code lives in `*_linux.go` with `*_other.go` stubs, so the code still builds on Windows/macOS.
- **Ansible worker (`scripts/ansible/runner.py`)** is the agentless path for Nginx hosts over SSH. It claims jobs from the web app using `CBP_ANSIBLE_TOKEN`. `bun run dev` launches it via `scripts/ansible/dev-runner.ts`.
- **`packages/database`** exposes Drizzle schemas and queries per domain through subpath exports (`@cbp/database/deployment-jobs`, `/alerts`, `/renewals`, …). Add a new module to `exports` in its `package.json`. The web app connects as the restricted `cbp_web` role, so new tables need a `create table if not exists` and grants in `packages/database/scripts/setup-controller.ts` as well as the Drizzle schema.
- **Asset ownership** (`packages/database/src/asset-owners.ts`): certificates, hosts, and Ansible credentials can be owned by users or groups. Unowned assets are visible to all, and admins/sudo bypass ownership. List and lookup queries take an optional `viewer` from `assetViewer(locals.user)`. `hooks.server.ts` returns 404 for `/certificates/[id]*` and `/hosts/[id]*` the viewer cannot access. Ids taken from form fields (the other side of a deployment, a credential id, a job id) must be checked separately. Internal controller/Ansible routes and background timers are never filtered.

Deployment flow: a user queues a job in the web app. The private key is held temporarily in Vault (KV v2 at `cbp`, when `CBP_VAULT_ADDR` and `CBP_VAULT_TOKEN` are set) or in web-process memory otherwise. The agent or Ansible worker then claims the job, streams logs, and reports the result. Unclaimed jobs expire after ten minutes, and the temporary secret is removed on claim or cancel. Saved credentials (encrypted notification secrets, renewal keys) are derived from `BETTER_AUTH_SECRET`, so that value must stay stable.
