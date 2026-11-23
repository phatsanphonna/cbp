import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit({ adapter: adapter(), env: { dir: '../..' } })],
  ssr: { noExternal: ['@tanstack/svelte-table', '@tanstack/svelte-store'] }
});
