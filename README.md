# CBP

CBP is a web application for managing TLS certificates and deploying them to Linux hosts. It tracks certificates, expiration dates, host check-ins, deployment results, and audit events. Administrators can enroll hosts and deploy certificates from the web interface.

## Deploy with Docker Compose

The Compose stack runs the Bun web app, Go controller, and PostgreSQL. Use a Linux host with Docker Engine, Docker Compose, Bash, and OpenSSL. Choose direct HTTPS if the web container will serve TLS, or use a reverse proxy to serve HTTPS in front of the container.

For an existing deployment, keep your `.env` and controller TLS files and back up the database before upgrading. For remote agents, set `CBP_CONTROLLER_BIND` in `.env` to the Docker host's agent-facing IP address in either setup. [Upgrade and backup steps](apps/controller/README.md#upgrade-an-existing-deployment)

### Direct HTTPS

For a fresh deployment, run the setup script from the repository root. Replace the example controller address and browser URL with yours.

```sh
bash setup-docker.sh cbp-controller.internal:50051 https://192.0.2.10:3000
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

Use both Compose files to start or upgrade the deployment.

```sh
docker compose -f compose.yaml -f compose.https.yaml config --quiet
docker compose -f compose.yaml -f compose.https.yaml up -d --build
docker compose -f compose.yaml -f compose.https.yaml ps --all
```

### HTTPS through a reverse proxy

For a fresh deployment, pass your public HTTPS URL to the setup script. The script generates `CBP_TRUSTED_PROXY_TOKEN` in `.env`.

```sh
bash setup-docker.sh cbp-controller.internal:50051 https://cbp.example.com
```

Set `CBP_ADMIN_EMAILS` in `.env` to your first administrator's email. Keep `BETTER_AUTH_URL` set to the public HTTPS URL and leave `CBP_WEB_BIND` at `127.0.0.1` for a reverse proxy running on the Docker host. Start the stack with the base Compose file.

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps --all
```

Configure the proxy with a browser-trusted certificate and forward requests to `http://127.0.0.1:3000`. Have the proxy set `X-Forwarded-Proto` to `https`, `X-CBP-Client-IP` to the client IP, and `X-CBP-Proxy-Token` to the value from `.env`. [Nginx configuration example](apps/controller/README.md#https-reverse-proxy)

### Local HTTP testing

For a fresh local test, run `bash setup-docker.sh localhost:50051` to use `http://127.0.0.1:3000`. Set `CBP_ADMIN_EMAILS` in `.env`, use the base Compose commands above, and keep the web port bound to loopback. HTTP requires the app to see a loopback peer. If Docker presents the connection as coming from a bridge address, use either HTTPS setup above. [Compose configuration guide](apps/controller/README.md#1-configure-the-deployment)

### After startup

Create the first administrator, then open `BETTER_AUTH_URL` and verify enrollment and certificate delivery. [Docker deployment guide](apps/controller/README.md#4-create-the-first-administrator)

Enable the optional `ansible` profile to run the Ansible worker alongside the controller in its own container. [Ansible container setup](scripts/ansible/README.md#run-the-ansible-worker-in-docker)

## Alert notifications

As an administrator, open **Alerts → Notification channels** to add, edit, pause, or remove destinations for Slack, LINE, Telegram, Resend email, HTTPS webhooks, Microsoft Teams, or Discord. Enter the provider credentials or webhook URL in the form. For Teams, use an incoming webhook URL from a Teams Workflows workflow configured to post to the destination channel. **Docs → Alert** has provider instructions.

CBP encrypts saved credentials using a key derived from the existing `BETTER_AUTH_SECRET`. If that secret changes, remove and recreate affected channels with their credentials.

For an existing local database, run `bun --filter @cbp/database db:setup-controller` with the database owner connection before restarting the web app. Compose applies the schema through its database setup service.

An enabled channel receives matching open alerts, including ones already open when the channel is enabled. CBP records one successful delivery per alert, severity, and channel, and retries failed deliveries up to five attempts in total, five minutes apart. Webhook receivers get a JSON payload with `event`, `alertId`, `severity`, `message`, and `target` and can use the `Idempotency-Key` header to deduplicate retries.

## Let’s Encrypt renewals

Set `CBP_LETS_ENCRYPT_EMAIL` in `.env` for Compose or `.env.local` for local development. By setting it, you agree to the [Let’s Encrypt Subscriber Agreement](https://letsencrypt.org/repository/). Existing installations need the database setup command above.

In **Certificates → Register certificate**, choose **Create with Let’s Encrypt** and enter one DNS hostname per line. CLM registers the new certificate and enables automatic renewal after issuance. For an existing Let’s Encrypt certificate, upload the fullchain and enable it in **Renewals**.

Each DNS name on the certificate must allow public HTTP on port 80. Configure the reverse proxy or web server for each name to forward `/.well-known/acme-challenge/*` to the CLM web app without authentication or rewriting that path. HTTP-01 supports regular DNS names. Wildcards and IP addresses are ineligible. Allow enough time for domain validation on the proxy’s certificate registration requests.

CLM starts trying after two-thirds of the current certificate’s lifetime and retries failures hourly. It saves the renewed chain in the same certificate record and encrypts the matching key using `BETTER_AUTH_SECRET`. Keep that secret stable across restarts. To install the renewed certificate, open the certificate’s **Deploy** dialog and choose the target hosts. Leave the private-key fields blank to use the stored key.

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

### Linux agent downloads

Open `/agent/download` or select **Download Linux agent** in the **Agent enrollment** panel before enrolling a host. Choose **Linux (x86-64)** for `uname -m` output `x86_64` or **Linux (ARM64)** for `aarch64`. The download page includes the install and enrollment steps. The Docker web image builds both binaries.

For Windows development, build the binaries from the repository root in PowerShell:

```powershell
New-Item -ItemType Directory -Force apps/web/.agent-downloads | Out-Null
$env:GOOS = 'linux'
$env:CGO_ENABLED = '0'
foreach ($arch in 'amd64', 'arm64') {
  $env:GOARCH = $arch
  go build -mod=readonly -trimpath -o "apps/web/.agent-downloads/cbp-agent-linux-$arch" ./apps/agent
}
Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED
```

For a custom binary directory, set `CBP_AGENT_DOWNLOAD_DIR` to its absolute path.

### Ansible deployments

Run the [Ansible deployment worker](scripts/ansible/README.md) for Nginx hosts managed through SSH.

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
