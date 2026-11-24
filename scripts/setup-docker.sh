#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  fail 'Usage: bash scripts/setup-docker.sh CONTROLLER_HOST:PORT [WEB_ORIGIN]'
fi
command -v openssl >/dev/null || fail 'Install OpenSSL before running this script.'
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
[[ ! -e .env && ! -L .env ]] || fail '.env already exists. Keep it to preserve the deployment secrets.'

address=$1
web_origin=${2:-http://127.0.0.1:3000}
if [[ $address =~ ^\[([0-9A-Fa-f:.]+)\]:([1-9][0-9]{0,4})$ ]]; then
  host=${BASH_REMATCH[1]}
  port=${BASH_REMATCH[2]}
  san_type=IP
elif [[ $address =~ ^([A-Za-z0-9][A-Za-z0-9.-]*):([1-9][0-9]{0,4})$ ]]; then
  host=${BASH_REMATCH[1]}
  port=${BASH_REMATCH[2]}
  san_type=DNS
  if [[ $host =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    san_type=IP
  fi
else
  fail 'Use a DNS name or IPv4 address followed by :PORT, or [IPv6]:PORT.'
fi
(( port <= 65535 )) || fail 'The controller port must be between 1 and 65535.'
[[ $web_origin =~ ^https?://([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]+)?$ ]] ||
  fail 'Use a web origin such as https://cbp.example.com, without a trailing slash.'
if [[ $web_origin != https://* && ! $web_origin =~ ^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?$ ]]; then
  fail 'Use HTTPS for a web origin outside loopback development.'
fi

default_cert=./controller-fullchain.pem
default_key=./controller.key
cert=${CBP_CONTROLLER_TLS_CERT:-$default_cert}
key=${CBP_CONTROLLER_TLS_KEY:-$default_key}
agent_ca=${CBP_AGENT_CA_FILE:-}
download_ca=${CBP_AGENT_CA_DOWNLOAD_FILE:-}
for path in "$cert" "$key" "$agent_ca" "$download_ca"; do
  [[ $path != *"'"* && $path != *$'\n'* && $path != *$'\r'* ]] ||
    fail 'TLS paths cannot contain single quotes or line breaks.'
done

stage=$(mktemp -d ./.cbp-setup.XXXXXXXX)
trap 'rm -f -- "$stage/.env" "$stage/controller.pem" "$stage/controller.key"; rmdir -- "$stage"' EXIT
cert_to_check=$cert
key_to_check=$key
trust_file=
if [[ ! -e $cert && ! -L $cert && ! -e $key && ! -L $key && $cert == "$default_cert" && $key == "$default_key" ]]; then
  printf 'Generating a self-signed controller certificate for %s.\n' "$host"
  cert_to_check=$stage/controller.pem
  key_to_check=$stage/controller.key
  openssl req -x509 -newkey rsa:2048 -sha256 -days 365 -nodes \
    -subj '/CN=CBP Controller' -addext "subjectAltName=$san_type:$host" \
    -addext 'basicConstraints=critical,CA:FALSE' -addext 'extendedKeyUsage=serverAuth' \
    -out "$cert_to_check" -keyout "$key_to_check"
  trust_file=$cert
  chmod 0644 -- "$cert_to_check"
elif [[ ! -f $cert || ! -r $cert || ! -f $key || ! -r $key ]]; then
  fail "Provide both readable TLS files ($cert and $key)."
elif [[ $cert == "$default_cert" ]] &&
     openssl verify -CAfile ./controller-ca.pem -untrusted "$cert" "$cert" >/dev/null 2>&1; then
  trust_file=./controller-ca.pem
fi

san=$(openssl x509 -in "$cert_to_check" -noout -ext subjectAltName)
if [[ $san_type == IP ]]; then
  [[ $san == *'IP Address:'* ]] || fail 'The controller certificate needs an IP subject alternative name.'
  verify_name=(-verify_ip "$host")
else
  [[ $san == *'DNS:'* ]] || fail 'The controller certificate needs a DNS subject alternative name.'
  verify_name=(-verify_hostname "$host")
fi
openssl verify -partial_chain -trusted "$cert_to_check" -purpose sslserver \
  "${verify_name[@]}" "$cert_to_check" >/dev/null ||
  fail "Use a valid TLS certificate that covers $host."
cert_pubkey=$(openssl x509 -in "$cert_to_check" -noout -pubkey)
key_pubkey=$(openssl pkey -in "$key_to_check" -passin pass: -pubout)
[[ $cert_pubkey == "$key_pubkey" ]] || fail 'The controller certificate and private key do not match.'

download_ca=${download_ca:-$trust_file}
if [[ -n $download_ca ]]; then
  agent_ca=${agent_ca:-/etc/cbp/controller-ca.pem}
fi
postgres_password=$(openssl rand -hex 32)
database_web_password=$(openssl rand -hex 32)
auth_secret=$(openssl rand -hex 32)
controller_token=$(openssl rand -hex 32)
proxy_token=
if [[ $web_origin == https://* ]]; then
  proxy_token=$(openssl rand -hex 32)
fi
cat > "$stage/.env" <<EOF
POSTGRES_PASSWORD=$postgres_password
CBP_DATABASE_WEB_PASSWORD=$database_web_password
BETTER_AUTH_SECRET=$auth_secret
BETTER_AUTH_URL=$web_origin
CBP_TRUSTED_PROXY_TOKEN=$proxy_token
CBP_CONTROLLER_TOKEN=$controller_token
CBP_AGENT_CONTROLLER_ADDRESS=$address
CBP_CONTROLLER_BIND=127.0.0.1
CBP_CONTROLLER_PORT=$port
CBP_CONTROLLER_TLS_CERT='$cert'
CBP_CONTROLLER_TLS_KEY='$key'
CBP_AGENT_CA_FILE='$agent_ca'
CBP_AGENT_CA_DOWNLOAD_FILE='$download_ca'
EOF

if [[ $cert_to_check != "$cert" ]]; then
  ln -T -- "$key_to_check" "$key"
  ln -T -- "$cert_to_check" "$cert"
fi
ln -T -- "$stage/.env" .env
printf 'Created .env. Keep a protected copy with your database backups.\n'
if [[ -n $download_ca ]]; then
  printf 'Download the public CA from Agent enrollment, or copy %s to %s on each agent host.\n' "$download_ca" "$agent_ca"
elif [[ -n $agent_ca ]]; then
  printf 'Install the controller CA certificate at %s on each agent host.\n' "$agent_ca"
fi
