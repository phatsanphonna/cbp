import adapter from '@sveltejs/adapter-bun';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const envDir = '../..';

export default defineConfig({
  envDir,
  plugins: [tailwindcss(), sveltekit({
    adapter: adapter({ out: 'dist', envPrefix: 'CBP_BUN_', serverOptions: { hostname: '0.0.0.0', idleTimeout: 30 } }),
    env: { dir: envDir }
  })],
  ssr: { noExternal: ['@tanstack/svelte-table', '@tanstack/svelte-store'] }
});
