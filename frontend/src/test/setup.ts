import "@testing-library/jest-dom/vitest";

import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// findBy*/waitFor default to 1 s, which cold tests can exceed when every test file runs in
// parallel; 3 s removes that flakiness without hiding real failures (which never resolve).
configure({ asyncUtilTimeout: 3000 });

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// Test-only: React Router creates a Request with jsdom's AbortSignal, which Node's
// native Request rejects ("Expected signal to be an instance of AbortSignal").
// Browsers are unaffected. Navigation cancellation is not under test here.
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    if (init?.signal) {
      const { signal: _signal, ...rest } = init;
      super(input, rest);
    } else {
      super(input, init);
    }
  }
} as typeof Request;
