<script lang="ts">
  import * as CodeBlock from '#lib/components/ui/code-block/index.ts';

  let { label, command }: { label: string; command: string } = $props();
</script>

<CodeBlock.Root size="sm">
  <CodeBlock.Header>
    <CodeBlock.Title>{label}</CodeBlock.Title>
    <CodeBlock.Actions>
      <CodeBlock.CopyButton value={command} aria-label={`Copy ${label}`} />
    </CodeBlock.Actions>
  </CodeBlock.Header>
  <CodeBlock.Content code={command} wrap aria-label={label} />
</CodeBlock.Root>
