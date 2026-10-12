/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Library build: `pnpm build` → dist (ESM + CJS + .d.ts)
export default defineConfig({
    plugins: [react()],
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
});
