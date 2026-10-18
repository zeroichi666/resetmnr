import { fileURLToPath } from 'node:url';
// Test-only harness; not a connector command and never uses the real signer.
import { startAllowlist } from '../../lib/allowlist-core.mjs';
try {
  await startAllowlist({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
    extraEnv: { TEST_AUDIT: process.env.TEST_AUDIT, TEST_PID: process.env.TEST_PID, TEST_MODE: process.env.TEST_MODE || '' } });
} catch {
  process.stderr.write('fixture startup failed\n'); process.exitCode = 1;
}
