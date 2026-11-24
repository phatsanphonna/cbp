#!/usr/bin/env python3
"""Run CBP certificate jobs for explicitly configured inventory hosts."""

import argparse
import hashlib
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
        }
        environment = {**os.environ, "ANSIBLE_HOST_KEY_CHECKING": "True"}
        environment.pop("CBP_ANSIBLE_TOKEN", None)
        if credentials := job.get("credentials"):
            environment["CBP_JOB_SSH_PASSWORD"] = credentials["sshPassword"]
            environment["CBP_JOB_SU_PASSWORD"] = credentials["suPassword"]
            values.update({
                "ansible_password": "{{ lookup('ansible.builtin.env', 'CBP_JOB_SSH_PASSWORD') }}",
                "ansible_become_password": "{{ lookup('ansible.builtin.env', 'CBP_JOB_SU_PASSWORD') }}",
                "ansible_become_method": "su",
                "ansible_become_user": "root",
            })
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inventory", type=Path)
    parser.add_argument("targets", type=Path, help="JSON array of hostId, endpoint, and inventoryHost mappings")
    parser.add_argument("--once", action="store_true", help="Poll each configured target once")
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
    try:
        targets = json.loads(args.targets.read_text(encoding="utf-8"))
        if not isinstance(targets, list) or not targets:
            raise ValueError
        for target in targets:
            address = urlsplit(f"//{target['endpoint']}")
            if (str(UUID(target["hostId"])) != target["hostId"] or not address.hostname
                    or not address.port or address.username or address.password or address.path
                    or address.query or address.fragment
                    or not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]*", target["inventoryHost"])
                    or target["inventoryHost"] in ("all", "ungrouped")):
                raise ValueError
    except (OSError, KeyError, TypeError, ValueError):
        parser.error("Targets must map CBP host UUIDs and endpoints to individual inventory hosts.")

    url = origin.geturl().rstrip("/") + "/api/internal/ansible"
    opener = build_opener(ProxyHandler({}), NoRedirects()) if loopback else build_opener(NoRedirects())
    while True:
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
                succeeded = deploy(args.inventory.resolve(), target["inventoryHost"], target["endpoint"], job, report_log)
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
