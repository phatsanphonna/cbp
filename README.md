# CBP

CBP is a web application for managing TLS certificates and deploying them to Linux hosts. It tracks certificates, expiration dates, host check-ins, deployment results, and audit events. Administrators can enroll hosts and deploy certificates from the web interface.

## Deploy with Docker Compose

The Compose stack runs the Bun web app, Go controller, and PostgreSQL. Use a Linux host with Docker Engine, Docker Compose, Bash, and OpenSSL. Choose direct HTTPS if the web container will serve TLS, or use a reverse proxy to serve HTTPS in front of the container.

If the Docker host reaches the internet through an HTTP proxy, set `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` in `.env` or your shell. Compose passes them to the image builds for Go, Bun, pip, and apt downloads, and the web app uses them for outbound requests.

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

## Vault deployment secrets

CBP can store temporary deployment private keys and Ansible credentials in a Vault KV v2 engine mounted at `cbp`. Compose includes an optional single-node HashiCorp Vault service. It stores data in the `cbp-vault` volume, binds its API to loopback in the web container's network namespace, and is started with the `vault` profile.

Vault is optional. Without it, deployments still work and hold each private key in web memory until a worker claims it. Saved credentials need Vault: the **Ansible credentials** page, host credential bindings, and saved certificate keys. Set `CBP_VAULT_ADDR` and `CBP_VAULT_TOKEN` together or not at all.

The commands below use the base Compose file. With direct HTTPS, add `-f compose.yaml -f compose.https.yaml` to each one. Keep `--profile vault` on every later `up`, `ps`, and `logs`, or Compose leaves Vault out.

Start Vault and initialize it once:

```sh
docker compose --profile vault up -d --build vault
docker compose --profile vault exec vault vault operator init
```

Save the five unseal keys and initial root token somewhere secure and offline. Run the following command three times, entering a different unseal key each time. Vault starts sealed again after a restart, so repeat this unseal step then.

```sh
docker compose --profile vault exec vault vault operator unseal
```

Log in with the initial root token when prompted, enable KV v2, install the scoped CBP policy, and create an expiring app token:

```sh
docker compose --profile vault exec vault vault login
docker compose --profile vault exec vault vault secrets enable -path=cbp kv-v2
docker compose --profile vault exec vault vault policy write cbp /vault/policies/cbp.hcl
docker compose --profile vault exec vault vault token create -orphan -policy=cbp -ttl=720h
```

Copy the generated service token into `.env` and start the full stack. Keep the token out of Git and rotate it monthly before it expires.

```dotenv
CBP_VAULT_ADDR=http://127.0.0.1:8200
CBP_VAULT_TOKEN=<generated-service-token>
```

```sh
docker compose --profile vault up -d --build
```

For an externally managed Vault, set its HTTPS API URL and a token with the policy below. Set both values in `.env.local` for local development or `.env` for Compose. When neither value is set, temporary deployment credentials remain in memory as before. If only one is set, deployments cannot be submitted. The Compose Vault service is a single node; protect its unseal keys, back up the `cbp-vault` volume, and unseal it after restarts.

Create a dedicated Vault policy for the app token:

```hcl
path "cbp/data/deployments/*" {
  capabilities = ["create", "read", "update"]
}
path "cbp/metadata/deployments" {
  capabilities = ["list"]
}
path "cbp/metadata/deployments/*" {
  capabilities = ["read", "delete"]
}
path "cbp/data/credentials/*" {
  capabilities = ["create", "read", "update"]
}
path "cbp/metadata/credentials/*" {
  capabilities = ["create", "read", "update", "delete"]
}
path "cbp/metadata/credentials/ansible-profile" {
  capabilities = ["list"]
}
```

The Compose image installs this policy from `vault/cbp-policy.hcl`.

If Vault logs `open /vault/config/cbp.hcl: permission denied`, the image was built from a checkout whose files are readable only by root, such as one cloned with `umask 077`. Rebuild from a Dockerfile that copies the files with `--chmod`, or run `chmod 0644 vault/*.hcl` and rebuild with `docker compose --profile vault up -d --build vault`.

The web app removes temporary credentials when a worker claims a job or an administrator cancels it. It also cleans up temporary entries older than one hour, including entries left by interrupted requests. Administrators can save a private key and shared Ansible credentials per certificate, or create named Ansible credentials and bind them to hosts. Bound host credentials are used for deployments unless a host-specific override is supplied. Saved credentials retain one Vault version. Saved keys are checked against the current certificate before use. Unbind host credentials before deleting them or their hosts, and delete saved certificate credentials before removing a certificate. Vault must remain available and unsealed for cleanup and deployments. Job expiration remains ten minutes, and this integration does not add approvals or staged rollouts. The bundled Compose service shares the web container's network namespace, so `http://127.0.0.1:8200` reaches Vault from the app. Use an HTTPS API address for Vault outside Compose. Protect the token and replace it before it expires.

## Alert notifications

As an administrator, open **Alerts → Notification channels** to add, edit, pause, or remove destinations for Slack, LINE, Telegram, Resend email, HTTPS webhooks, Microsoft Teams, or Discord. Enter the provider credentials or webhook URL in the form. For Teams, use an incoming webhook URL from a Teams Workflows workflow configured to post to the destination channel. **Docs → Alert** has provider instructions.

CBP encrypts saved credentials using a key derived from the existing `BETTER_AUTH_SECRET`. If that secret changes, remove and recreate affected channels with their credentials.

An enabled channel receives matching open alerts, including ones already open when the channel is enabled. CBP records one successful delivery per alert, severity, and channel, and retries failed deliveries up to five attempts in total, five minutes apart. Webhook receivers get a JSON payload with `event`, `alertId`, `severity`, `message`, and `target` and can use the `Idempotency-Key` header to deduplicate retries.

