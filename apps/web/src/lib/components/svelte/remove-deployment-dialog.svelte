<script lang="ts">
  import { enhance } from "$app/forms";
  import { toast } from "svelte-sonner";
  import * as AlertDialog from "#lib/components/ui/alert-dialog/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";

  let {
    deploymentId,
    endpoint,
    message,
    disabled = false,
  }: {
    deploymentId: string;
    endpoint: string;
    message?: string;
    disabled?: boolean;
  } = $props();
  let open = $state(false);
  let pending = $state(false);
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        type="button"
        variant="outline"
        {disabled}
        aria-label={`Delete endpoint ${endpoint}`}>Delete endpoint</Button
      >
    {/snippet}
  </AlertDialog.Trigger>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete endpoint?</AlertDialog.Title>
      <AlertDialog.Description class="wrap-anywhere">
        Remove {endpoint} from the deployment inventory and cancel any queued deployment
        for it.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <form
      method="POST"
      action="?/removeDeployment"
      use:enhance={() => {
        pending = true;
        return async ({ result, update }) => {
          try {
            await update();
            if (result.type === "success") {
              open = false;
              if (typeof result.data?.removeDeploymentMessage === "string") {
                toast.success(result.data.removeDeploymentMessage);
              }
            } else if (result.type === 'failure' && typeof result.data?.removeDeploymentError === 'string') {
              toast.error(result.data.removeDeploymentError);
            }
          } finally {
            pending = false;
          }
        };
      }}
    >
      <input type="hidden" name="deploymentId" value={deploymentId} />
      <AlertDialog.Footer>
        <AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
        <Button type="submit" variant="destructive" disabled={pending}
          >{pending ? "Deleting…" : "Delete endpoint"}</Button
        >
      </AlertDialog.Footer>
    </form>
  </AlertDialog.Content>
</AlertDialog.Root>
