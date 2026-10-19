import { registerHooks } from 'node:module';
import './worker-offline-guard.mjs';
// Test process only: emulate an interactive terminal and redirect the live runtime.
Object.defineProperty(process.stdin, 'isTTY', { value: true });
Object.defineProperty(process.stdout, 'isTTY', { value: true });
const fake = new URL('./worker-live-mock-runtime.mjs', import.meta.url).href;
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '../lib/worker-live-runtime.mjs') return { url: fake, shortCircuit: true };
  return next(specifier, context);
} });
