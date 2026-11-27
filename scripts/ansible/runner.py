#!/usr/bin/env python3
"""Run CBP certificate jobs for inventory hosts tagged with CBP endpoint vars."""

import argparse
import hashlib
import ipaddress
import json
import os
import re
import signal
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import UUID

shutdown_requested = threading.Event()
active_processes = set()
active_processes_lock = threading.Lock()
# Jobs expire 10 minutes after queueing, so run a few at once instead of one by one.
max_job_workers = 4


def signal_process_group(process, signal_number):
    if process.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal_number)
        elif signal_number == signal.SIGKILL:
            process.kill()
        else:
            process.terminate()
    except ProcessLookupError:
        pass


def request_shutdown(_signal_number, _frame):
    if shutdown_requested.is_set():
        return
    shutdown_requested.set()
    with active_processes_lock:
        processes = list(active_processes)
    for process in processes:
        if process.poll() is None:
            signal_process_group(process, signal.SIGTERM)
            force_stop = threading.Timer(5, signal_process_group, (process, signal.SIGKILL))
            force_stop.daemon = True
            force_stop.start()


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def post(opener, url, token, **body):
    request = Request(
        url,
        json.dumps(body).encode(),
        {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with opener.open(request, timeout=10) as response:
        return None if response.status == 204 else json.load(response)


def deploy(inventory, alias, endpoint, job, report_log, report_host):
    deployment_endpoint = urlsplit(f"//{endpoint}")
    chain = job["fullchain"]
    first_cert = chain.split("-----END CERTIFICATE-----", 1)[0] + "-----END CERTIFICATE-----"
    fingerprint = hashlib.sha256(ssl.PEM_cert_to_DER_cert(first_cert)).hexdigest()
    with tempfile.TemporaryDirectory(prefix="cbp-ansible-") as directory:
        variables_file = Path(directory) / "job.json"
        ansible_variables = {
            "cbp_inventory_host": alias,
            "ansible_ssh_common_args": "-o StrictHostKeyChecking=accept-new",
        }
        environment = {**os.environ, "ANSIBLE_HOST_KEY_CHECKING": "True"}
        environment.pop("CBP_ANSIBLE_TOKEN", None)
        if credentials := job.get("credentials"):
            environment["CBP_JOB_SSH_PASSWORD"] = credentials["sshPassword"]
            ansible_variables.update(
                {
                    "ansible_user": credentials["sshUsername"],
                    "ansible_password": (
                        "{{ lookup('ansible.builtin.env', 'CBP_JOB_SSH_PASSWORD') }}"
                    ),
                    "ansible_become": True,
                    "ansible_become_method": credentials["becomeMethod"],
                    "ansible_become_user": "root",
                }
            )
            if credentials["becomeMethod"] == "su":
                environment["CBP_JOB_SU_PASSWORD"] = credentials["suPassword"]
                ansible_variables["ansible_become_password"] = (
                    "{{ lookup('ansible.builtin.env', 'CBP_JOB_SU_PASSWORD') }}"
                )
        if job.get("collectHostFacts") is True:
            if not collect_host_facts(
                inventory,
                alias,
                variables_file,
                environment,
                ansible_variables,
                report_log,
                report_host,
            ):
                return False, None
        if shutdown_requested.is_set():
            return False, None
        ansible_variables.update(
            {
                "cbp_fullchain": chain,
                "cbp_private_key": job["privateKey"],
                "cbp_server_name": deployment_endpoint.hostname,
                "cbp_tls_port": deployment_endpoint.port,
                "cbp_fingerprint": fingerprint,
            }
        )
        variables_file.write_text(json.dumps(ansible_variables), encoding="utf-8")
        variables_file.chmod(0o600)
        served_certificate_expiry = None

        def record_deployment_log(message):
            nonlocal served_certificate_expiry
            if match := re.search(
                r"Served certificate expires at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)",
                message,
            ):
                served_certificate_expiry = match.group(1)
            report_log(message)

        environment["ANSIBLE_STDOUT_CALLBACK"] = "default"
        succeeded = run_playbook(
            inventory,
            alias,
            variables_file,
            environment,
            "deploy-nginx.yml",
            180,
            record_deployment_log,
        )
        return succeeded, served_certificate_expiry if succeeded else None


def collect_host_facts(
    inventory,
    alias,
    variables_file,
    environment,
    ansible_variables,
    report_log,
    report_host,
):
    report_log("Collecting inventory from the host before deployment")
    report_path = variables_file.with_name("host-report.json")
    try:
        variables_file.write_text(
            json.dumps(
                {
                    **ansible_variables,
                    "ansible_become": False,
                    "cbp_host_report_path": str(report_path),
                }
            ),
            encoding="utf-8",
        )
        variables_file.chmod(0o600)
        if run_playbook(
            inventory,
            alias,
            variables_file,
            environment,
            "collect-host.yml",
            45,
            report_log,
        ):
            host_report = json.loads(report_path.read_text(encoding="utf-8"))
            host_report["collectedAt"] = datetime.now(timezone.utc).isoformat(
                timespec="milliseconds"
            )
            report_host(host_report)
            report_log("Host inventory report sent to CBP")
            return True
    except (OSError, ValueError, TypeError) as error:
        if getattr(error, "code", None) == 404:
            report_log("Deployment stopped because the job is no longer active")
            return False
    if not shutdown_requested.is_set():
        report_log("Host inventory could not be updated. Continuing with deployment.")
    return not shutdown_requested.is_set()


def run_playbook(
    inventory,
    alias,
    variables_file,
    environment,
    playbook_name,
    timeout,
    report_log,
):
    playbook = Path(__file__).resolve().with_name(playbook_name)
    command = [
        "ansible-playbook",
        "-i",
        str(inventory),
        "--limit",
        alias,
        "--extra-vars",
        f"@{variables_file}",
        str(playbook),
    ]
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
        with active_processes_lock:
            active_processes.add(process)
        if shutdown_requested.is_set():
            signal_process_group(process, signal.SIGTERM)
        timed_out = threading.Event()

        def stop_after_timeout():
            timed_out.set()
            signal_process_group(process, signal.SIGKILL)

        timer = threading.Timer(timeout, stop_after_timeout)
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
            with active_processes_lock:
                active_processes.discard(process)


def load_inventory(inventory):
    environment = os.environ.copy()
    environment.pop("CBP_ANSIBLE_TOKEN", None)
    command = ["ansible-inventory", "--list", "-i", str(inventory)]
    with subprocess.Popen(
        command,
        cwd=inventory.parent,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    ) as process:
        with active_processes_lock:
            active_processes.add(process)
        if shutdown_requested.is_set():
            signal_process_group(process, signal.SIGTERM)
        try:
            stdout, stderr = process.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            signal_process_group(process, signal.SIGKILL)
            process.communicate()
            raise
        finally:
            with active_processes_lock:
                active_processes.discard(process)
    if process.returncode:
        raise subprocess.CalledProcessError(process.returncode, command, stdout, stderr)
    inventory_data = json.loads(stdout)
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
        endpoint_address = urlsplit(f"//{endpoint}") if isinstance(endpoint, str) else None
        try:
            valid_endpoint = (
                endpoint_address
                and endpoint_address.hostname
                and endpoint_address.port
                and not endpoint_address.username
                and not endpoint_address.password
                and not endpoint_address.path
                and not endpoint_address.query
                and not endpoint_address.fragment
            )
        except ValueError:
            valid_endpoint = False
        if not valid_endpoint:
            raise ValueError("CBP returned an invalid Ansible endpoint.")
        target_key = (host_id, endpoint)
        if target_key in seen:
            continue
        seen.add(target_key)

        registered_hosts = {
            normalize_host(target.get(field))
            for field in ("hostName", "hostname", "fqdn", "lastPingAddress")
        } - {None}
        matches = []
        for alias, host_variables in hostvars.items():
            endpoint_override = host_variables.get("cbp_endpoint")
            if endpoint_override and endpoint_override != endpoint:
                continue
            inventory_hosts = {
                normalize_host(alias),
                normalize_host(host_variables.get("ansible_host")),
            } - {None}
            if registered_hosts & inventory_hosts:
                matches.append(alias)
        if len(matches) == 1:
            resolved.append({**target, "inventoryHost": matches[0]})
        elif len(matches) > 1:
            # An explicit endpoint can disambiguate inventory aliases for the same host.
            exact_matches = [
                alias for alias in matches if hostvars[alias].get("cbp_endpoint") == endpoint
            ]
            if len(exact_matches) == 1:
                resolved.append({**target, "inventoryHost": exact_matches[0]})
            else:
                missing.append(
                    (target.get("hostName") or host_id, endpoint, "multiple inventory hosts match")
                )
        else:
            missing.append(
                (target.get("hostName") or host_id, endpoint, "no inventory host matches")
            )
    return resolved, missing


def run_job(opener, url, token, inventory, target, job):
    job_identity = {"hostId": target["hostId"], "endpoint": target["endpoint"]}

    def report_log(message):
        try:
            post(
                opener,
                url,
                token,
                operation="log",
                jobId=job["id"],
                message=message,
                **job_identity,
            )
        except (OSError, ValueError):
            pass

    def report_host(host_report):
        post(
            opener,
            url,
            token,
            operation="report",
            jobId=job["id"],
            report=host_report,
            **job_identity,
        )

    report_log("Ansible runner claimed deployment")
    try:
        succeeded, served_certificate_expiry = (
            (False, None)
            if shutdown_requested.is_set()
            else deploy(
                inventory,
                target["inventoryHost"],
                target["endpoint"],
                job,
                report_log,
                report_host,
            )
        )
    except (OSError, ValueError):
        succeeded, served_certificate_expiry = False, None
    report_log("Deployment succeeded" if succeeded else "Deployment failed")
    print(f"Job {job['id']} {'deployed' if succeeded else 'failed'}.", flush=True)
    for attempt in range(3):
        try:
            finish_data = (
                {"servedCertificateExpiresAt": served_certificate_expiry}
                if served_certificate_expiry
                else {}
            )
            post(
                opener,
                url,
                token,
                operation="finish",
                jobId=job["id"],
                succeeded=succeeded,
                **job_identity,
                **finish_data,
            )
            break
        except (OSError, ValueError) as error:
            if attempt == 2 or 400 <= getattr(error, "code", 500) < 500:
                print(
                    f"Could not report job {job['id']} "
                    f"({getattr(error, 'code', type(error).__name__)}).",
                    file=sys.stderr,
                    flush=True,
                )
                break
            time.sleep(2)


def main():
    signal.signal(signal.SIGINT, request_shutdown)
    signal.signal(signal.SIGTERM, request_shutdown)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inventory", type=Path)
    parser.add_argument(
        "--once",
        action="store_true",
        help="Poll each configured inventory endpoint once",
    )
    args = parser.parse_args()
    origin = urlsplit(os.environ.get("CBP_ANSIBLE_WEB_URL", ""))
    token = os.environ.get("CBP_ANSIBLE_TOKEN", "")
    if (
        not origin.hostname
        or origin.username
        or origin.password
        or origin.path not in ("", "/")
        or origin.query
        or origin.fragment
    ):
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
    except (
        OSError,
        subprocess.SubprocessError,
        json.JSONDecodeError,
        TypeError,
        ValueError,
    ) as error:
        if shutdown_requested.is_set():
            return
        parser.error(f"Could not load Ansible inventory: {error}")

    url = origin.geturl().rstrip("/") + "/api/internal/ansible"
    opener = (
        build_opener(ProxyHandler({}), NoRedirects())
        if loopback
        else build_opener(NoRedirects())
    )
    reported_missing = set()
    workers = ThreadPoolExecutor(max_workers=max_job_workers)
    free_workers = threading.Semaphore(max_job_workers)
    busy_hosts = set()
    while not shutdown_requested.is_set():
        try:
            updated_inventory = load_inventory(inventory)
            if updated_inventory != inventory_hosts:
                inventory_hosts = updated_inventory
                print(f"Reloaded Ansible inventory ({len(inventory_hosts)} hosts).", flush=True)
        except (
            OSError,
            subprocess.SubprocessError,
            json.JSONDecodeError,
            TypeError,
            ValueError,
        ) as error:
            print(
                "Could not reload Ansible inventory; keeping the last valid version "
                f"({type(error).__name__}).",
                file=sys.stderr,
                flush=True,
            )
        if shutdown_requested.is_set():
            break
        try:
            targets, missing = resolve_targets(
                inventory_hosts,
                post(opener, url, token, operation="targets"),
            )
            for host_name, endpoint, reason in missing:
                issue = (host_name, endpoint, reason)
                if issue not in reported_missing:
                    print(
                        f"Skipping Ansible endpoint {endpoint} for {host_name}: {reason}.",
                        file=sys.stderr,
                        flush=True,
                    )
                    reported_missing.add(issue)
        except (OSError, ValueError) as error:
            print(
                f"Could not list Ansible endpoints ({type(error).__name__}).",
                file=sys.stderr,
                flush=True,
            )
            targets = []
        for target in targets:
            if shutdown_requested.is_set():
                break
            if target["hostId"] in busy_hosts:
                continue
            # Claim only with a free worker; a claimed job starts its 5-minute running deadline.
            if not free_workers.acquire(blocking=False):
                break
            job_identity = {"hostId": target["hostId"], "endpoint": target["endpoint"]}
            try:
                job = post(opener, url, token, operation="claim", **job_identity)
            except (OSError, ValueError) as error:
                print(
                    f"Could not claim a job for {target['endpoint']} "
                    f"({getattr(error, 'code', type(error).__name__)}).",
                    file=sys.stderr,
                    flush=True,
                )
                job = None
            if not job:
                free_workers.release()
                continue
            busy_hosts.add(target["hostId"])

            def release(future, host_id=target["hostId"], job_id=job["id"]):
                busy_hosts.discard(host_id)
                free_workers.release()
                if future.exception() is not None:
                    print(
                        f"Job {job_id} stopped unexpectedly "
                        f"({type(future.exception()).__name__}).",
                        file=sys.stderr,
                        flush=True,
                    )

            workers.submit(run_job, opener, url, token, inventory, target, job).add_done_callback(
                release
            )
        if args.once:
            break
        shutdown_requested.wait(5)
    workers.shutdown(wait=True)


if __name__ == "__main__":
    main()
