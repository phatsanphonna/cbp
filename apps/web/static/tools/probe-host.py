#!/usr/bin/env python3
"""Print a CBP host report without sending it over the network."""

import datetime
import json
import platform
import socket
import subprocess


def operating_system():
    if platform.system() == "Linux":
        try:
            return platform.freedesktop_os_release().get("PRETTY_NAME") or platform.platform()
        except (AttributeError, OSError):
            pass
    return platform.platform()


def https_listeners():
    if platform.system() != "Linux":
        return None
    try:
        report = subprocess.run(
            ["ss", "-H", "-ltnp", "sport = :443"],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=5,
            check=True,
        )
        return report.stdout.strip()[:8192]
    except (OSError, subprocess.SubprocessError):
        return None


def main():
    hostname = socket.gethostname()
    fqdn = socket.getfqdn(hostname)
    report = {
        "hostname": hostname,
        "fqdn": fqdn if "." in fqdn else None,
        "operatingSystem": operating_system(),
        "architecture": platform.machine() or None,
        "httpsListeners": https_listeners(),
        "collectedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
