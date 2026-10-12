'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPermissions } = require('../src/main/permissions');

function setup(opts = {}) {
  const timers = new Map();
  let seq = 0;
  let changes = 0;
  let t = 5000;
  const p = createPermissions({
    waitMs: 1000,
    guardMs: 600,
    now: () => t,
    ...opts,
    setTimer: (fn) => {
      const id = ++seq;
      timers.set(id, fn);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    makeId: () => `r${seq + 1}`,
    onChange: () => changes++,
  });
  return { p, timers, changes: () => changes, tick: (ms) => (t += ms) };
}

const OK = { sessionId: 's', complete: true };

test('decide responde una sola vez', () => {
  const { p, tick } = setup();
  const got = [];
  const id = p.add(OK, (d) => got.push(d));
  tick(700);
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

test('allow: rechazado si el texto no está completo', () => {
  const { p, tick } = setup();
  const got = [];
  const id = p.add({ complete: false }, (d) => got.push(d));
  tick(1000);
  assert.equal(p.decide(id, 'allow'), false);
  assert.equal(p.decide(id, 'deny'), true);
  assert.deepEqual(got, ['deny']);
});

test('allow: rechazado si el pedido acaba de aparecer; deny sí se acepta', () => {
  const { p, tick } = setup();
  const id = p.add(OK, () => {});
  tick(100);
  assert.equal(p.decide(id, 'allow'), false);
  tick(600);
  assert.equal(p.decide(id, 'allow'), true);
  const id2 = p.add(OK, () => {});
  assert.equal(p.decide(id2, 'deny'), true);
});

test('allow: el siguiente de la cola espera desde que quedó al frente (tecla mantenida)', () => {
  const { p, tick } = setup();
  const a = p.add(OK, () => {});
  const b = p.add(OK, () => {});
  tick(5000);
  assert.equal(p.decide(a, 'allow'), true);
  assert.equal(p.decide(b, 'allow'), false, 'b quedó al frente recién');
  tick(700);
  assert.equal(p.decide(b, 'allow'), true);
});

test('cola llena: add devuelve null', () => {
  const { p } = setup({ maxPending: 2 });
  assert.ok(p.add(OK, () => {}));
  assert.ok(p.add(OK, () => {}));
  assert.equal(
    p.add(OK, () => assert.fail('no debía entrar')),
    null,
  );
  assert.equal(p.size, 2);
});
