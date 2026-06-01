import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock WebSocket for tests
global.WebSocket = class WebSocket {
  constructor() {
    this.readyState = 1; // OPEN
  }
  send() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
};

// Polyfill ResizeObserver for react-window v2 (jsdom does not implement it)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
