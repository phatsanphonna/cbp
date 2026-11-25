# Deploy Nginx certificates via Ansible

CBP queues the uploaded certificate and holds the private key in web process memory until the runner claims it. Run the worker on a Linux machine or in WSL for development. The runner needs Python 3, `ansible-playbook`, and a verified SSH host key. For unattended use, configure SSH key authentication and a user that can run the playbook with sudo without a prompt. Keep all deployment requests on a single web instance.

For each deployment, CBP asks for the SSH username and password, then the become method (`sudo` or `su`). It asks for the root `su` password only when `su` is selected. These job credentials override `ansible_user` and related connection settings from the inventory for that run.

For a host without an enrolled CBP agent, the runner collects its hostname, fully qualified hostname, operating system, and architecture over SSH before changing any certificate files. It sends the report to CBP first. If inventory collection fails, the runner logs the failure and still attempts the deployment.

After successful TLS verification, the runner reports the expiry of the certificate Nginx served. CBP shows that expiry and the time it was observed on the host and certificate pages.

1. Apply the database changes. For local development, use the database owner connection and run `bun --filter @cbp/database db:push` followed by `bun --filter @cbp/database db:setup-controller`. The Compose setup job applies these changes on upgrade.
2. Set a separate `CBP_ANSIBLE_TOKEN` in the web environment, then restart the web app. Generate a fresh Ansible token with `openssl rand -hex 32`.
3. In CBP, register the target as an Ansible-managed host. Link the certificate to that host with method **Ansible**, service **Nginx**, and the TLS hostname and port served by Nginx.

Create `inventory.yml` in the runner's Linux home directory. The runner fetches registered Ansible endpoints from CBP and matches each target to an inventory host using the inventory alias or `ansible_host` against the host name, hostname, FQDN, or last reported address in CBP. It reloads the inventory every five seconds, so edits and newly added hosts are picked up without restarting the runner. You still need to add each host's SSH connection details and Nginx file paths; CBP cannot infer those safely. The playbook creates missing parent directories and supports first installs where the certificate or key files do not exist yet. Inventory does not need CBP IDs or endpoints. Use a separate alias when endpoints on one machine need different certificate files. The playbook installs the chain as root mode 0644 and the key as root mode 0600.

```yaml
all:
  hosts:
    nginx_lab:
      ansible_host: 10.164.160.51
      ansible_user: fcpo
      cbp_nginx_certificate: /etc/nginx/tls/lab.fullchain.pem
      cbp_nginx_key: /etc/nginx/tls/lab.key
      # Set this absolute path on the target for certificates issued by a private CA.
      # cbp_tls_ca_file: /etc/nginx/tls/lab-ca.pem
      # cbp_tls_address defaults to 127.0.0.1 on the target.
```

If an inventory alias matches more than one registered CBP host, set `cbp_endpoint` on that alias to the exact endpoint to disambiguate it. This is only needed for ambiguous inventories.

On Windows, `bun dev` starts the runner in the `Ubuntu` WSL distro when these defaults exist: `~/.config/cbp/ansible-runner.env` and `~/ansible-lab/inventory.yml`. Set `CBP_ANSIBLE_WSL_DISTRO` to use another distro. You can set `CBP_ANSIBLE_INVENTORY` in the runner environment file to use a different path. The runner launched by `bun dev` stops with it. It skips cleanly when the WSL distro or runner files are missing, and it will not start a duplicate runner.

To start the runner manually in a Linux shell, use your HTTPS CBP origin for a remote web app. The example uses loopback for local development.

```bash
export CBP_ANSIBLE_WEB_URL=http://127.0.0.1:5173
read -rsp 'CBP Ansible token: ' CBP_ANSIBLE_TOKEN
printf '\n'
export CBP_ANSIBLE_TOKEN
python3 scripts/ansible/runner.py ~/ansible-lab/inventory.yml
```

For password authentication, install `sshpass` on the runner and enter both the SSH password and the root `su` password in CBP's **Deploy** dialog. The runner automatically accepts and saves a host's first SSH key; changed host keys are still rejected. The runner uses these credentials for jobs in that submission. Select hosts that use the same credentials, or submit separate deployments.

Select **Deploy** on the certificate page. Choose **Ansible** if the dialog offers a choice, select the hosts, and provide the matching private key. CBP displays progress on the deployment page. The playbook validates Nginx, reloads it after changes, and checks that the local TLS listener serves the expected certificate with a trusted chain and matching hostname. If validation or verification fails after installation starts, the playbook attempts to restore and reload the previous pair. If rollback cannot complete, inspect Nginx and the root-only `cbp-nginx-*` backup directory under the target's temporary directory.
