import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [tailwindcss()],
  // This replacement is scoped to the demo build. Production uses its normal
  // client, Workers authentication, CSRF, and authorization without changes.
  resolve: { alias: [{ find: /^\.\/client$/, replacement: fileURLToPath(new URL('./src/client.ts', import.meta.url)) }] },
  build: { outDir: '../../docs/demo', emptyOutDir: true, sourcemap: false, target: 'es2022', modulePreload: { polyfill: false } },
  esbuild: { jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment' },
});
