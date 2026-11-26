<script lang="ts">
  import type { PageProps } from "./$types";
  import { resolve } from "$app/paths";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { createColumnHelper, renderSnippet } from "@tanstack/svelte-table";
  import DataTable from "#lib/components/svelte/data-table.svelte";
  import type { DataTableFeatures } from "#lib/components/svelte/data-table-features.js";

  let { data }: PageProps = $props();
  const column = createColumnHelper<
    DataTableFeatures,
    PageProps["data"]["certificates"][number]
  >();
  const columns = column.columns([
    column.accessor(
      ({ domain, displayDomain }) =>
        domain === displayDomain ? domain : `${domain} ${displayDomain}`,
      {
        id: "domain",
        header: "Domain",
        filterFn: "includesString",
        cell: ({ row }) => renderSnippet(certificateLink, row.original),
      },
    ),
    column.accessor("issuer", { header: "Issuer" }),
    column.accessor("deployments", { header: "Deployments" }),
    column.accessor("status", {
      header: "Expiry",
      cell: ({ getValue }) => renderSnippet(status, getValue()),
    }),
  ]);
</script>

<svelte:head>
  <title>Certificates | CBP</title>
</svelte:head>

<section class="px-5 py-6 md:px-8" aria-labelledby="certificates-heading">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="grid gap-1">
      <h1 id="certificates-heading" class="font-heading text-xl font-semibold">
        Certificates
      </h1>
      <p class="text-xs text-muted-foreground">
        Track TLS expiry and deployment coverage.
      </p>
    </div>
    {#if data.canManageCertificates}
      <Button href={resolve("/certificates/new")}>Register certificate</Button>
    {/if}
  </header>

  {#if data.expiryLabel}
    <div class="mt-4 flex flex-wrap items-center gap-3 text-xs">
      <span class="font-medium">{data.expiryLabel}</span>
      <Button href={resolve("/certificates")} variant="ghost" size="sm"
        >Clear expiry filter</Button
      >
    </div>
  {/if}

  <div class="mt-6">
    <DataTable
      caption="TLS certificate inventory"
      {columns}
      data={data.certificates}
      rowKey={(item) => item.id}
      rowHeader="domain"
      filter={{ column: "domain", label: "Filter by domain" }}
      emptyMessage={data.certificates.length
        ? "No certificates match that domain."
        : data.expiryLabel
          ? "No certificates match this expiry filter."
          : "No certificates have been discovered yet."}
      tableClass="min-w-[48rem]"
    />
  </div>
</section>

{#snippet certificateLink(
  certificate: PageProps["data"]["certificates"][number],
)}
  <a
    href={resolve("/certificates/[id]", { id: certificate.id })}
    class="text-primary underline underline-offset-4"
  >
    {certificate.displayDomain}
  </a>
{/snippet}

{#snippet status(value: string)}
  <span class="font-medium" class:text-destructive={!value.startsWith("Valid")}
    >{value}</span
  >
{/snippet}
