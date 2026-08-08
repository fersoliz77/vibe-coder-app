import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@uiw/react-codemirror')) return 'editor-react';
          if (id.includes('@codemirror')) return 'editor-core';
          if (id.includes('@lezer')) return 'editor-parser';
          if (id.includes('prismjs')) return 'syntax-highlighting';
          if (id.includes('@xterm')) return 'terminal';
          if (id.includes('react')) return 'react-vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
