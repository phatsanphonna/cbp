<script lang="ts">
	import LoginForm from "#lib/components/svelte/login-form.svelte";
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Sign in | Certified by Pat</title>
</svelte:head>

<main class="flex min-h-svh w-full items-center justify-center px-4">
	<LoginForm greeting={data.greeting} message={form?.message} />
</main>
