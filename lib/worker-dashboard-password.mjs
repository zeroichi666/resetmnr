// Password is entered only in the foreground local TTY, never in HTTP or logs.
export function readTerminalPassword({ signal, input = process.stdin, output = process.stdout } = {}) {
  signal?.throwIfAborted();
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') return Promise.reject(new Error('Interactive terminal required'));
  return new Promise((resolve, reject) => {
    let password = '', finished = false;
    const wasRaw = input.isRaw;
    function finish(error) {
      if (finished) return; finished = true;
      input.off('data', onData); input.off('end', onEnd); input.off('error', onEnd); signal?.removeEventListener('abort', onAbort);
      input.setRawMode(Boolean(wasRaw)); input.pause(); output.write('\n');
      const value = password; password = '';
      if (error) reject(error); else resolve(value);
    }
    const onAbort = () => finish(new Error('Password entry cancelled'));
    const onEnd = () => finish(new Error('Terminal closed'));
    function onData(chunk) {
      for (const ch of String(chunk)) {
        if (ch === '\u0003' || ch === '\u001b' || ch === '\u0004') return finish(new Error('Password entry cancelled'));
        if (ch === '\r' || ch === '\n') return finish(password ? null : new Error('Password required'));
        if (ch === '\u007f' || ch === '\b') { password = [...password].slice(0, -1).join(''); continue; }
        if (ch.charCodeAt(0) < 32) continue;
        password += ch;
        if (password.length > 1024) return finish(new Error('Password too long'));
      }
    }
    input.setEncoding('utf8');
    input.on('data', onData); input.once('end', onEnd); input.once('error', onEnd); signal?.addEventListener('abort', onAbort, { once: true });
    input.setRawMode(true);
    if (signal?.aborted) return onAbort();
    output.write('Password wallet lokal (tidak ditampilkan; Esc membatalkan): ');
    input.resume();
  });
}
