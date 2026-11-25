#!/usr/bin/env bash
set -euo pipefail

repo=${1:?repository path required}
runner="$repo/scripts/ansible/runner.py"
environment=${CBP_ANSIBLE_RUNNER_ENV:-"$HOME/.config/cbp/ansible-runner.env"}

if [[ ! -f "$environment" ]]; then
  echo "Ansible runner skipped: configure $environment."
  exit 0
fi

set -a
source "$environment"
set +a
export CBP_ANSIBLE_WEB_URL=${CBP_ANSIBLE_WEB_URL:-http://127.0.0.1:5173}
inventory=${CBP_ANSIBLE_INVENTORY:-"$HOME/ansible-lab/inventory.yml"}

if [[ ! -f "$inventory" ]]; then
  echo "Ansible runner skipped: configure $inventory."
  exit 0
fi

existing=$(ps -eo pid=,args= | awk -v runner="$runner" '$2 ~ /^python/ && $3 == runner { print $1; exit }')
if [[ -n "$existing" ]]; then
  echo "Ansible runner already running (PID $existing)."
  exit 0
fi

python3 "$runner" "$inventory" &
runner_pid=$!
stop_runner() {
  kill -TERM "$runner_pid" 2>/dev/null || true
  wait "$runner_pid" || true
}
trap stop_runner INT TERM HUP
wait "$runner_pid"
