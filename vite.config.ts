/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { aiProxy } from './demo/server';

// `pnpm dev` → demo page (index.html + demo/), with a local proxy to the model API.
// `pnpm build` → library in dist (ESM + CJS + .d.ts).
export default defineConfig(({ mode }) => ({
    plugins: [react(), aiProxy(loadEnv(mode, import.meta.dirname, ''))],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        copyPublicDir: false,
        lib: {
            entry: resolve(import.meta.dirname, 'src/index.ts'),
            name: 'ReactWhiteboardAI',
            fileName: 'react-whiteboard-ai',
            formats: ['es', 'cjs'],
        },
        rollupOptions: {
            external: ['react', 'react-dom', 'react/jsx-runtime', '@inchill/react-whiteboard'],
        },
    },
    test: {
        environment: 'jsdom',
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/**/*.test.{ts,tsx}'],
    },
}));
