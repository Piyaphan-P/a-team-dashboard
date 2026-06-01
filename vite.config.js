import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          ['babel-plugin-react-compiler', {
            target: '19'
          }]
        ]
      }
    }),
    tailwindcss()
  ],
  server: {
    port: 5173,
    host: 'localhost',
    strictPort: false,
    hmr: { host: 'localhost' },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Vite 8 (rolldown) requires function form for manualChunks
        manualChunks(id) {
          if (id.includes('node_modules/lucide-react')) return 'icons';
          if (id.includes('node_modules/recharts')) return 'charts';
          if (id.includes('node_modules/d3')) return 'd3-core';
          if (id.includes('node_modules/dayjs') || id.includes('node_modules/react-hot-toast')) return 'utils';
        }
      }
    }
  }
});
