# CBP controller and agent

The Go agent opens an outbound gRPC connection over TLS. It enrolls once, then sends its hostname, operating system, architecture, and collection time. In connected mode, the controller forwards enrollment and reports to SvelteKit over HTTPS. SvelteKit stores the credentials and check-ins in PostgreSQL.

Run the controller and test commands from the repository root with Go 1.27.4 or later. On the Linux agent host, install `cbp-agent` in a root-owned directory such as `/usr/local/bin`. The binary and every parent directory must be protected from writes by other users.

## Run with Docker Compose

Compose runs the Bun web app, Go controller, and PostgreSQL. Use a Linux server with Docker Engine, the Docker Compose plugin, Bash, and OpenSSL. Run the commands below from the repository root on that server. Install the agent separately on each Linux host that will receive certificates.

### 1. Configure the deployment

Choose the HTTPS URL browsers will use and the controller DNS name or IP address agents will use. Point both names at the appropriate endpoints. The web backend and the published controller port bind to loopback by default. For remote agents, set `CBP_CONTROLLER_BIND` in `.env` to the Docker host's agent-facing IP address and allow access to that port only from your agent networks. Apply the restriction at a network firewall or in Docker's forwarding firewall rules. With a reverse proxy on the Docker host, allow browser traffic on TCP 443.

For a fresh install, replace both example addresses and run:

```sh
bash scripts/setup-docker.sh cbp-controller.internal:50051 https://cbp.example.com
```

The script creates `.env` with deployment secrets and a proxy token. It reuses the default controller TLS files if they exist and generates a self-signed controller certificate if both are absent. To use existing files at other paths, set `CBP_CONTROLLER_TLS_CERT` and `CBP_CONTROLLER_TLS_KEY` before running the script. The controller certificate must cover the exact DNS name or IP address in the agent connection address.

Add `CBP_ADMIN_EMAILS=admin@example.com` to `.env` with your first administrator's email. This setting accepts a comma-separated list of emails. Other signed-in users have read-only access. After changing the list on a running deployment, apply it with `docker compose up -d`.

Omit the web origin for local testing at `http://127.0.0.1:3000`. If the container sees browser traffic from a non-loopback address, use HTTPS for local testing too.

#### Manual configuration

For manual setup, create a `.env` at the repository root with these settings:

```dotenv
POSTGRES_PASSWORD=<URL-safe random password>
CBP_DATABASE_WEB_PASSWORD=<independent URL-safe random password>
BETTER_AUTH_SECRET=<random secret of at least 32 characters>
BETTER_AUTH_URL=https://cbp.example.com
CBP_ADMIN_EMAILS=<email of the first administrator>
CBP_TRUSTED_PROXY_TOKEN=<43 to 128 character URL-safe token>
CBP_CONTROLLER_TOKEN=<43 to 128 character URL-safe token>
CBP_DEPLOYMENT_ENCRYPTION_KEY=<32 random bytes encoded as base64url>
CBP_AGENT_CONTROLLER_ADDRESS=cbp-controller.internal:50051
# CBP_CONTROLLER_BIND=192.0.2.10
# CBP_AGENT_CA_FILE=/etc/cbp/controller-ca.pem
# CBP_AGENT_CA_DOWNLOAD_FILE=./controller-ca.pem
```

Generate independent random secrets with `openssl rand -hex 32`. For the deployment encryption key, use `openssl rand -base64 32 | tr -- '+/' '-_' | tr -d '=\n'`. Protect the file with `chmod 600 .env`.

Put the controller certificate and key in `controller-fullchain.pem` and `controller.key` at the repository root, or set `CBP_CONTROLLER_TLS_CERT` and `CBP_CONTROLLER_TLS_KEY` to their host paths. If the agent-facing port differs from 50051, set `CBP_CONTROLLER_PORT` to the port in `CBP_AGENT_CONTROLLER_ADDRESS`. For a private CA, set `CBP_AGENT_CA_FILE` to the CA path on the agent hosts. Set `CBP_AGENT_CA_DOWNLOAD_FILE` to the public CA PEM on the Docker host and make it readable by the web container user to enable the download.

### 2. Build and start the services

