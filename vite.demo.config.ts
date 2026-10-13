import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `pnpm build:demo` → dist-demo: the demo page as static files for GitHub Pages or any static host.
// There is no dev server there, so the page calls the model provider straight from the browser.
// A relative base lets the same build work at /react-whiteboard-ai/, a custom domain or any sub-path.
export default defineConfig({
    base: './',
    // Never read .env files for the published page: .env.local holds the developer's own key.
    envDir: false,
    plugins: [react()],
    build: {
        outDir: 'dist-demo',
        emptyOutDir: true,
    },
});
