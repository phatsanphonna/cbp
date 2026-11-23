import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit({
    adapter: process.env.CBP_CONTAINER_BUILD === '1' ? {
      name: 'cbp-bun-container',
      adapt(builder) {
        builder.rimraf('dist');
        builder.writeClient('dist/client');
        builder.writeServer('dist/server');
        builder.generateServerInstance('dist/app.js', { serverDirectory: 'dist/server' });
      }
    } : adapter(),
    env: { dir: '../..' }
  })],
  ssr: { noExternal: ['@tanstack/svelte-table', '@tanstack/svelte-store'] }
});
