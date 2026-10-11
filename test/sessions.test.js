'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessions, STALE_MS, MAX_SESSIONS } = require('../src/main/sessions');

function setup() {
  let t = 1000;
  const s = createSessions({ now: () => t });
  return { s, tick: (ms) => (t += ms) };
}

const ev = (name, extra = {}) => ({ session_id: 'a', cwd: '/p/hoshii', hook_event_name: name, ...extra });

test('ciclo normal de una sesión', () => {
  const { s } = setup();
  s.apply(ev('SessionStart'));
  assert.equal(s.get('a').state, 'idle');
  assert.equal(s.get('a').project, 'hoshii');
  s.apply(ev('UserPromptSubmit'));
  assert.equal(s.get('a').state, 'work');
  s.apply(ev('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } }));
  assert.deepEqual([s.get('a').verb, s.get('a').detail], ['Ejecutando', 'npm test']);
  s.apply(ev('PostToolUse', { tool_name: 'Bash' }));
  assert.equal(s.get('a').verb, 'Pensando');
  s.apply(ev('Stop'));
  assert.equal(s.get('a').state, 'done');
  assert.equal(s.apply(ev('SessionEnd')), true);
  assert.equal(s.get('a'), null);
});

test('un evento sin SessionStart crea la sesión', () => {
  const { s } = setup();
  s.apply(ev('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/p/hoshii/a.js' } }));
  assert.equal(s.get('a').detail, 'a.js');
});

test('permiso: ask y vuelve a work al resolverse', () => {
  const { s } = setup();
  s.apply(ev('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf dist' } }));
  assert.equal(s.get('a').state, 'ask');
  assert.equal(s.resolved('a'), true);
  assert.equal(s.get('a').state, 'work');
  assert.equal(s.resolved('a'), false);
});

test('la notificación de permiso no pisa el detalle de PermissionRequest', () => {
  const { s } = setup();
  s.apply(ev('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'make' } }));
  s.apply(ev('Notification', { notification_type: 'permission_prompt', message: 'Claude needs permission' }));
  assert.equal(s.get('a').detail, 'make');
});

test('notificación de permiso sin hook de permiso: la terminal pregunta', () => {
  const { s } = setup();
  s.apply(ev('UserPromptSubmit'));
  s.apply(
    ev('Notification', { notification_type: 'permission_prompt', message: 'Needs permission to use Bash' }),
  );
  assert.equal(s.get('a').state, 'ask');
  assert.equal(s.get('a').verb, 'Te pregunta en la terminal');
});

test('idle_prompt vuelve a reposo; StopFailure es error', () => {
  const { s } = setup();
  s.apply(ev('Notification', { notification_type: 'idle_prompt', message: 'waiting' }));
  assert.equal(s.get('a').state, 'idle');
  s.apply(ev('StopFailure', { message: 'rate limit' }));
  assert.equal(s.get('a').state, 'error');
  assert.equal(s.get('a').detail, 'rate limit');
});

test('eventos desconocidos no cambian nada visible', () => {
  const { s } = setup();
  assert.equal(s.apply(ev('Inventado')), false);
});

test('orden: primero quien pide permiso, luego lo más reciente', () => {
  const { s, tick } = setup();
  s.apply({ ...ev('UserPromptSubmit'), session_id: 'x' });
  tick(10);
  s.apply({ ...ev('PermissionRequest', { tool_name: 'Bash' }), session_id: 'y' });
  tick(10);
  s.apply({ ...ev('Stop'), session_id: 'z' });
  assert.deepEqual(
    s.list().map((x) => x.id),
    ['y', 'x', 'z'],
  );
});

test('since cambia solo cuando cambia el estado', () => {
  const { s, tick } = setup();
  s.apply(ev('UserPromptSubmit'));
  const since = s.get('a').since;
  tick(500);
  s.apply(ev('PreToolUse', { tool_name: 'Bash' }));
  assert.equal(s.get('a').since, since);
});

test('prune quita sesiones abandonadas', () => {
  const { s, tick } = setup();
  s.apply(ev('SessionStart'));
  tick(STALE_MS + 1);
  assert.equal(s.prune(), true);
  assert.equal(s.list().length, 0);
});

test('límite de sesiones: se descarta la más vieja', () => {
  const { s, tick } = setup();
  for (let i = 0; i <= MAX_SESSIONS; i++) {
    s.apply({ ...ev('SessionStart'), session_id: `s${i}` });
    tick(1);
  }
  assert.equal(s.list().length, MAX_SESSIONS);
  assert.equal(s.get('s0'), null);
});

test('list devuelve copias', () => {
  const { s } = setup();
  s.apply(ev('SessionStart'));
  s.list()[0].state = 'error';
  assert.equal(s.get('a').state, 'idle');
});
