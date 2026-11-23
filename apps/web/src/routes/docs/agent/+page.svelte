<script lang="ts">
  import { resolve } from '$app/paths';
  import { Button } from '#lib/components/ui/button/index.ts';
  import SetupCommands from '#lib/components/svelte/setup-commands.svelte';

  const sections = [
    { id: 'agent', label: 'Enroll an agent' },
    { id: 'verify', label: 'Verify the check-in' },
    { id: 'deploy', label: 'Deploy certificates' }
  ];

  const deploymentSettings = `bun --filter @cbp/database db:setup-controller
bun -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`;

  const agentConfig = `controller: cbp-controller.internal:50051
host: 00000000-0000-0000-0000-000000000000
ca: /etc/cbp/controller-ca.pem
credentialFile: /var/lib/cbp/agent.credential
interval: 30s
deploymentServices: [Nginx]`;
</script>

<svelte:head>
  <title>Agent setup | Certified by Pat</title>
</svelte:head>

<section class="w-full flex-1 px-5 py-6 md:px-8" aria-labelledby="agent-setup">
  <header class="mb-7 grid gap-1.5">
    <h1 id="agent-setup" class="font-heading text-xl font-semibold">Agent setup</h1>
    <p class="max-w-prose text-sm text-muted-foreground">Enroll Linux hosts and configure certificate deployment.</p>
  </header>

  <div class="grid max-w-6xl items-start gap-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10">
    <nav aria-label="On this page" class="border-y py-3 text-xs lg:sticky lg:top-4 lg:border-y-0 lg:border-e lg:pe-4">
      <p class="mb-2 font-medium">On this page</p>
      <ol class="grid list-decimal gap-2 ps-5">
        {#each sections as section (section.id)}
          <li><a href={`#${section.id}`} class="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{section.label}</a></li>
        {/each}
      </ol>
    </nav>

    <article class="grid min-w-0 gap-7 text-sm leading-relaxed">
      <p class="max-w-prose">Complete <a href={resolve('/docs/controller')} class="font-medium underline underline-offset-4">Controller setup</a> before enrolling an agent.</p>

      <section id="agent" aria-labelledby="agent-heading" class="grid scroll-m-4 gap-3 border-t pt-5">
        <h2 id="agent-heading" class="font-heading text-base font-semibold">1. Enroll an agent</h2>
        <p class="max-w-prose">
          <a href={resolve('/hosts/new')} class="font-medium underline underline-offset-4">Register a host</a>, then open its details from the host inventory.
          Under <strong>Agent enrollment</strong>, select <strong>Generate enrollment code</strong> to enable agent management.
          Install <code>cbp-agent</code> on the Linux host and run the generated command as root on that host.
          It includes the controller address, host UUID, and the single-use enrollment code, which expires after 15 minutes.
        </p>
        <p class="max-w-prose">
          After the first successful check-in, the command starts and enables <code>cbp-agent.service</code> so the agent
          starts at boot. It stores the credential in <code>/var/lib/cbp/agent.credential</code>.
        </p>
      </section>

      <section id="verify" aria-labelledby="verify-heading" class="grid scroll-m-4 gap-3 border-t pt-5">
        <h2 id="verify-heading" class="font-heading text-base font-semibold">2. Verify the check-in</h2>
        <p class="max-w-prose">
          Look for <code>check-in accepted</code> in the agent log. Refresh the host details page to see
          <strong>Last agent check-in</strong>, hostname, operating system, and architecture.
          Run <code>systemctl status cbp-agent</code> to check the service. It checks in every minute by default.
          To install the service for an existing enrollment, run <code>cbp-agent -install-service</code> as root
          with the existing controller, host, and credential settings supplied through YAML or command-line flags.
        </p>
        <p class="max-w-prose">
          To revoke an agent or cancel an unused code, select <strong>Reset enrollment</strong> on the host details page.
          To enroll a replacement, generate a new code and use a fresh credential file.
        </p>
        <Button href={resolve('/hosts')} variant="outline" class="justify-self-start">Open host inventory</Button>
      </section>
      <section id="deploy" aria-labelledby="deploy-heading" class="grid scroll-m-4 gap-3 border-t pt-5">
        <h2 id="deploy-heading" class="font-heading text-base font-semibold">3. Deploy certificates</h2>
        <p class="max-w-prose">
          Set up the deployment table and generate a 32-byte encryption key. Save the generated value as
          <code>CBP_DEPLOYMENT_ENCRYPTION_KEY</code> in the web app environment and restart the app.
          Use the same value on all web instances. Serve CBP over HTTPS.
        </p>
        <SetupCommands label="Web deployment setup" command={deploymentSettings} />
        <p class="max-w-prose">
          On each Linux host, configure the agent in <code>/etc/cbp/cbp.yaml</code> or <code>/etc/cbp/cbp.yml</code>.
          Replace the example host ID with the enrolled host ID and use its existing credential file.
          Set <code>ca</code> if the controller uses a private CA. The agent also accepts <code>-config</code> for a custom path.
        </p>
        <SetupCommands label="Agent YAML configuration" command={agentConfig} />
        <p class="max-w-prose">
          Set <code>deploymentServices</code> once to the services CBP can deploy to on this host. Valid values are
          <code>Apache2</code>, <code>Nginx</code>, and <code>HAProxy</code>, with any capitalization. Choose the endpoint and its service in the web app.
          Restart <code>cbp-agent</code> after changing its YAML.
        </p>
        <p class="max-w-prose">
          The agent verifies TLS on the endpoint’s port over loopback, using the endpoint’s hostname for TLS server name.
          The agent creates a root-owned directory under <code>/etc/cbp/tls</code> when it deploys.
          For <code>app.example.com:443</code>, the directory is <code>/etc/cbp/tls/app.example.com/</code>.
          For a different port, the port is added as a subdirectory.
        </p>
        <p class="max-w-prose">
          Point Apache2 or Nginx at <code>fullchain.pem</code> and <code>privkey.pem</code> in that directory.
          Point HAProxy at <code>haproxy.pem</code>. The agent validates <code>/etc/haproxy/haproxy.cfg</code> by default.
          Give the agent permission to write those files and reload the service with <code>systemctl</code>.
        </p>
        <p class="max-w-prose">
          For a custom listener or file location, add an optional entry under <code>deployments</code> keyed by the web endpoint.
          Set <code>verifyAddress</code> or <code>serverName</code> for TLS verification. For custom files, use absolute paths in
          <code>certificateFile</code> and <code>keyFile</code> for Apache2 or Nginx, or <code>certificateFile</code> for HAProxy.
          Use <code>configFile</code> for a custom HAProxy configuration path. Existing per-endpoint configurations still work.
        </p>
        <p class="max-w-prose">
          In a certificate’s <strong>Deployments</strong> section, select <strong>Link host</strong>, set the deployment method to
          <strong>Agent</strong>, and choose the web service. For an existing link, set these in <strong>Edit deployment</strong>.
          Select <strong>Deploy</strong>, choose one or more hosts, and either upload or paste the matching unencrypted PEM private key.
          The encrypted key expires after 10 minutes if the agent
          has yet to claim the job. Once claimed, CBP removes its temporary key copy.
        </p>
      </section>
    </article>
  </div>
</section>
