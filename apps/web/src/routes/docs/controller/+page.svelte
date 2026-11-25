<script lang="ts">
  import { resolve } from "$app/paths";
  import { Button } from "#lib/components/ui/button/index.ts";
  import SetupCommands from "#lib/components/svelte/setup-commands.svelte";

  const sections = [
    { id: "web", label: "Configure the web app" },
    { id: "controller", label: "Start the controller" },
    { id: "controller-health", label: "Verify the controller" },
  ];

  const webCommands = `bun -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
# Save the generated value as CBP_CONTROLLER_TOKEN in the root .env.local.
bun --filter @cbp/database db:setup-controller`;

  const controllerEnv = String.raw`export CBP_WEB_URL='https://cbp-web.internal'
read -rsp 'Controller service token: ' CBP_CONTROLLER_TOKEN
export CBP_CONTROLLER_TOKEN
printf '\n'`;

  const controllerCommands = String.raw`go build -o ./cbp-controller ./apps/controller
./cbp-controller serve \
  -listen 0.0.0.0:50051 \
  -tls-cert ./controller-fullchain.pem \
  -tls-key ./controller.key`;

  const agentSettings = `CBP_AGENT_CONTROLLER_ADDRESS=cbp-controller.internal:50051
# Optional for a private CA. Use the PEM path on the Linux agent hosts.
# CBP_AGENT_CA_FILE=/etc/cbp/controller-ca.pem
# CBP_AGENT_CA_DOWNLOAD_FILE=/absolute/path/to/controller-ca.pem`;
</script>

<svelte:head>
  <title>Controller setup | Certified by Pat</title>
</svelte:head>

<section
  class="w-full flex-1 px-5 py-6 md:px-8"
  aria-labelledby="controller-setup"
>
  <header class="mb-7 grid gap-1.5">
    <h1 id="controller-setup" class="font-heading text-xl font-semibold">
      Controller setup
    </h1>
    <p class="max-w-prose text-sm text-muted-foreground">
      Run the controller on Windows or Linux and connect it to CBP so agent
      check-ins appear in the host inventory.
    </p>
  </header>

  <div
    class="grid max-w-6xl items-start gap-6 lg:grid-cols-[minmax(0,1fr)_11rem] lg:gap-10"
  >
    <nav
      aria-label="On this page"
      class="border-y py-3 text-xs lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1 lg:border-y-0 lg:border-s lg:ps-4"
    >
      <p class="mb-2 font-medium">On this page</p>
      <ol class="grid list-decimal gap-2 ps-5">
        {#each sections as section (section.id)}
          <li>
            <a
              href={`#${section.id}`}
              class="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >{section.label}</a
            >
          </li>
        {/each}
      </ol>
    </nav>

    <article
      class="grid min-w-0 gap-7 text-sm leading-relaxed lg:col-start-1 lg:row-start-1"
    >
      <p class="max-w-prose">
        Agents connect to the controller over gRPC with TLS. The controller
        calls the web app over HTTPS, and the web app stores enrollment and
        check-in data in PostgreSQL. Use Go 1.27.4 or later where you build the
        binaries. Run the commands from the repository root.
      </p>

      <section
        id="web"
        aria-labelledby="web-heading"
        class="grid scroll-m-4 gap-3 border-t pt-5"
      >
        <h2 id="web-heading" class="font-heading text-base font-semibold">
          1. Configure the web app
        </h2>
        <p class="max-w-prose">
          Generate a service token, save it in the repository root's <code
            >.env.local</code
          >, then create the controller tables and restart the web app. Keep the
          token on the web and controller servers.
        </p>
        <SetupCommands label="Web server" command={webCommands} />
        <p class="max-w-prose">
          In the same <code>.env.local</code> file, set the controller address your
          Linux agents can reach. If you use a private CA, set the PEM path as it
          appears on those hosts. Restart the web app after saving.
        </p>
        <SetupCommands
          label="Web enrollment settings"
          command={agentSettings}
        />
      </section>

      <section
        id="controller"
        aria-labelledby="controller-heading"
        class="grid scroll-m-4 gap-3 border-t pt-5"
      >
        <h2
          id="controller-heading"
          class="font-heading text-base font-semibold"
        >
          2. Start the controller
        </h2>
        <h3 class="font-medium">Windows development</h3>
        <p class="max-w-prose">
          Put <code>controller-fullchain.pem</code> and
          <code>controller.key</code>
          in the repository root, or set their paths with
          <code>CBP_CONTROLLER_TLS_CERT</code>
          and <code>CBP_CONTROLLER_TLS_KEY</code> in <code>.env.local</code>.
          Run <code>bun dev</code> to start the web app and controller together.
          Run <code>bun dev:controller</code>
          to start just the controller.
        </p>
        <p class="max-w-prose">
          For agents on other hosts, set <code
            >CBP_CONTROLLER_LISTEN=0.0.0.0:50051</code
          >
          and allow inbound TCP
          <code>50051</code> from those hosts. Set
          <code>CBP_AGENT_CONTROLLER_ADDRESS</code> to the Windows DNS name and port
          they can reach, and use a TLS certificate that covers that name.
        </p>
        <h3 class="font-medium">Linux VM</h3>
        <p class="max-w-prose">
          On the Linux VM, replace the example URL with the web app's base URL
          and enter the same service token. If the web app uses a private CA,
          set <code>CBP_WEB_CA_FILE</code> to its PEM certificate on the VM.
        </p>
        <SetupCommands label="Controller environment" command={controllerEnv} />
        <p class="max-w-prose">
          Provide a TLS certificate and matching private key for the controller.
          The certificate must cover the DNS name agents use. Allow inbound TCP
          port <code>50051</code> from the agent hosts.
        </p>
        <SetupCommands label="Linux VM" command={controllerCommands} />
        <p class="max-w-prose text-muted-foreground">
          If you run the controller in Docker on the VM, publish TCP <code
            >50051</code
          >, mount the TLS files read-only, and supply the controller
          environment to the container.
        </p>
      </section>

      <section
        id="controller-health"
        aria-labelledby="controller-health-heading"
        class="grid scroll-m-4 gap-3 border-t pt-5"
      >
        <h2
          id="controller-health-heading"
          class="font-heading text-base font-semibold"
        >
          3. Verify the controller
        </h2>
        <p class="max-w-prose">
          The navbar shows <strong>Controller online</strong> when the controller
          has checked in to CBP within the last 30 seconds. The controller also pings
          registered hosts every 30 seconds and saves the latest results to the host
          inventory.
        </p>
        <Button
          href={resolve("/docs/agent")}
          variant="outline"
          class="justify-self-start">Open agent setup</Button
        >
      </section>
    </article>
  </div>
</section>
