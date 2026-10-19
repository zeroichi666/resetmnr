// Recovery tests may write synthetic /tmp fixtures, but cannot use wallets, network, or child processes.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import child from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const deny = () => { throw new Error('ROUND400_OFFLINE_GUARD_VIOLATION'); };
globalThis.fetch = deny;
net.Socket.prototype.connect = deny;
net.connect = net.createConnection = deny;
for (const obj of [http, https]) { obj.request = deny; obj.get = deny; }
for (const obj of [dns, dns.promises]) for (const k of Object.keys(obj)) if (/^(lookup|resolve|reverse)/.test(k)) obj[k] = deny;
for (const method of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) child[method] = deny;
for (const obj of [fs, fsp]) {
  for (const method of ['readFile', 'readFileSync', 'open', 'openSync', 'stat', 'statSync', 'lstat', 'lstatSync', 'access', 'accessSync', 'readdir', 'readdirSync', 'realpath', 'realpathSync']) {
    if (typeof obj[method] !== 'function') continue;
    const original = obj[method];
    obj[method] = function(p, ...args) {
      if (typeof p === 'string' && (/wallet|keystore|\.reset-signer|\.reset-worker|\/\.local\//i.test(p))) return deny();
      return original.call(this, p, ...args);
    };
  }
}
syncBuiltinESMExports();
