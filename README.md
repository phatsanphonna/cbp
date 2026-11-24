# CBP

CBP is a web application for managing TLS certificates and deploying them to Linux hosts. It tracks certificates, expiration dates, host check-ins, deployment results, and audit events. Administrators can enroll hosts and deploy certificates from the web interface.

## Deploy with Docker Compose and direct HTTPS

The Compose stack runs the Bun web app, Go controller, and PostgreSQL. This setup serves browser traffic over HTTPS directly from the web container. Use a Linux host with Docker Engine, Docker Compose, Bash, and OpenSSL.

For a fresh deployment, run the setup script from the repository root. Replace the example controller address and browser URL with yours.

```sh
bash scripts/setup-docker.sh cbp-controller.internal:50051 https://192.0.2.10:3000
```

Set these values in `.env` for your browser-facing IP and TLS files. The certificate must be trusted by your browser and cover the URL's IP address or hostname. The web container's `bun` user needs read access to the private key. [Direct HTTPS setup](apps/controller/README.md#direct-https-with-compose)

```dotenv
BETTER_AUTH_URL=https://192.0.2.10:3000
CBP_WEB_BIND=192.0.2.10
CBP_WEB_PORT=3000
CBP_WEB_TLS_CERT=./web-fullchain.pem
CBP_WEB_TLS_KEY=./web.key
CBP_ADMIN_EMAILS=admin@example.com
```

For remote agents, set `CBP_CONTROLLER_BIND` to the Docker host's agent-facing IP address. Use both Compose files to start or upgrade the direct HTTPS deployment.

```sh
docker compose -f compose.yaml -f compose.https.yaml config --quiet
docker compose -f compose.yaml -f compose.https.yaml up -d --build
docker compose -f compose.yaml -f compose.https.yaml ps --all
```

Create the first administrator, then open `BETTER_AUTH_URL` and verify enrollment and certificate delivery. [Docker deployment guide](apps/controller/README.md#4-create-the-first-administrator)

If you already run CBP, back up the database before recreating containers. For deployments that terminate TLS at a reverse proxy, use the proxy setup in the guide. [Upgrade and backup steps](apps/controller/README.md#upgrade-an-existing-deployment) · [HTTPS reverse proxy](apps/controller/README.md#https-reverse-proxy)

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
