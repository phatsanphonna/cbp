FROM golang:1.27.4-bookworm AS controller-build
WORKDIR /src
COPY go.work go.work.sum ./
COPY apps/agent/go.mod apps/agent/go.mod
COPY apps/controller/ apps/controller/
COPY packages/agent-rpc/ packages/agent-rpc/
RUN CGO_ENABLED=0 go build -mod=readonly -trimpath -o /out/cbp-controller ./apps/controller

FROM debian:bookworm-slim AS controller
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates iputils-ping \
    && rm -rf /var/lib/apt/lists/*
COPY --from=controller-build /out/cbp-controller /usr/local/bin/cbp-controller
EXPOSE 50051
ENTRYPOINT ["cbp-controller"]
CMD ["serve", "-listen", "0.0.0.0:50051", "-tls-cert", "/run/cbp/controller-fullchain.pem", "-tls-key", "/run/cbp/controller.key"]

FROM python:3.13-slim-bookworm AS ansible
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssh-client sshpass \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir 'ansible-core~=2.20.0' \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin cbp-runner \
    && install -d -m 0700 -o cbp-runner -g cbp-runner /home/cbp-runner/.ssh \
    && install -m 0600 -o cbp-runner -g cbp-runner /dev/null /home/cbp-runner/.ssh/known_hosts
COPY scripts/ansible/runner.py scripts/ansible/collect-host.yml scripts/ansible/deploy-nginx.yml /opt/cbp/ansible/
ENV HOME=/home/cbp-runner
USER cbp-runner
ENTRYPOINT ["python", "-u", "/opt/cbp/ansible/runner.py"]
CMD ["/run/cbp/ansible/inventory.yml"]

FROM golang:1.27.4-bookworm AS agent-build
WORKDIR /src
COPY go.work go.work.sum ./
COPY apps/agent/ apps/agent/
COPY apps/controller/go.mod apps/controller/go.mod
COPY packages/agent-rpc/ packages/agent-rpc/
RUN for arch in amd64 arm64; do \
      CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build -mod=readonly -trimpath -o "/out/cbp-agent-linux-$arch" ./apps/agent || exit 1; \
    done

FROM oven/bun:1.4.5 AS web
USER root
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
RUN umask 022 && bun install --frozen-lockfile --ignore-scripts
COPY apps/web/ apps/web/
COPY packages/database/ packages/database/
RUN umask 022 && bun run --filter web build && chmod -R a+rX /app
COPY --from=agent-build /out/ /opt/cbp/agent-downloads/
ENV CBP_AGENT_DOWNLOAD_DIR=/opt/cbp/agent-downloads
ENV NODE_ENV=production
EXPOSE 3000
USER bun
RUN for file in /app/package.json /app/packages/database/package.json \
      /app/packages/database/scripts/setup-controller.ts /app/apps/web/dist/index.js; do \
      if ! head -c 1 "$file" >/dev/null; then \
        printf 'The bun user cannot read %s\n' "$file" >&2; \
        ls -ld / /app /app/packages /app/packages/database /app/apps /app/apps/web /app/apps/web/dist >&2; \
        exit 1; \
      fi; \
    done
CMD ["bun", "apps/web/scripts/serve-container.js"]

FROM hashicorp/vault:1.20.4 AS vault
COPY vault/server.hcl /vault/config/cbp.hcl
COPY vault/cbp-policy.hcl /vault/policies/cbp.hcl
