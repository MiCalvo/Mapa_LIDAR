import { defineConfig } from 'vite';
import { pluginDatos } from './server/datos.js';

export default defineConfig({
  server: { port: 4180, strictPort: true, host: 'localhost' },
  preview: { port: 4180, strictPort: true, host: 'localhost' },
  plugins: [pluginDatos()],
  assetsInclude: ['**/*.wasm'],
});
