# CBP controller and agent

The Go agent opens an outbound gRPC connection over TLS. It enrolls once, then sends its hostname, operating system, architecture, and collection time. In connected mode, the controller forwards enrollment and reports to SvelteKit over HTTPS. SvelteKit stores the credentials and check-ins in PostgreSQL.

Run these commands from the repository root with Go 1.27.4 or later. On the first run, Go downloads the workspace dependencies.

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

In the web app, register a host with **Agent** or **Agent and Ansible** as the management method, or open an existing host. On its details page, select **Generate enrollment code** and copy the Linux command. Paste it in a Linux shell at the CBP repository root. **Last agent check-in** updates on the host page after a successful report. Agents previously enrolled with standalone files need a new invitation and credential file.

When the controller environment variables are unset, the controller uses the standalone local state described below.

## Start the controller

Provide a PEM certificate chain and matching private key. The certificate must cover the DNS name the agent uses. For a private CA, give the agent the CA certificate with `-ca`. With a publicly trusted certificate, the agent uses the system trust store.

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
go run ./apps/agent \
  -host "$host_id" \
  -controller cbp-controller.internal:50051 \
  -ca ./controller-ca.pem \
  -credential-file "./.agent-local/$host_id.token" \
  -once
unset CBP_AGENT_ENROLLMENT_CODE
```

Replace `cbp-controller.internal` with the controller's DNS name. Omit `-ca` if the controller uses a publicly trusted certificate. The controller should log an enrollment and a check-in. Run the agent without `-once` to send a report every minute. Subsequent runs use the credential file. Keep its directory private to the agent service account.

Select **Reset enrollment** on the host details page to revoke a connected agent. In standalone mode, stop the controller before running `go run ./apps/controller revoke -host HOST_ID`. If you enroll a replacement, issue a fresh invitation and use a new credential file.

## Verify

```powershell
go test ./apps/agent/... ./apps/controller/... ./packages/agent-rpc/...
```
