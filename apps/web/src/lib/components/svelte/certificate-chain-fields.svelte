<script lang="ts">
  import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '#lib/components/ui/field/index.ts';
  import { Input } from '#lib/components/ui/input/index.ts';

  const id = $props.id();
</script>

<FieldSet aria-describedby="{id}-requirement">
  <FieldLegend variant="label" required>Public certificate</FieldLegend>
  <FieldDescription id="{id}-requirement">Upload a certificate file or paste its PEM contents.</FieldDescription>
  <FieldGroup>
    <Field>
      <FieldLabel for="{id}-file">Public certificate file</FieldLabel>
      <Input id="{id}-file" name="certificateFile" type="file" accept=".pem,.crt" aria-describedby="{id}-help" />
      <FieldDescription id="{id}-help">Use fullchain.pem or a single public PEM certificate, up to 32 KB. Keep your .key file private.</FieldDescription>
    </Field>
    <Field>
      <FieldLabel for="{id}-pem">Or paste the PEM contents</FieldLabel>
      <textarea id="{id}-pem" name="pem" class="min-h-44 w-full resize-y border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring" placeholder="-----BEGIN CERTIFICATE-----" maxlength={32768} spellcheck="false"></textarea>
    </Field>
  </FieldGroup>
</FieldSet>
