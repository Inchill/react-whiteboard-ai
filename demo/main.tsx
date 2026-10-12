import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource/caveat/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@inchill/react-whiteboard/style.css';
import './demo.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
