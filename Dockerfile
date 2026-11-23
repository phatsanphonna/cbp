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

FROM oven/bun:1.4.5 AS web
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
RUN bun install --frozen-lockfile --ignore-scripts
COPY apps/web/ apps/web/
COPY packages/database/ packages/database/
RUN bun run --filter web build
ENV NODE_ENV=production
EXPOSE 3000
USER bun
CMD ["bun", "apps/web/scripts/serve-container.js"]
