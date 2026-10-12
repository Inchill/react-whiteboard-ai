import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Tell React this environment supports act(); vitest does not set it like Jest does.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => cleanup());

// jsdom has no ResizeObserver / canvas; provide light stubs so the board mounts.
class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
