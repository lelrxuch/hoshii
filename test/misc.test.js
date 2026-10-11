'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const paths = require('../src/main/paths');
const config = require('../src/main/config');
const { needsX11Relaunch } = require('../src/main/platform');
const { viewModel, relTime, DONE_MS } = require('../src/renderer/island');

/* ---------- paths ---------- */

test('socketPath: orden de búsqueda', () => {
  const never = () => false;
  const always = () => true;
  assert.equal(paths.socketPath({ env: { HOSHII_SOCKET: '/x.sock' }, uid: 1 }), '/x.sock');
  assert.equal(
    paths.socketPath({ env: { XDG_RUNTIME_DIR: '/run/user/1000' }, uid: 1000 }),
    '/run/user/1000/hoshii/hoshii.sock',
  );
  assert.equal(
    paths.socketPath({ env: {}, uid: 1000, isUsable: always }),
    '/run/user/1000/hoshii/hoshii.sock',
  );
  assert.equal(
    paths.socketPath({ env: { XDG_RUNTIME_DIR: 'relativo' }, uid: 1000, isUsable: never }),
    '/tmp/hoshii-1000/hoshii.sock',
  );
});

test('dataDir y claudeSettingsPath respetan XDG_DATA_HOME y CLAUDE_CONFIG_DIR', () => {
  assert.equal(paths.dataDir({}, '/home/u'), '/home/u/.local/share/hoshii');
  assert.equal(paths.dataDir({ XDG_DATA_HOME: '/d' }, '/home/u'), '/d/hoshii');
  assert.equal(paths.claudeSettingsPath({}, '/home/u'), '/home/u/.claude/settings.json');
  assert.equal(paths.claudeSettingsPath({ CLAUDE_CONFIG_DIR: '/c' }, '/home/u'), '/c/settings.json');
});

test('ensureSocketDir crea con 700 y corrige permisos de un directorio propio', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshii-dir-'));
  const sock = path.join(dir, 'run', 'hoshii.sock');
  paths.ensureSocketDir(sock);
  assert.equal(fs.statSync(path.dirname(sock)).mode & 0o777, 0o700);
  fs.chmodSync(path.dirname(sock), 0o755);
  paths.ensureSocketDir(sock);
  assert.equal(fs.statSync(path.dirname(sock)).mode & 0o777, 0o700);
});

test('ensureSocketDir rechaza un enlace simbólico', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshii-lnk-'));
  fs.mkdirSync(path.join(dir, 'real'), { mode: 0o700 });
  fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'run'));
  assert.throws(() => paths.ensureSocketDir(path.join(dir, 'run', 'hoshii.sock')), /no es seguro/);
});

/* ---------- config ---------- */

test('config.validate descarta valores inválidos', () => {
  assert.deepEqual(config.validate(null), config.DEFAULTS);
  const v = config.validate({ approvals: false, waitSeconds: 5, notifyDone: 'si', shortcuts: false });
  assert.equal(v.approvals, false);
  assert.equal(v.shortcuts, false);
  assert.equal(v.notifyDone, true);
  assert.equal(v.waitSeconds, config.DEFAULTS.waitSeconds);
  assert.equal(config.validate({ waitSeconds: 120 }).waitSeconds, 120);
});

test('config store guarda y carga', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshii-cfg-'));
  const s = config.createStore(dir);
  assert.deepEqual(s.load(), config.DEFAULTS);
  s.save({ ...config.DEFAULTS, approvals: false });
  assert.equal(s.load().approvals, false);
});

/* ---------- X11 ---------- */

test('needsX11Relaunch', () => {
  assert.equal(needsX11Relaunch({ platform: 'linux', ozone: '', env: { DISPLAY: ':0' } }), true);
  assert.equal(needsX11Relaunch({ platform: 'linux', ozone: 'x11', env: { DISPLAY: ':0' } }), false);
  assert.equal(needsX11Relaunch({ platform: 'linux', ozone: '', env: {} }), false);
  assert.equal(
    needsX11Relaunch({ platform: 'linux', ozone: '', env: { DISPLAY: ':0', HOSHII_X11_RELAUNCH: '1' } }),
    false,
  );
});

/* ---------- isla ---------- */

const NOW = 100000;
const sess = (over) => ({
  id: 'a',
  project: 'hoshii',
  state: 'work',
  verb: 'Ejecutando',
  detail: 'npm test',
  since: NOW - 1000,
  updatedAt: NOW - 1000,
  ...over,
});

test('isla vacía', () => {
  const vm = viewModel({ installed: true }, NOW, false);
  assert.equal(vm.mascot, 'idle');
  assert.equal(vm.line, 'Sin sesiones de Claude Code');
  assert.equal(vm.wide, false);
  assert.equal(vm.badge, null);
});

test('sin conectar muestra la tarjeta de conexión', () => {
  const vm = viewModel({ installed: false }, NOW, false);
  assert.equal(vm.showConnect, true);
  assert.equal(vm.wide, true);
});

test('una sesión trabajando', () => {
  const vm = viewModel({ installed: true, sessions: [sess()] }, NOW, false);
  assert.equal(vm.mascot, 'work');
  assert.equal(vm.title, 'hoshii');
  assert.equal(vm.line, 'Ejecutando: npm test');
});

test('un permiso pendiente manda sobre todo', () => {
  const pending = [
    { id: 'r', project: 'web', action: 'ejecutar', text: 'rm -rf dist' },
    { id: 'r2', project: 'x' },
  ];
  const vm = viewModel({ installed: true, sessions: [sess()], pending }, NOW, true);
  assert.equal(vm.mascot, 'ask');
  assert.equal(vm.title, 'web');
  assert.equal(vm.ask.id, 'r');
  assert.deepEqual(vm.badge, { text: '2', ask: true });
  assert.equal(vm.showList, false, 'con un permiso no se abre la lista');
});

test('terminó: celebra un rato y luego reposo', () => {
  assert.equal(
    viewModel({ installed: true, sessions: [sess({ state: 'done', since: NOW - 1000 })] }, NOW).mascot,
    'done',
  );
  assert.equal(
    viewModel({ installed: true, sessions: [sess({ state: 'done', since: NOW - DONE_MS - 1 })] }, NOW).mascot,
    'idle',
  );
});

test('hover abre la lista con varias sesiones', () => {
  const vm = viewModel({ installed: true, sessions: [sess(), sess({ id: 'b', state: 'idle' })] }, NOW, true);
  assert.equal(vm.showList, true);
  assert.equal(vm.sessions.length, 2);
  assert.deepEqual(vm.badge, { text: '2', ask: false });
});

test('relTime', () => {
  assert.equal(relTime(5000), 'ahora');
  assert.equal(relTime(5 * 60 * 1000), 'hace 5 min');
  assert.equal(relTime(3 * 3600 * 1000), 'hace 3 h');
});
