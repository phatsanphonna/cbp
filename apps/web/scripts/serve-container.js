const origin = new URL(Bun.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000");
const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
if (
  origin.protocol !== "https:" &&
  !(origin.protocol === "http:" && loopback)
) {
  throw new Error(
    "BETTER_AUTH_URL must use HTTPS outside loopback development",
  );
}
const proxyToken = Bun.env.CBP_TRUSTED_PROXY_TOKEN;
if (proxyToken && !/^[A-Za-z0-9_-]{43,128}$/.test(proxyToken)) {
  throw new Error(
    "CBP_TRUSTED_PROXY_TOKEN must be a 43 to 128 character URL-safe token",
  );
}

Bun.env.CBP_BUN_ORIGIN = origin.origin;
// Keep the adapter's client address tied to the socket. CBP verifies forwarded addresses itself.
delete Bun.env.CBP_BUN_ADDRESS_HEADER;

const certPath = Bun.env.CBP_WEB_TLS_CERT;
const keyPath = Bun.env.CBP_WEB_TLS_KEY;
if (
  (certPath || keyPath) &&
  (!certPath || !keyPath || origin.protocol !== "https:")
) {
  throw new Error(
    "Direct HTTPS requires both CBP_WEB_TLS_CERT and CBP_WEB_TLS_KEY and an HTTPS BETTER_AUTH_URL",
  );
}

const { server_options, server } = await import("../dist/adapter-bun.js");
if (certPath && keyPath) {
  // The Bun adapter reads these options when its entry point starts the listener.
  server_options.tls = {
    cert: await Bun.file(certPath).text(),
    key: await Bun.file(keyPath).text(),
  };
}
await import("../dist/index.js");

if (certPath && keyPath) {
  const workerApi = Bun.serve({
    hostname: "127.0.0.1",
    port: 3001,
    idleTimeout: 10,
    maxRequestBodySize: 512 * 1024,
    fetch(request, listener) {
      const path = new URL(request.url).pathname;
      if (
        request.method !== "POST" ||
        !(
          path.startsWith("/api/internal/controller/") ||
          path === "/api/internal/ansible"
        )
      ) {
        return new Response(null, { status: 404 });
      }
      return server.respond(request, {
        platform: { server: listener },
        getClientAddress: () => listener.requestIP(request)?.address,
      });
    },
  });
  process.on("sveltekit:shutdown", () => {
    void workerApi.stop(true);
  });
}
