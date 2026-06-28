import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 15173,
    proxy: {
      '/api': 'http://localhost:13080'
    }
  }
});
