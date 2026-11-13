import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
}

const noop = () => {};

function createMock2DContext(): CanvasRenderingContext2D {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    font: '',
    globalAlpha: 1,
    textAlign: 'start',
    textBaseline: 'alphabetic',
    setTransform: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    setLineDash: noop,
    fillText: noop,
    measureText: (text: string) => ({ width: text.length * 7 }) as TextMetrics,
  } as unknown as CanvasRenderingContext2D;
}

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value(contextId: string) {
    if (contextId === '2d') {
      return createMock2DContext();
    }
    return null;
  },
});

if (!HTMLCanvasElement.prototype.setPointerCapture) {
  HTMLCanvasElement.prototype.setPointerCapture = noop;
}
if (!HTMLCanvasElement.prototype.releasePointerCapture) {
  HTMLCanvasElement.prototype.releasePointerCapture = noop;
}
if (!HTMLCanvasElement.prototype.hasPointerCapture) {
  HTMLCanvasElement.prototype.hasPointerCapture = () => false;
}

afterEach(() => {
  cleanup();
});