For an existing deployment, [back up the database before upgrading](#upgrade-an-existing-deployment).

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps --all
docker compose logs --tail=50 db-setup web controller
```

Expect `db` to be healthy, `db-setup` to exit with code 0, and `web` and `controller` to stay running. The setup job applies the schema and provisions `cbp_web`, the restricted database login used by the web app. The database is stored in the `cbp-db` named volume.

### 3. Configure the HTTPS reverse proxy

Use a browser-trusted TLS certificate for `BETTER_AUTH_URL`. For Nginx running on the Docker host, create a site like the example below. Replace the domain and certificate paths, and copy the value of `CBP_TRUSTED_PROXY_TOKEN` from `.env` into the private Nginx configuration. Keep the three proxy header assignments so Nginx overwrites client-supplied values. This example assumes Nginx receives traffic directly from browsers.

```nginx
server {
    listen 80;
    server_name cbp.example.com;
    return 301 https://cbp.example.com$request_uri;
}

server {
    listen 443 ssl;
    server_name cbp.example.com;
    ssl_certificate /path/to/web-fullchain.pem;
    ssl_certificate_key /path/to/web-private.key;

    location ^~ /api/internal/controller/ {
        return 404;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-CBP-Proxy-Token "REPLACE_WITH_CBP_TRUSTED_PROXY_TOKEN";
        proxy_set_header X-CBP-Client-IP $remote_addr;
        proxy_buffering off;
    }
}
```

Test the Nginx configuration with `sudo nginx -t`, then reload it with `sudo systemctl reload nginx`. If another trusted proxy sits in front of Nginx, configure Nginx to resolve the real client IP from that trusted proxy before forwarding `X-CBP-Client-IP`. Agents connect directly to the controller's TLS port.

### 4. Create the first administrator

Run the following in Bash. Use the email you listed in `CBP_ADMIN_EMAILS`.

```bash
(
  set -e
  read -rp 'Name: ' CBP_USER_NAME
  read -rp 'Email: ' CBP_USER_EMAIL
  read -rp 'Username: ' CBP_USER_USERNAME
  read -rsp 'Password: ' CBP_USER_PASSWORD
  printf '\n'
  export CBP_USER_NAME CBP_USER_EMAIL CBP_USER_USERNAME CBP_USER_PASSWORD
  docker compose run --rm \
    -e CBP_USER_NAME -e CBP_USER_EMAIL -e CBP_USER_USERNAME -e CBP_USER_PASSWORD \
    web bun --filter web auth:create-user
)
```

Administrators can remove other accounts from **Users**. Removal ends that account's sessions. Signed-in users can use **Change password** in the sidebar to update their own password and end their other sessions.

### 5. Verify the deployment

1. Open your HTTPS URL and sign in. Confirm the app shows **Controller online**.
2. Register a test host and open **Agent enrollment**. Build or copy the [Linux agent binary](#connect-to-the-web-app), then follow the generated enrollment command. If you use a private CA or the generated self-signed controller certificate, use **Download controller CA** or copy the public PEM to the path specified by the command.
3. On the agent host, run `sudo systemctl status cbp-agent` and confirm the web app shows a fresh check-in. Deploy a test certificate to an allowed service and confirm the deployment succeeds. If the deployment fails, check its status in the app and run `sudo journalctl -u cbp-agent -n 50` on the host.

For a test certificate signed by a private CA, configure its trust root with the agent's `deploymentCAFile` setting and include any required intermediates in the uploaded full chain.

### Upgrade an existing deployment

Keep your existing `.env`, controller TLS files, and Compose project name. Back up the active PostgreSQL database before updating the checkout or recreating containers:

```sh
(umask 077; docker compose exec -T db pg_dump -U cbp -d cbp > "cbp-$(date +%F-%H%M%S).sql")
```

Keep a protected copy of `.env` with your backups. Its deployment encryption key is required to decrypt stored private keys. PostgreSQL 19 uses `/var/lib/postgresql/19/docker` inside the named volume mounted at `/var/lib/postgresql`. If the old container stored data in an anonymous volume or used a different PostgreSQL major version, restore the backup into the corrected volume or migrate the cluster with `pg_upgrade` before switching over. Keep the original volume until the restored data is verified.

After the backup, update the checkout to the version you intend to deploy. If `.env` has no `CBP_DATABASE_WEB_PASSWORD`, generate a new value with `openssl rand -hex 32` and add it while keeping the existing `POSTGRES_PASSWORD`. For remote agents, set `CBP_CONTROLLER_BIND` to the host's agent-facing IP before restarting. Repeat the build and startup commands and run the verification checks again.

### Run the web app outside Compose

For production outside Compose, run `bun --filter @cbp/database db:push` and `bun --filter @cbp/database db:setup-controller` with a `DATABASE_URL` that can manage the schema and create roles. Set an independent `CBP_DATABASE_WEB_PASSWORD` for setup to provision `cbp_web`. Start the web app with a `DATABASE_URL` that uses `cbp_web` and its password. Build with `bun run --filter web build` and start with `bun run --filter web start`. The Bun adapter writes its server to `apps/web/dist`.

## Connect to the web app

Generate a controller service token with `openssl rand -hex 32` or an equivalent secure random generator. Set `CBP_CONTROLLER_TOKEN` in the repository root's `.env.local`, then run `bun --filter @cbp/database db:setup-controller` against the existing CBP database and restart the web app. Use the same token in the controller's environment and point the controller at the web app's base URL.

```bash
export CBP_WEB_URL='https://cbp-web.internal'
read -rsp 'Controller service token: ' CBP_CONTROLLER_TOKEN
export CBP_CONTROLLER_TOKEN
printf '\n'
```

If the web server uses a private CA, set `CBP_WEB_CA_FILE` to its PEM CA certificate on the controller. Plain HTTP is accepted for loopback development. Keep the internal API behind your private network or reverse-proxy access rules. The controller sends the service token in the Authorization header on each request.

Set `CBP_AGENT_CONTROLLER_ADDRESS` in the web app's root `.env.local` to the controller's address as reached by the agents, such as `cbp-controller.internal:50051`. If the controller uses a private CA, set `CBP_AGENT_CA_FILE` to the CA PEM path on the Linux agent hosts. Restart the web app after saving.

To enable **Download controller CA** in Agent enrollment, set `CBP_AGENT_CA_DOWNLOAD_FILE` to the public CA PEM on the web host. Use an absolute path for local development. For Compose, set it to the host file in `.env`. Compose mounts that file read-only, and the web container user must be able to read it. The setup script fills in the path when it selects a trust certificate. Administrators can download the file over HTTPS or from a direct loopback connection.

Build the Linux binary from the repository root with `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o cbp-agent-linux ./apps/agent`. Use `GOARCH=arm64` for ARM64. Copy it to the target host, then run the generated enrollment command as root to install it if needed. To install it manually, use `install -D -T -o root -g root -m 0755 -- ./cbp-agent-linux /usr/local/bin/cbp-agent`.

In the web app, register a host or open an existing host. On its details page, select **Generate enrollment code**, then run the copied command as root on the Linux host where `cbp-agent` is installed. It enrolls the host, saves the credential at `/var/lib/cbp/agent.credential`, and enables and starts `cbp-agent.service` after the first check-in. Use `systemctl status cbp-agent` to check the service. Agents previously enrolled with standalone files need a new invitation and credential file.

When the controller environment variables are unset, the controller uses the standalone local state described below.

## Start the controller

Provide a PEM certificate chain and matching private key. The certificate must cover the DNS name the agent uses. For a private CA, give the agent the CA certificate with `--ca`. With a publicly trusted certificate, the agent uses the system trust store.

### Develop on Windows

Place `controller-fullchain.pem` and `controller.key` in the repository root, or set `CBP_CONTROLLER_TLS_CERT` and `CBP_CONTROLLER_TLS_KEY` in the root `.env.local` to point to the files. Run `bun dev` to start the web app and controller together, or `bun dev:controller` for the controller alone. The web app can start by itself while the default TLS files are absent.

The controller listens on `127.0.0.1:50051` by default. Set `CBP_CONTROLLER_LISTEN=0.0.0.0:50051` to accept connections from Linux hosts and set `CBP_AGENT_CONTROLLER_ADDRESS` to the Windows DNS name and port those hosts can reach. If `CBP_CONTROLLER_TOKEN` is set, the launcher uses `CBP_WEB_URL` or defaults to `BETTER_AUTH_URL` for the web connection.

The navbar shows **Controller online** after the web app receives a heartbeat. If heartbeats stop, **Controller offline** appears once the most recent heartbeat is more than 30 seconds old.

### Start on Linux

```bash
go run ./apps/controller serve \
  -listen 0.0.0.0:50051 \
  -tls-cert ./controller-fullchain.pem \
  -tls-key ./controller.key
```

For a remote agent, set `-listen` to the interface and port reachable by that host. Restrict access to the TLS private key to the controller and its operator.

In standalone mode, generate a code with `go run ./apps/controller invite -host web-01` before starting the controller. Use the same private `-state` directory for the server and the standalone administrative commands.

## Enroll and check in

For standalone testing, enter the host ID and code from the controller CLI on the Linux agent host. Transfer the code securely. It expires after 15 minutes and can be redeemed once.

```bash
read -rp 'Host UUID: ' host_id
read -rsp 'Enrollment code: ' CBP_AGENT_ENROLLMENT_CODE
printf '\n'
export CBP_AGENT_ENROLLMENT_CODE
cbp-agent \
  --host "$host_id" \
  --controller cbp-controller.internal:50051 \
  --ca ./controller-ca.pem \
  --credential-file "./.agent-local/$host_id.token" \
  --once
unset CBP_AGENT_ENROLLMENT_CODE
```

Replace `cbp-controller.internal` with the controller's DNS name. Omit `--ca` if the controller uses a publicly trusted certificate. The controller should log an enrollment and a check-in. Run the agent without `--once` to send a report every minute. Subsequent runs use the credential file. Keep its directory private to the agent service account. Run `cbp-agent --help` for the available flags.

For an existing enrollment on a Linux host running systemd, use `cbp-agent --install-service` as root with the existing settings in the agent YAML or supplied as flags. The service starts after a successful check-in and starts again at boot. Existing systemd units with single-dash flags continue to work.

On Linux, the root agent appends Logrus output to `/var/log/cbp/agent.log`. Other runs default to `agent.log` next to the credential. Set `--log-file` or `logFile` in the agent YAML to change the path. Follow a root agent with `sudo tail -f /var/log/cbp/agent.log` or `journalctl -u cbp-agent -f`.

Use `cbp-agent register --config /etc/cbp/cbp.yaml` with a fresh `CBP_AGENT_ENROLLMENT_CODE` to enroll and check in once. Add `--install-service` to start the systemd service. If the YAML does not contain the connection settings, pass `--host`, `--controller`, `--credential-file`, and `--ca` as in the enrollment command.

For a host registered by IP address in CBP, enrollment requires the source IP seen by the controller to match. A mismatch leaves the enrollment code usable. Use a direct connection for IP-registered hosts behind NAT or a TCP proxy, or register the host under its DNS name when its source address can differ. This check uses the web inventory and applies to new enrollments.

To retire the agent, run `sudo cbp-agent uninstall` to stop and remove its managed systemd unit. Then run `sudo cbp-agent unregister --config /etc/cbp/cbp.yaml` or pass the same connection flags. Unregister requires the updated controller and web app. It revokes the enrollment and clears the local credential after confirmation, while keeping the host record, certificates, and log.

For root agents, keep the YAML, CA bundles, custom certificate paths, and HAProxy configuration in root-owned paths protected from writes by other users. Use regular files and directories for these paths. Keep the credential file readable only by root. The agent validates deployed certificates against system roots by default. Set `deploymentCAFile` in the agent YAML to add a protected PEM bundle of private trust roots, and include the required intermediates in each certificate upload. The `ca` setting remains the trust bundle for the controller connection.

Select **Reset enrollment** on the host details page to revoke a connected agent. In standalone mode, stop the controller before running `go run ./apps/controller revoke -host HOST_ID`. If you enroll a replacement, issue a fresh invitation and use a new credential file.

## Verify

```powershell
go test ./apps/agent/... ./apps/controller/... ./packages/agent-rpc/...
```