For an existing local database, run `bun --filter @cbp/database db:setup-controller` with the database owner connection before restarting the web app. Compose applies the schema through its database setup service.

## Users, groups, and permissions

Emails in `CBP_ADMIN_EMAILS` remain full-access administrators. The **Sudo** permission also grants full administrator access and can be assigned directly to a user or through a group. Users with permission management access can assign individual permissions under **Users**; group permissions are managed under **Groups** and combine with direct user permissions. Existing deployments apply the access-control tables and role grants when `db:setup-controller` runs.

### Asset owners

Certificates, hosts, and Ansible credentials can have any mix of users and groups as owners. An asset with no owners is visible to every signed-in user. Once it has owners, only those users, members of those groups, and administrators (`CBP_ADMIN_EMAILS` or **Sudo**) can see or change it. Everyone else gets a 404 on its page, and it is left out of lists, the overview, alerts, and deployment history. Deployments, runs, and alerts follow the certificate or host they belong to.

The user who registers a certificate or host, or creates an Ansible credential, becomes its first owner. Change owners in the **Owners** section of a certificate or host page, or with **Owners** on the Ansible credentials page. Select **×** on a badge to remove that owner. This needs the asset's manage permission (**Manage certificates**, **Manage hosts**, or **Manage credentials**). Without **Sudo**, you must keep yourself or one of your groups as an owner, or remove every owner. Removing every owner, or deleting the last owning user or group, makes the asset visible to everyone again.

Ownership only limits access to these assets. Notification channels and the audit log keep their own permissions, and channels that receive all alerts still get alerts for owned assets.

## Let’s Encrypt renewals

Set `CBP_LETS_ENCRYPT_EMAIL` in `.env` for Compose or `.env.local` for local development. By setting it, you agree to the [Let’s Encrypt Subscriber Agreement](https://letsencrypt.org/repository/). Existing installations need the database setup command above.

In **Certificates → Register certificate**, choose **Create with Let’s Encrypt** and enter one DNS hostname per line. CBP registers the certificate and enables automatic renewal after issuance. For an existing Let’s Encrypt certificate, open its certificate page to enable renewal or renew it immediately.

Choose **Create self-signed** to make a one-year certificate for internal DNS names, IP addresses, or DNS wildcards. Download the private key after creation, or save it to Vault if you have credential-management access. Enabling automatic renewal or saving the key to Vault also keeps an encrypted copy in the database so CBP can renew it.

Each DNS name on the certificate must allow public HTTP on port 80. Configure the reverse proxy or web server for each name to forward `/.well-known/acme-challenge/*` to the CLM web app without authentication or rewriting that path. HTTP-01 supports regular DNS names. Wildcards and IP addresses are ineligible. Allow enough time for domain validation on the proxy’s certificate registration requests.

CBP starts automatic renewal after two-thirds of the current certificate’s lifetime and retries failures hourly. Renewals save the new chain in the same certificate record and rotate the private key. CBP encrypts keys using `BETTER_AUTH_SECRET` and saves renewed keys to Vault when it is configured. The previous chain and its matching key are retained encrypted for fallback. Keep that secret stable across restarts. Manual self-signed renewal offers the rotated key for download in its dialog. Renewals mark linked deployments pending; deploy the updated certificate from its certificate page.

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

`db:push` creates the schema in an empty database. To apply schema changes to an existing database, run `bun --filter @cbp/database db:setup-controller` instead. It only creates missing tables, indexes, and grants.

```sh
docker compose --env-file .cbp-dev/.env -f compose.dev.yaml up --wait
bun install --frozen-lockfile
bun --filter @cbp/database db:push
bun run --filter web dev --host 127.0.0.1 --strictPort
```

Open `http://127.0.0.1:5173`. To create a local account, set `CBP_USER_NAME`, `CBP_USER_EMAIL`, `CBP_USER_USERNAME`, and `CBP_USER_PASSWORD` in your shell environment, then run `bun run --filter web auth:create-user`. Use the same email you set in `CBP_ADMIN_EMAILS`.

To develop with the controller, install Go 1.27.4, follow the [controller setup](apps/controller/README.md#connect-to-the-web-app), configure its TLS files, and use `bun run dev`. It starts the web app, the controller when its TLS files exist, and on Windows the [Ansible runner](scripts/ansible/README.md#run-the-worker-directly) when its WSL files exist. Each piece is skipped cleanly when its setup is missing.

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
bun run --filter web check
bun run --filter web build
bun test apps/web/src/lib/server
go build ./apps/controller ./apps/agent
go test ./apps/agent/... ./apps/controller/... ./packages/agent-rpc/...
```

The database tests skip unless `CBP_TEST_DATABASE_URL` points at a disposable CBP database with the schema applied. Then run `bun test packages/database/src`. Never point it at a database you want to keep. Use the `cbp_web` login to check `deployment-security.test.ts` with runtime privileges.

The Bun production server is built into `apps/web/dist/`. Start it with `bun run --filter web start` after configuring the production environment.

## Repository layout

| Path                  | Purpose                                                    |
| --------------------- | ---------------------------------------------------------- |
| `apps/web/`           | SvelteKit routes, UI, and web API                          |
| `apps/controller/`    | Go controller that connects agents to the web app          |
| `apps/agent/`         | Go agent for Linux check-ins and certificate deployment    |
| `packages/agent-rpc/` | Shared gRPC contract                                       |
| `packages/database/`  | PostgreSQL schemas, queries, and the database setup script |
| `scripts/ansible/`    | Ansible worker and playbooks for Nginx hosts over SSH      |
| `vault/`              | Vault server configuration and the CBP policy for Compose  |

See [AGENTS.md](AGENTS.md) for contributor guidelines.
