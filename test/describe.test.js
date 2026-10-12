'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  describeTool,
  requestInfo,
  requestAction,
  projectName,
  shortPath,
  reveal,
  DETAIL_MAX,
  REQUEST_MAX,
} = require('../src/main/describe');

test('Bash muestra el comando', () => {
  assert.deepEqual(describeTool('Bash', { command: 'npm test' }), { verb: 'Ejecutando', detail: 'npm test' });
});

test('archivos dentro del proyecto se muestran relativos', () => {
  const r = describeTool('Edit', { file_path: '/home/isai/p/src/main.js' }, '/home/isai/p');
  assert.equal(r.detail, 'src/main.js');
});

test('archivos fuera del proyecto muestran la ruta completa, con ~ en la carpeta personal', () => {
  assert.equal(describeTool('Read', { file_path: '/etc/hosts' }, '/home/isai/p').detail, '/etc/hosts');
  assert.equal(
    shortPath('/home/isai/.ssh/authorized_keys', '/home/isai/p', '/home/isai'),
    '~/.ssh/authorized_keys',
  );
  assert.equal(shortPath('/home/isai/p/../q/x.js', '/home/isai/p', '/home/isai'), '~/q/x.js');
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

const HOME = '/home/isai';

test('requestInfo: el comando completo con saltos de línea', () => {
  assert.deepEqual(requestInfo('Bash', { command: 'git add .\ngit commit -m x' }, '/p', { home: HOME }), {
    text: 'git add .\ngit commit -m x',
    complete: true,
    outside: false,
    hidden: 0,
  });
});

test('requestInfo: archivo fuera del proyecto se marca y muestra la ruta real', () => {
  const r = requestInfo('Write', { file_path: '/home/isai/.ssh/authorized_keys' }, '/home/isai/p', {
    home: HOME,
  });
  assert.equal(r.text, '~/.ssh/authorized_keys');
  assert.equal(r.outside, true);
  const inside = requestInfo('Edit', { file_path: '/home/isai/p/src/a.js' }, '/home/isai/p', { home: HOME });
  assert.deepEqual([inside.text, inside.outside], ['src/a.js', false]);
});

test('requestInfo: recortado por el hook o muy largo → no completo', () => {
  assert.equal(requestInfo('Bash', { command: 'ls' }, '/p', { truncated: true }).complete, false);
  const long = requestInfo('Bash', { command: 'x'.repeat(REQUEST_MAX + 10) }, '/p');
  assert.equal(long.complete, false);
  assert.equal(long.text.length, REQUEST_MAX);
});

test('requestInfo: MCP y desconocidas muestran todos sus argumentos', () => {
  const r = requestInfo('mcp__github__delete_repo', { repo: 'lelrxuch/hoshii' }, '/p');
  assert.match(r.text, /^mcp__github__delete_repo\n/);
  assert.match(r.text, /"repo": "lelrxuch\/hoshii"/);
  assert.equal(requestInfo('Rara', {}, '/p').text, 'Rara');
});

test('caracteres invisibles y bidi se marcan', () => {
  const r = requestInfo('Bash', { command: 'echo hola\u202e;rm -rf ~\u200b' }, '/p');
  assert.equal(r.text, 'echo hola⟨U+202E⟩;rm -rf ~⟨U+200B⟩');
  assert.equal(r.hidden, 2);
  assert.deepEqual(reveal('a\tb\nc'), { text: 'a\tb\nc', hidden: 0 }, 'tab y salto de línea se respetan');
  assert.equal(reveal('\u001b[31m').hidden, 1, 'escapes ANSI se marcan');
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
