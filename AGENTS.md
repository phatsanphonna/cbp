# Repository Guidelines

## Agent Working Style

Use Ponytail `ultra` mode by default for coding tasks in this repository. Before editing, question scope that the task does not justify. Make the smallest change that fully solves the request, and reuse existing code before adding abstractions or dependencies. Follow this guidance directly if the Ponytail skill is unavailable. Honor any mode the user explicitly requests for the current session.

## Following Project Guidelines

AI agents must treat this document as the repository's source of truth. Before making changes, read the applicable guidance and any more-specific instructions, inspect relevant existing code, and follow the established project structure, coding style, and UI conventions. Prefer existing patterns over introducing new ones. If the user's request explicitly conflicts with a guideline, follow the request and state the tradeoff.

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
