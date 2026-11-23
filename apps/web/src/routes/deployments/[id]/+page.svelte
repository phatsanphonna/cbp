<script lang="ts">
  import DeploymentJobDetails from '../deployment-job-details.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<DeploymentJobDetails id={data.id} certificateName={data.certificateName} jobs={data.jobs}
  submittedAt={data.submittedAt} submittedLabel={data.submittedLabel} />
