'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPermissions } = require('../src/main/permissions');

function setup() {
  const timers = new Map();
  let seq = 0;
  let changes = 0;
  const p = createPermissions({
    waitMs: 1000,
    now: () => 5000,
    setTimer: (fn) => {
      const id = ++seq;
      timers.set(id, fn);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    makeId: () => `r${seq + 1}`,
    onChange: () => changes++,
  });
  return { p, timers, changes: () => changes };
}

test('decide responde una sola vez', () => {
  const { p } = setup();
  const got = [];
  const id = p.add({ sessionId: 's' }, (d) => got.push(d));
  assert.equal(p.size, 1);
  assert.equal(p.decide(id, 'allow'), true);
  assert.equal(p.decide(id, 'deny'), false);
  assert.deepEqual(got, ['allow']);
  assert.equal(p.size, 0);
});

test('decisiones inválidas se rechazan', () => {
  const { p } = setup();
  const id = p.add({}, () => assert.fail('no debía responder'));
  assert.equal(p.decide(id, 'yes'), false);
  assert.equal(p.decide(42, 'allow'), false);
  assert.equal(p.size, 1);
});

test('al vencer el plazo responde none (la terminal pregunta), nunca allow', () => {
  const { p, timers } = setup();
  const got = [];
  p.add({}, (d) => got.push(d));
  [...timers.values()][0]();
  assert.deepEqual(got, ['none']);
  assert.equal(p.size, 0);
});

test('drop quita sin responder y limpia el temporizador', () => {
  const { p, timers } = setup();
  const id = p.add({}, () => assert.fail('no debía responder'));
  assert.equal(p.drop(id), true);
  assert.equal(timers.size, 0);
});

test('releaseAll devuelve todo a la terminal', () => {
  const { p } = setup();
  const got = [];
  p.add({}, (d) => got.push(d));
  p.add({}, (d) => got.push(d));
  p.releaseAll();
  assert.deepEqual(got, ['none', 'none']);
});

test('list incluye id y plazos; sessionOf', () => {
  const { p } = setup();
  const id = p.add({ sessionId: 's1', project: 'x' }, () => {});
  const [info] = p.list();
  assert.equal(info.id, id);
  assert.equal(info.expiresAt - info.createdAt, 1000);
  assert.equal(p.sessionOf(id), 's1');
  assert.equal(p.sessionOf('nada'), null);
});

test('un respond que lanza no rompe la cola', () => {
  const { p } = setup();
  const id = p.add({}, () => {
    throw new Error('socket cerrado');
  });
  assert.equal(p.decide(id, 'deny'), true);
  assert.equal(p.size, 0);
});
