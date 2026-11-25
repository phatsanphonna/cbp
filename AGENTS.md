# Repository Guidelines

## Project Structure

- `apps/web/` contains the SvelteKit app. Find pages and endpoints in `src/routes/`, shared Svelte components in `src/lib/components/`, server helpers in `src/lib/server/`, and public assets in `static/`.
- `apps/controller/` contains the Go gRPC controller and its web API client. `apps/agent/` contains the Go CLI, Linux systemd integration, and certificate deployment logic.
- `packages/agent-rpc/` defines the shared gRPC contract in `agent.proto` and `rpc.go`. `packages/database/` contains the PostgreSQL schemas, queries, and Drizzle setup scripts.

## Build, Test, and Development

Use Bun 1.4.5 and Go 1.27.4. Run these commands from the repository root.

- `bun install --frozen-lockfile` installs workspace dependencies.
- `bun run dev` starts the web development server and launches the controller when its TLS files are configured. `bun run --filter web dev` starts the web app alone.
- `bun run --filter web build` builds the production Bun server in `apps/web/dist/`. Run it with `bun run --filter web start`.
- `go build ./apps/controller ./apps/agent` checks that both Go programs compile.

## Coding Style and Testing

Run `gofmt` on changed Go files. Use two-space indentation and single quotes in TypeScript and Svelte. Follow SvelteKit route names such as `+page.server.ts` and `+server.ts`, and use kebab-case for shared component and helper filenames.

- Use the existing shadcn-svelte Select for new dropdowns. In forms, use `form-select.svelte` to keep the trigger associated with its label and submit the field under its existing name. Use a native select only when the feature explicitly requires native behavior.
- Run `go test ./apps/agent/... ./apps/controller/... ./packages/agent-rpc/...`. Keep Go tests next to their code in `*_test.go` files with `TestXxx` functions.
- Run `bun test apps/web/src/lib/server` for web unit tests. Co-locate `*.test.ts` files with their helpers and use `bun:test`.
- Add regression coverage for behavior changes and verify systemd changes on Linux.

## Commits and Pull Requests

Use imperative commit subjects. Recent history uses scoped prefixes such as `feat(deployments):`. Keep each subject focused. In pull requests, summarize the change and verification, link relevant issues, flag schema or configuration changes, and include screenshots for visible UI changes.

## Local Configuration

Use `.env.local` for local development and `.env` for Compose. Keep credentials and private keys out of Git. See [controller and agent setup](apps/controller/README.md) for database, TLS, and deployment instructions.
