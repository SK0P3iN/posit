import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  envPrefix: ['VITE_', 'SAAS_'],
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      '@gitroom/saas-mobile': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 4210,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
