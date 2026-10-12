'use strict';

/*
 * Prueba de punta a punta: el hook real (assets/hook.py) contra el servidor real, como lo haría
 * Claude Code. Requiere python3.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createServer, parseMessage } = require('../src/main/server');

const HOOK = path.join(__dirname, '..', 'assets', 'hook.py');

function runHook(socketPath, input) {
  return new Promise((resolve) => {
    const p = spawn('python3', [HOOK], { env: { ...process.env, HOSHII_SOCKET: socketPath } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
    p.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}

async function withServer(handlers, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshii-srv-'));
  const socketPath = path.join(dir, 'run', 'hoshii.sock');
  const events = [];
  const server = createServer({
    socketPath,
    onEvent: (e) => events.push(e),
    onPermission: handlers.onPermission || (() => null),
    onPermissionClosed: handlers.onPermissionClosed || (() => {}),
  });
  await server.start();
  try {
    await fn({ socketPath, events, dir });
  } finally {
    server.stop();
  }
}

const base = { session_id: 's1', cwd: '/p/x', transcript_path: '/secreto', prompt: 'texto privado' };

test('parseMessage valida lo mínimo', () => {
  const ok = { v: 1, event: { session_id: 'a', hook_event_name: 'Stop' } };
  assert.ok(parseMessage(JSON.stringify(ok)));
  assert.equal(parseMessage('no json'), null);
  assert.equal(parseMessage(JSON.stringify({ ...ok, v: 2 })), null);
  assert.equal(
    parseMessage(JSON.stringify({ v: 1, event: { session_id: 'a', hook_event_name: 'x y' } })),
    null,
  );
  assert.equal(
    parseMessage(JSON.stringify({ v: 1, event: { session_id: '', hook_event_name: 'Stop' } })),
    null,
  );
  assert.equal(parseMessage(JSON.stringify({ v: 1, event: { ...ok.event, cwd: 3 } })), null);
  assert.equal(parseMessage(JSON.stringify({ v: 1, event: { ...ok.event, truncated: 'si' } })), null);
});

test('socket y directorio con permisos de solo el usuario', async () => {
  await withServer({}, async ({ socketPath }) => {
    assert.equal(fs.statSync(socketPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(socketPath)).mode & 0o777, 0o700);
  });
});

test('eventos normales llegan sin campos privados y el hook no imprime nada', async () => {
  await withServer({}, async ({ socketPath, events }) => {
    const r = await runHook(socketPath, { ...base, hook_event_name: 'UserPromptSubmit' });
    assert.deepEqual(r, { code: 0, out: '' });
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(events.length, 1);
    assert.equal(events[0].hook_event_name, 'UserPromptSubmit');
    assert.equal(events[0].prompt, undefined);
    assert.equal(events[0].transcript_path, undefined);
  });
});

for (const decision of ['allow', 'deny']) {
  test(`PermissionRequest: ${decision} desde la isla`, async () => {
    let seen = null;
    const onPermission = (e, respond) => {
      seen = e;
      setTimeout(() => respond(decision), 20);
      return 'req1';
    };
    await withServer({ onPermission }, async ({ socketPath }) => {
      const r = await runHook(socketPath, {
        ...base,
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_input: { command: 'x'.repeat(5000) },
      });
      assert.equal(r.code, 0);
      const out = JSON.parse(r.out);
      assert.equal(out.hookSpecificOutput.hookEventName, 'PermissionRequest');
      assert.equal(out.hookSpecificOutput.decision.behavior, decision);
      assert.ok(seen.tool_input.command.length <= 2001, 'el hook recorta textos largos');
    });
  });
}

test('PermissionRequest: none o sin atender → el hook no decide', async () => {
  await withServer(
    { onPermission: (_e, respond) => (setTimeout(() => respond('none'), 10), 'r') },
    async ({ socketPath }) => {
      const r = await runHook(socketPath, {
        ...base,
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
      });
      assert.deepEqual(r, { code: 0, out: '' });
    },
  );
  await withServer({ onPermission: () => null }, async ({ socketPath }) => {
    const r = await runHook(socketPath, { ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
    assert.deepEqual(r, { code: 0, out: '' });
  });
});

test('si el hook se corta antes de la respuesta, la app se entera', async () => {
  let closed = null;
  const onPermission = () => 'req9';
  await withServer({ onPermission, onPermissionClosed: (id) => (closed = id) }, async ({ socketPath }) => {
    const c = net.connect(socketPath);
    await new Promise((res) => c.once('connect', res));
    c.write(
      `${JSON.stringify({ v: 1, event: { session_id: 's', hook_event_name: 'PermissionRequest' } })}\n`,
    );
    await new Promise((res) => setTimeout(res, 50));
    c.destroy();
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(closed, 'req9');
  });
});

test('el hook marca truncated cuando recorta la entrada', async () => {
  let seen = null;
  const onPermission = (e, respond) => {
    seen = e;
    respond('none');
    return 'r';
  };
  await withServer({ onPermission }, async ({ socketPath }) => {
    await runHook(socketPath, {
      ...base,
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    });
    assert.equal(seen.truncated, undefined);
    await runHook(socketPath, {
      ...base,
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: `ls ${'x'.repeat(3000)}` },
    });
    assert.equal(seen.truncated, true);
  });
});

test('el hook no se conecta si el directorio del socket no es seguro', async () => {
  await withServer({}, async ({ socketPath, events }) => {
    fs.chmodSync(path.dirname(socketPath), 0o755); // como si otro lo hubiera preparado
    const r = await runHook(socketPath, { ...base, hook_event_name: 'Stop' });
    assert.deepEqual(r, { code: 0, out: '' });
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(events.length, 0);
    fs.chmodSync(path.dirname(socketPath), 0o700);
  });
});

test('el hook no se conecta a algo que no es un socket', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshii-nosock-'));
  const fake = path.join(dir, 'hoshii.sock');
  fs.writeFileSync(fake, '');
  assert.deepEqual(await runHook(fake, { ...base, hook_event_name: 'PermissionRequest' }), {
    code: 0,
    out: '',
  });
});

test('sin la app abierta el hook sale rápido y sin decidir', async () => {
  const start = Date.now();
  const r = await runHook('/tmp/hoshii-no-existe.sock', { ...base, hook_event_name: 'PermissionRequest' });
  assert.deepEqual(r, { code: 0, out: '' });
  assert.ok(Date.now() - start < 3000);
});

test('entrada basura: el hook no falla', async () => {
  for (const input of ['', 'no json', '[1,2]', '{"hook_event_name": 3}']) {
    assert.deepEqual(await runHook('/tmp/hoshii-no-existe.sock', input), { code: 0, out: '' });
  }
});

test('mensajes enormes o inválidos se descartan', async () => {
  await withServer({}, async ({ socketPath, events }) => {
    for (const payload of ['x'.repeat(70 * 1024), 'basura\n']) {
      const c = net.connect(socketPath);
      await new Promise((res) => c.once('connect', res));
      c.on('error', () => {});
      c.write(payload);
      await new Promise((res) => c.once('close', res));
    }
    assert.equal(events.length, 0);
  });
});

test('un socket viejo se reemplaza; otra instancia viva se respeta', async () => {
  await withServer({}, async ({ socketPath }) => {
    const second = createServer({
      socketPath,
      onEvent() {},
      onPermission: () => null,
      onPermissionClosed() {},
    });
    await assert.rejects(second.start(), /ya está abierta/);
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshii-stale-'));
  const socketPath = path.join(dir, 'hoshii.sock');
  fs.chmodSync(dir, 0o700);
  const stale = net.createServer().listen(socketPath);
  await new Promise((res) => stale.once('listening', res));
  // Simula un cierre brusco: el archivo queda pero nadie escucha.
  stale.close();
  await new Promise((res) => setTimeout(res, 20));
  if (!fs.existsSync(socketPath)) return; // Node lo borró al cerrar: nada que probar en este sistema
  const s = createServer({ socketPath, onEvent() {}, onPermission: () => null, onPermissionClosed() {} });
  await s.start();
  s.stop();
});

test('se niega a borrar un archivo que no es socket', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshii-file-'));
  fs.chmodSync(dir, 0o700);
  const socketPath = path.join(dir, 'hoshii.sock');
  fs.writeFileSync(socketPath, 'no soy un socket');
  const s = createServer({ socketPath, onEvent() {}, onPermission: () => null, onPermissionClosed() {} });
  await assert.rejects(s.start(), /no es un socket/);
  assert.equal(fs.readFileSync(socketPath, 'utf8'), 'no soy un socket');
});
