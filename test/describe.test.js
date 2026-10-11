'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { describeTool, requestText, requestAction, projectName, DETAIL_MAX } = require('../src/main/describe');

test('Bash muestra el comando', () => {
  assert.deepEqual(describeTool('Bash', { command: 'npm test' }), { verb: 'Ejecutando', detail: 'npm test' });
});

test('archivos dentro del proyecto se muestran relativos', () => {
  const r = describeTool('Edit', { file_path: '/home/isai/p/src/main.js' }, '/home/isai/p');
  assert.equal(r.detail, 'src/main.js');
});

test('archivos fuera del proyecto muestran solo el nombre', () => {
  const r = describeTool('Read', { file_path: '/etc/hosts' }, '/home/isai/p');
  assert.equal(r.detail, 'hosts');
});

test('WebFetch muestra el host', () => {
  assert.equal(
    describeTool('WebFetch', { url: 'https://docs.example.com/a?b=1' }).detail,
    'docs.example.com',
  );
});

test('herramientas MCP muestran servidor y herramienta', () => {
  assert.deepEqual(describeTool('mcp__github__create_issue', {}), {
    verb: 'Usando',
    detail: 'github · create_issue',
  });
});

test('entradas raras no rompen', () => {
  assert.deepEqual(describeTool(undefined, null), { verb: 'Usando', detail: '' });
  assert.deepEqual(describeTool('Bash', { command: 42 }), { verb: 'Ejecutando', detail: '' });
});

test('el detalle se recorta y colapsa espacios', () => {
  const r = describeTool('Bash', { command: `echo ${'x'.repeat(500)}\n\nls` });
  assert.equal(r.detail.length, DETAIL_MAX);
  assert.ok(!r.detail.includes('\n'));
});

test('requestText conserva el comando completo con saltos de línea', () => {
  assert.equal(requestText('Bash', { command: 'git add .\ngit commit -m x' }), 'git add .\ngit commit -m x');
});

test('requestText de herramientas desconocidas cae al JSON', () => {
  assert.equal(requestText('Rara', {}), 'Rara');
  assert.equal(requestText('', { a: 1 }), '{"a":1}');
});

test('requestAction', () => {
  assert.equal(requestAction('Bash'), 'ejecutar');
  assert.equal(requestAction('mcp__notion__search'), 'usar notion');
  assert.equal(requestAction('Rara'), 'usar Rara');
});

test('projectName', () => {
  assert.equal(projectName('/home/isai/Proyectos/hoshii/'), 'hoshii');
  assert.equal(projectName(''), 'Claude Code');
});
