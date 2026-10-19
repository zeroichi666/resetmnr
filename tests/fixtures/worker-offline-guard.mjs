import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import child from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const deny = () => { process.stderr.write('OFFLINE_GUARD_VIOLATION\n'); process.exit(99); };
globalThis.fetch = deny;
net.Socket.prototype.connect = deny;
net.connect = net.createConnection = deny;
for (const obj of [http, https]) { obj.request = deny; obj.get = deny; }
dns.lookup = dns.resolve = deny;
for (const method of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) child[method] = deny;
for (const obj of [fs, fsp]) {
  for (const method of ['readFile', 'readFileSync', 'open', 'openSync', 'stat', 'statSync', 'lstat', 'lstatSync', 'access', 'accessSync', 'readdir', 'readdirSync', 'realpath', 'realpathSync']) {
    if (typeof obj[method] !== 'function') continue;
    const original = obj[method];
    obj[method] = function(path, ...args) {
      const p = String(path);
      if (p.includes('.reset-signer') || /wallet|keystore/i.test(p)) return deny();
      return original.call(this, path, ...args);
    };
  }
  for (const method of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync'])
    if (typeof obj[method] === 'function') obj[method] = deny;
}
syncBuiltinESMExports();
