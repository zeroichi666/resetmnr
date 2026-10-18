import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PIN } from '../lib/paths.mjs';

function fixture(t, { wallet = true, directoryMode = 0o700, fileMode = 0o600, wrongPin = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'reset-setup-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home'); const project = join(root, 'project'); const bin = join(root, 'fake-bin');
  for (const dir of [home, bin, join(project, 'scripts'), join(project, 'vendor/upstream/.git'), join(project, 'vendor/upstream/signer')]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const script = join(project, 'scripts/setup-linux.sh');
  cpSync(new URL('../scripts/setup-linux.sh', import.meta.url), script);
  writeFileSync(join(project, 'vendor/upstream/signer/package-lock.json'), '{}');
  const executable = (name, source) => { const p=join(bin,name); writeFileSync(p, '#!/usr/bin/env bash\nset -eu\n'+source+'\n'); chmodSync(p,0o700); };
  executable('node', 'printf "24\\n"');
  executable('npm', 'exit 0');
  executable('git', `case "$*" in *'remote get-url origin'*) echo https://github.com/Trac-Systems/reset.git ;; *'rev-parse HEAD'*) echo ${wrongPin ? '0'.repeat(40) : PIN} ;; *'status --porcelain'*) exit 0 ;; *) echo 'unexpected fake git command' >&2; exit 10 ;; esac`);
  const walletDir=join(home,'.reset-signer'); const keystore=join(walletDir,'keystore.json');
  if(wallet) { mkdirSync(walletDir,{mode:0o700}); chmodSync(walletDir,directoryMode); writeFileSync(keystore,'FAKE TEST METADATA ONLY\n',{mode:0o600}); chmodSync(keystore,fileMode); }
  const run=args=>spawnSync('bash',[script,...args],{encoding:'utf8',timeout:10000,env:{HOME:home,PATH:bin+':'+process.env.PATH}});
  return { run, walletDir, keystore };
}
const linuxOnly={skip:process.platform!=='linux'};
test('Linux setup preserves an existing private wallet without changing its bytes',linuxOnly,t=>{
  const f=fixture(t); const before=readFileSync(f.keystore,'utf8'); const result=f.run([]);
  assert.equal(result.status,0,result.stderr); assert.equal(readFileSync(f.keystore,'utf8'),before);
});
test('dependency-only setup succeeds without silently creating a wallet',linuxOnly,t=>{
  const f=fixture(t,{wallet:false}); const result=f.run([]); assert.equal(result.status,0,result.stderr); assert.equal(existsSync(f.walletDir),false);
});
test('initialization refuses an existing wallet without overwriting',linuxOnly,t=>{
  const f=fixture(t); const result=f.run(['--initialize-wallet']); assert.equal(result.status,1); assert.match(result.stderr,/already exists/); assert.equal(readFileSync(f.keystore,'utf8'),'FAKE TEST METADATA ONLY\n');
});
for(const [label,options] of [['directory',{directoryMode:0o755}],['keystore',{fileMode:0o644}]]) test(`Linux setup rejects unsafe ${label} permissions`,linuxOnly,t=>{
  const f=fixture(t,options); const result=f.run([]); assert.equal(result.status,1); assert.match(result.stderr,/not private/);
});
test('Linux setup rejects a different upstream revision',linuxOnly,t=>{
  const f=fixture(t,{wrongPin:true}); const result=f.run([]); assert.equal(result.status,1); assert.match(result.stderr,/pinned commit/);
});
test('Linux setup rejects unexpected arguments before dependencies',linuxOnly,t=>{
  const f=fixture(t); const result=f.run(['--enable-worker']); assert.equal(result.status,2); assert.match(result.stderr,/Usage:/);
});
