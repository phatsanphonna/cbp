# CBP

CBP is a web application for managing TLS certificates and deploying them to Linux hosts. It tracks certificates, expiration dates, host check-ins, deployment results, and audit events. Administrators can enroll hosts and deploy certificates from the web interface.

## Deploy with Docker Compose

The Compose stack runs the Bun web app, Go controller, and PostgreSQL. Use a Linux host with Docker Engine, Docker Compose, Bash, and OpenSSL. For a fresh deployment, run the setup script from the repository root with the controller address your agents will use and the HTTPS URL your users will open.

```sh
bash scripts/setup-docker.sh cbp-controller.internal:50051 https://cbp.example.com
```

Replace both example addresses with your own. The script generates `.env` and prepares the controller TLS files. Set `CBP_ADMIN_EMAILS` in `.env`. For remote agents, set `CBP_CONTROLLER_BIND` to the Docker host's agent-facing IP address, then build and start the stack.

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps --all
```

Follow the [Docker deployment guide](apps/controller/README.md#run-with-docker-compose) to configure the HTTPS reverse proxy, create the first administrator, and verify enrollment and certificate delivery. If you already run CBP, follow the [upgrade and backup steps](apps/controller/README.md#upgrade-an-existing-deployment) before recreating containers.

## Develop locally

Use Bun 1.4.5 and Docker Compose. The development Compose project runs PostgreSQL on `127.0.0.1:5433` with its own named volume. Run Vite on the host for hot reload.

Set `CBP_DEV_POSTGRES_PASSWORD` in `.cbp-dev/.env` to a random URL-safe password. Create a root `.env.local` with these settings, using the same database password and your administrator email.

```dotenv
DATABASE_URL=postgresql://cbp:<database-password>@127.0.0.1:5433/cbp
BETTER_AUTH_URL=http://127.0.0.1:5173
BETTER_AUTH_SECRET=<random-secret-of-at-least-32-characters>
CBP_ADMIN_EMAILS=admin@example.com
```

If you already have a development database, point `DATABASE_URL` at it and skip the Compose command. Keep both environment files, credentials, and private keys out of Git.

```sh
docker compose --env-file .cbp-dev/.env -f compose.dev.yaml up --wait
bun install --frozen-lockfile
bun --filter @cbp/database db:push
bun run --filter web dev --host 127.0.0.1 --strictPort
```

Open `http://127.0.0.1:5173`. To create a local account, set `CBP_USER_NAME`, `CBP_USER_EMAIL`, `CBP_USER_USERNAME`, and `CBP_USER_PASSWORD` in your shell environment, then run `bun run --filter web auth:create-user`. Use the same email you set in `CBP_ADMIN_EMAILS`.

To develop with the controller, install Go 1.27.4, follow the [controller setup](apps/controller/README.md#connect-to-the-web-app), configure its TLS files, and use `bun run dev` to start both services.

To stop PostgreSQL and keep its data, run `docker compose --env-file .cbp-dev/.env -f compose.dev.yaml down`.

## Build and test

```sh
bun run --filter web build
bun test apps/web/src/lib/server
go build ./apps/controller ./apps/agent
go test ./apps/agent/... ./apps/controller/... ./packages/agent-rpc/...
```

For database security integration tests, point `CBP_TEST_DATABASE_URL` at a disposable CBP database with the schema applied and run `bun test packages/database/src/deployment-security.test.ts`. Use the `cbp_web` login to verify the tests with runtime privileges.

The Bun production server is built into `apps/web/dist/`. Start it with `bun run --filter web start` after configuring the production environment.

## Repository layout

| Path                  | Purpose                                                 |
| --------------------- | ------------------------------------------------------- |
| `apps/web/`           | SvelteKit routes, UI, and web API                       |
| `apps/controller/`    | Go controller that connects agents to the web app       |
| `apps/agent/`         | Go agent for Linux check-ins and certificate deployment |
| `packages/agent-rpc/` | Shared gRPC contract                                    |
| `packages/database/`  | PostgreSQL schemas and queries                          |

See [AGENTS.md](AGENTS.md) for contributor guidelines.
