import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const UPSTREAM = join(ROOT, 'vendor', 'upstream');
export const SIGNER = join(UPSTREAM, 'signer', 'bin', 'reset-signer.mjs');
// Deliberately ignore environment overrides for wallet, gateway and executables.
export const WALLET_DIRECTORY = join(homedir(), '.reset-signer');
export const PIN = '6132e8653d6342f36673eb7426ec8e064960e48e';
