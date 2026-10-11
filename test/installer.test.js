'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const inst = require('../src/main/installer');

const HOOK_SOURCE = path.join(__dirname, '..', 'assets', 'hook.py');

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshii-inst-'));
  return {
    dir,
    settingsPath: path.join(dir, '.claude', 'settings.json'),
    hookFile: path.join(dir, 'share', 'hoshii', 'hook.py'),
    hookSource: HOOK_SOURCE,
    date: new Date(2026, 9, 11, 1, 2, 3),
  };
}

const CMD = inst.hookCommand('/home/u/.local/share/hoshii/hook.py');

test('hookCommand entrecomilla y escapa', () => {
  assert.equal(CMD, 'python3 "/home/u/.local/share/hoshii/hook.py"');
  assert.equal(inst.hookCommand('/a b/"$x`/hoshii/hook.py'), 'python3 "/a b/\\"\\$x\\`/hoshii/hook.py"');
});

test('addHooks agrega todos los eventos y conserva lo demás', () => {
  const own = { type: 'command', command: 'mi-script.sh' };
  const s = { model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [own] }] } };
  const out = inst.addHooks(s, CMD);
  assert.equal(out.model, 'opus');
  assert.deepEqual(out.hooks.PreToolUse[0], { matcher: 'Bash', hooks: [own] });
  for (const e of inst.EVENTS)
    assert.ok(
      out.hooks[e].some((g) => g.hooks.some((h) => h.command === CMD)),
      e,
    );
  assert.equal(inst.isInstalled(out, CMD), true);
  assert.deepEqual(s.hooks.PreToolUse.length, 1, 'no modifica el original');
});

test('solo PermissionRequest y SessionEnd son síncronos', () => {
  const out = inst.addHooks({}, CMD);
  const h = (e) => out.hooks[e][0].hooks[0];
  assert.equal(h('PermissionRequest').async, undefined);
  assert.equal(h('SessionEnd').async, undefined);
  assert.equal(h('PreToolUse').async, true);
  assert.ok(h('PermissionRequest').timeout > 320);
});

test('addHooks es idempotente y reemplaza un comando viejo', () => {
  const once = inst.addHooks({}, 'python3 "/viejo/hoshii/hook.py"');
  const twice = inst.addHooks(inst.addHooks(once, CMD), CMD);
  for (const e of inst.EVENTS) assert.equal(twice.hooks[e].length, 1, e);
  assert.equal(inst.isInstalled(twice, CMD), true);
  assert.equal(inst.isInstalled(once, CMD), false);
});

test('removeHooks deja solo lo ajeno y limpia lo vacío', () => {
  const own = { type: 'command', command: 'mi-script.sh' };
  const s = inst.addHooks({ hooks: { Stop: [{ hooks: [own] }] } }, CMD);
  const out = inst.removeHooks(s);
  assert.deepEqual(out, { hooks: { Stop: [{ hooks: [own] }] } });
  assert.deepEqual(inst.removeHooks(inst.addHooks({}, CMD)), {});
});

test('hooks con forma inesperada: no se tocan', () => {
  assert.throws(() => inst.addHooks({ hooks: [] }, CMD), /no es un objeto/);
  assert.throws(() => inst.addHooks({ hooks: { Stop: {} } }, CMD), /no es una lista/);
});

test('apply install: crea settings, copia el hook y no respalda lo que no existía', () => {
  const t = tmp();
  const r = inst.apply('install', t);
  assert.deepEqual(r, { changed: true, backupPath: null });
  const settings = JSON.parse(fs.readFileSync(t.settingsPath, 'utf8'));
  assert.equal(inst.isInstalled(settings, inst.hookCommand(t.hookFile)), true);
  assert.equal(fs.readFileSync(t.hookFile, 'utf8'), fs.readFileSync(HOOK_SOURCE, 'utf8'));
  assert.equal(fs.statSync(t.settingsPath).mode & 0o777, 0o600);
  assert.equal(inst.status(t), true);
  assert.deepEqual(inst.apply('install', t), { changed: false, backupPath: null });
});

test('apply respalda el archivo existente y conserva sus permisos', () => {
  const t = tmp();
  fs.mkdirSync(path.dirname(t.settingsPath), { recursive: true });
  fs.writeFileSync(t.settingsPath, '{ "model": "opus" }\n', { mode: 0o644 });
  fs.chmodSync(t.settingsPath, 0o644);
  const r = inst.apply('install', t);
  assert.match(r.backupPath, /settings\.json\.hoshii-20261011-010203\.bak$/);
  assert.equal(fs.readFileSync(r.backupPath, 'utf8'), '{ "model": "opus" }\n');
  assert.equal(fs.statSync(t.settingsPath).mode & 0o777, 0o644);
  const back = inst.apply('uninstall', { ...t, date: new Date(2026, 9, 11, 1, 2, 4) });
  assert.equal(back.changed, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(t.settingsPath, 'utf8')), { model: 'opus' });
  assert.equal(inst.status(t), false);
});

test('settings.json inválido no se modifica', () => {
  const t = tmp();
  fs.mkdirSync(path.dirname(t.settingsPath), { recursive: true });
  fs.writeFileSync(t.settingsPath, '{ roto');
  assert.throws(() => inst.apply('install', t), /no es JSON válido/);
  assert.equal(fs.readFileSync(t.settingsPath, 'utf8'), '{ roto');
  assert.equal(inst.status(t), false);
  fs.writeFileSync(t.settingsPath, '[1]');
  assert.throws(() => inst.apply('install', t), /no contiene un objeto/);
});

test('respeta settings.json como enlace simbólico (dotfiles)', () => {
  const t = tmp();
  const real = path.join(t.dir, 'dotfiles', 'settings.json');
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.writeFileSync(real, '{}');
  fs.mkdirSync(path.dirname(t.settingsPath), { recursive: true });
  fs.symlinkSync(real, t.settingsPath);
  inst.apply('install', t);
  assert.ok(fs.lstatSync(t.settingsPath).isSymbolicLink(), 'el enlace sigue siendo enlace');
  assert.equal(
    inst.isInstalled(JSON.parse(fs.readFileSync(real, 'utf8')), inst.hookCommand(t.hookFile)),
    true,
  );
});

test('syncHookFile solo escribe si cambió', () => {
  const t = tmp();
  assert.equal(inst.syncHookFile(HOOK_SOURCE, t.hookFile), true);
  assert.equal(inst.syncHookFile(HOOK_SOURCE, t.hookFile), false);
  fs.writeFileSync(t.hookFile, 'viejo');
  assert.equal(inst.syncHookFile(HOOK_SOURCE, t.hookFile), true);
});
