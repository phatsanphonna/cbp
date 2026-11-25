#!/usr/bin/env python3
"""Run CBP certificate jobs for inventory hosts tagged with CBP endpoint vars."""

import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import UUID


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def post(opener, url, token, **body):
    request = Request(url, json.dumps(body).encode(), {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    with opener.open(request, timeout=10) as response:
        return None if response.status == 204 else json.load(response)


def deploy(inventory, alias, endpoint, job, report_log):
    address = urlsplit(f"//{endpoint}")
    chain = job["fullchain"]
    first_cert = chain.split("-----END CERTIFICATE-----", 1)[0] + "-----END CERTIFICATE-----"
    fingerprint = hashlib.sha256(ssl.PEM_cert_to_DER_cert(first_cert)).hexdigest()
    with tempfile.TemporaryDirectory(prefix="cbp-ansible-") as directory:
        variables = Path(directory) / "job.json"
        values = {
            "cbp_inventory_host": alias,
            "cbp_fullchain": chain,
            "cbp_private_key": job["privateKey"],
            "cbp_server_name": address.hostname,
            "cbp_tls_port": address.port,
            "cbp_fingerprint": fingerprint,
            "ansible_ssh_common_args": "-o StrictHostKeyChecking=accept-new",
        }
        environment = {**os.environ, "ANSIBLE_HOST_KEY_CHECKING": "True"}
        environment.pop("CBP_ANSIBLE_TOKEN", None)
        if credentials := job.get("credentials"):
            environment["CBP_JOB_SSH_PASSWORD"] = credentials["sshPassword"]
            values.update({
                "ansible_user": credentials["sshUsername"],
                "ansible_password": "{{ lookup('ansible.builtin.env', 'CBP_JOB_SSH_PASSWORD') }}",
                "ansible_become": True,
                "ansible_become_method": credentials["becomeMethod"],
                "ansible_become_user": "root",
            })
            if credentials["becomeMethod"] == "su":
                environment["CBP_JOB_SU_PASSWORD"] = credentials["suPassword"]
                values["ansible_become_password"] = "{{ lookup('ansible.builtin.env', 'CBP_JOB_SU_PASSWORD') }}"
        variables.write_text(json.dumps(values), encoding="utf-8")
        variables.chmod(0o600)
        playbook = Path(__file__).resolve().with_name("deploy-nginx.yml")
        command = ["ansible-playbook", "-i", str(inventory), "--limit", alias,
                   "--extra-vars", f"@{variables}", str(playbook)]
        with subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            start_new_session=True,
            cwd=inventory.parent,
            env=environment,
        ) as process:
            timed_out = threading.Event()

            def stop_after_timeout():
                timed_out.set()
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            timer = threading.Timer(180, stop_after_timeout)
            timer.start()
            try:
                for line in process.stdout:
                    line = re.sub(r"[\x00-\x1f\x7f]", " ", line.rstrip())
                    if line:
                        print(line, flush=True)
                        report_log(line.encode("utf-8")[:1024].decode("utf-8", "ignore"))
                return process.wait() == 0 and not timed_out.is_set()
            finally:
                timer.cancel()


def load_inventory(inventory):
    environment = os.environ.copy()
    environment.pop("CBP_ANSIBLE_TOKEN", None)
    result = subprocess.run(
        ["ansible-inventory", "--list", "-i", str(inventory)],
        cwd=inventory.parent,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    inventory_data = json.loads(result.stdout)
    hostvars = inventory_data.get("_meta", {}).get("hostvars", {})
    if not isinstance(hostvars, dict):
        raise ValueError("Ansible inventory did not return host variables.")
    return hostvars


def normalize_host(value):
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip().strip("[]").lower().rstrip(".")
    try:
        return ipaddress.ip_address(value).compressed
    except ValueError:
        return value


def resolve_targets(hostvars, targets):
    if not isinstance(targets, list):
        raise ValueError("CBP returned an invalid Ansible endpoint list.")
    resolved = []
    missing = []
    seen = set()
    for target in targets:
        host_id = target.get("hostId")
        endpoint = target.get("endpoint")
        if not isinstance(host_id, str) or str(UUID(host_id)) != host_id:
            raise ValueError("CBP returned an invalid Ansible host ID.")
        address = urlsplit(f"//{endpoint}") if isinstance(endpoint, str) else None
        try:
            valid_endpoint = (
                address and address.hostname and address.port
                and not address.username and not address.password
                and not address.path and not address.query and not address.fragment
            )
        except ValueError:
            valid_endpoint = False
        if not valid_endpoint:
            raise ValueError("CBP returned an invalid Ansible endpoint.")
        identity = (host_id, endpoint)
        if identity in seen:
            continue
        seen.add(identity)

        registered_hosts = {
            normalize_host(target.get(field))
            for field in ("hostName", "hostname", "fqdn", "lastPingAddress")
        } - {None}
        matches = []
        for alias, variables in hostvars.items():
            endpoint_override = variables.get("cbp_endpoint")
            if endpoint_override and endpoint_override != endpoint:
                continue
            inventory_hosts = {
                normalize_host(alias),
                normalize_host(variables.get("ansible_host")),
            } - {None}
            if registered_hosts & inventory_hosts:
                matches.append(alias)
        if len(matches) == 1:
            resolved.append({**target, "inventoryHost": matches[0]})
        elif len(matches) > 1:
            exact = [alias for alias in matches if hostvars[alias].get("cbp_endpoint") == endpoint]
            if len(exact) == 1:
                resolved.append({**target, "inventoryHost": exact[0]})
            else:
                missing.append((target.get("hostName") or host_id, endpoint, "multiple inventory hosts match"))
        else:
            missing.append((target.get("hostName") or host_id, endpoint, "no inventory host matches"))
    return resolved, missing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inventory", type=Path)
    parser.add_argument("--once", action="store_true", help="Poll each configured inventory endpoint once")
    args = parser.parse_args()
    origin = urlsplit(os.environ.get("CBP_ANSIBLE_WEB_URL", ""))
    token = os.environ.get("CBP_ANSIBLE_TOKEN", "")
    if not origin.hostname or origin.username or origin.password or origin.path not in ("", "/") or origin.query or origin.fragment:
        parser.error("Set CBP_ANSIBLE_WEB_URL to the CBP origin.")
    loopback = origin.hostname in ("localhost", "127.0.0.1", "::1")
    if origin.scheme != "https" and not (origin.scheme == "http" and loopback):
        parser.error("Use HTTPS for CBP_ANSIBLE_WEB_URL outside loopback development.")
    if not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", token) or not args.inventory.is_file():
        parser.error("Set CBP_ANSIBLE_TOKEN and supply an inventory file.")
    inventory = args.inventory.expanduser().resolve()
    if not inventory.is_file():
        parser.error("The Ansible inventory file does not exist.")
    try:
        inventory_hosts = load_inventory(inventory)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError, TypeError, ValueError) as error:
        parser.error(f"Could not load Ansible inventory: {error}")

    url = origin.geturl().rstrip("/") + "/api/internal/ansible"
    opener = build_opener(ProxyHandler({}), NoRedirects()) if loopback else build_opener(NoRedirects())
    reported_missing = set()
    while True:
        try:
            updated_inventory = load_inventory(inventory)
            if updated_inventory != inventory_hosts:
                inventory_hosts = updated_inventory
                print(f"Reloaded Ansible inventory ({len(inventory_hosts)} hosts).", flush=True)
        except (OSError, subprocess.SubprocessError, json.JSONDecodeError, TypeError, ValueError) as error:
            print(f"Could not reload Ansible inventory; keeping the last valid version ({type(error).__name__}).", file=sys.stderr, flush=True)
        try:
            targets, missing = resolve_targets(
                inventory_hosts,
                post(opener, url, token, operation="targets"),
            )
            for host, endpoint, reason in missing:
                issue = (host, endpoint, reason)
                if issue not in reported_missing:
                    print(f"Skipping Ansible endpoint {endpoint} for {host}: {reason}.", file=sys.stderr, flush=True)
                    reported_missing.add(issue)
        except (OSError, ValueError) as error:
            print(f"Could not list Ansible endpoints ({type(error).__name__}).", file=sys.stderr, flush=True)
            targets = []
        for target in targets:
            identity = {"hostId": target["hostId"], "endpoint": target["endpoint"]}
            try:
                job = post(opener, url, token, operation="claim", **identity)
            except (OSError, ValueError) as error:
                print(f"Could not claim a job for {target['endpoint']} ({getattr(error, 'code', type(error).__name__)}).", file=sys.stderr, flush=True)
                continue
            if not job:
                continue
            def report_log(message):
                try:
                    post(opener, url, token, operation="log", jobId=job["id"], message=message, **identity)
                except (OSError, ValueError):
                    pass

            report_log("Ansible runner claimed deployment")
            try:
                succeeded = deploy(inventory, target["inventoryHost"], target["endpoint"], job, report_log)
            except (OSError, ValueError):
                succeeded = False
            report_log("Deployment succeeded" if succeeded else "Deployment failed")
            print(f"Job {job['id']} {'deployed' if succeeded else 'failed'}.", flush=True)
            for attempt in range(3):
                try:
                    post(opener, url, token, operation="finish", jobId=job["id"], succeeded=succeeded, **identity)
                    break
                except (OSError, ValueError) as error:
                    if attempt == 2 or 400 <= getattr(error, "code", 500) < 500:
                        print(f"Could not report job {job['id']} ({getattr(error, 'code', type(error).__name__)}).", file=sys.stderr, flush=True)
                        break
                    time.sleep(2)
        if args.once:
            return
        time.sleep(5)


if __name__ == "__main__":
    main()
