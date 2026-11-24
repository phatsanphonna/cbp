<script lang="ts">
  import DeploymentJobDetails from "../deployment-job-details.svelte";
  import type { PageProps } from "./$types";

  let { data, form }: PageProps = $props();
</script>

<DeploymentJobDetails
  id={data.id}
  certificateName={data.certificateName}
  certificateFingerprint={data.certificateFingerprint}
  jobs={data.jobs}
  submittedAt={data.submittedAt}
  submittedLabel={data.submittedLabel}
  canRecover={data.canRecover}
  recoverError={form?.recoverError}
/>
