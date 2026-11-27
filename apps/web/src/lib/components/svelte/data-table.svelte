<script lang="ts" generics="Row extends RowData">
  import { type ColumnDef, createTable, FlexRender, type RowData } from '@tanstack/svelte-table';
  import { Input } from '#lib/components/ui/input/index.ts';
  import * as Table from '#lib/components/ui/table/index.ts';
  import { type DataTableFeatures, features } from './data-table-features.js';

  let {
    caption,
    columns,
    data,
    rowKey,
    rowHeader,
    filter,
    emptyMessage = 'No records to display.',
    tableClass = '',
  }: {
    caption: string;
    columns: ColumnDef<DataTableFeatures, Row>[];
    data: Row[];
    rowKey: (item: Row) => string;
    rowHeader?: string;
    filter?: { column: string; label: string };
    emptyMessage?: string;
    tableClass?: string;
  } = $props();

  const table = createTable({
    features,
    get data() {
      return data;
    },
    get columns() {
      return columns;
    },
    getRowId: (item) => rowKey(item),
  });

  const filterColumn = $derived(filter ? table.getColumn(filter.column) : undefined);
  const rows = $derived(table.getRowModel().rows);
</script>

{#if filter && filterColumn}
  <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
    <Input
      type="search"
      aria-label={filter.label}
      placeholder={filter.label}
      class="max-w-64"
      oninput={(event) => filterColumn?.setFilterValue(event.currentTarget.value.trim())}
    />
    <p class="text-xs text-muted-foreground" aria-live="polite">
      {rows.length} of {data.length}
      {data.length === 1 ? 'record' : 'records'}
    </p>
  </div>
{/if}

<div class="border">
  <Table.Root class={tableClass}>
    <Table.Caption class="sr-only">{caption}</Table.Caption>
    <Table.Header class="bg-muted">
      {#each table.getHeaderGroups() as group (group.id)}
        <Table.Row>
          {#each group.headers as header (header.id)}
            <Table.Head
              scope={header.colSpan > 1 ? 'colgroup' : 'col'}
              colspan={header.colSpan}
              class="px-4 text-muted-foreground"
            >
              {#if !header.isPlaceholder}
                <FlexRender {header} />
              {/if}
            </Table.Head>
          {/each}
        </Table.Row>
      {/each}
    </Table.Header>
    <Table.Body>
      {#each rows as item (item.id)}
        <Table.Row>
          {#each item.getAllCells() as cell (cell.id)}
            {#if cell.column.id === rowHeader}
              <Table.Head scope="row" class="h-auto px-4 py-3">
                <FlexRender {cell} />
              </Table.Head>
            {:else}
              <Table.Cell class="px-4 py-3">
                <FlexRender {cell} />
              </Table.Cell>
            {/if}
          {/each}
        </Table.Row>
      {:else}
        <Table.Row>
          <Table.Cell
            colspan={table.getAllLeafColumns().length}
            class="py-8 text-center text-muted-foreground"
          >
            {emptyMessage}
          </Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
</div>
