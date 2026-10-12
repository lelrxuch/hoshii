'use strict';

const fs = require('node:fs');
const net = require('node:net');
const { ensureSocketDir } = require('./paths');

/*
 * Servidor del socket Unix donde el hook entrega los eventos de Claude Code.
 *
 * Protocolo: el hook manda una línea JSON {"v":1,"event":{...}}. Si el evento es PermissionRequest,
 * la conexión queda abierta y la app responde una línea {"decision":"allow"|"deny"|"none"}.
 * Para los demás eventos la app cierra la conexión sin responder.
 *
 * El socket vive en un directorio 700 y el archivo queda en 600: solo tu usuario puede conectarse.
 */

const PROTOCOL = 1;
const MAX_LINE = 64 * 1024;
const FIRST_LINE_TIMEOUT_MS = 5000;
const EVENT_RE = /^[A-Za-z]{1,64}$/;
const SESSION_MAX = 200;
/** Conexiones simultáneas (cada pedido de permiso mantiene una abierta). */
const MAX_CONNECTIONS = 32;

/** Valida el mensaje del hook. Devuelve el evento o null. */
function parseMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || msg.v !== PROTOCOL) return null;
  const e = msg.event;
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  if (typeof e.hook_event_name !== 'string' || !EVENT_RE.test(e.hook_event_name)) return null;
  if (typeof e.session_id !== 'string' || !e.session_id || e.session_id.length > SESSION_MAX) return null;
  if (e.cwd !== undefined && typeof e.cwd !== 'string') return null;
  if (e.tool_name !== undefined && typeof e.tool_name !== 'string') return null;
  if (e.truncated !== undefined && typeof e.truncated !== 'boolean') return null;
  return e;
}

/** ¿Hay otra instancia escuchando en ese socket? */
function isListening(socketPath) {
  return new Promise((resolve) => {
    const c = net.connect(socketPath);
    c.once('connect', () => {
      c.destroy();
      resolve(true);
    });
    c.once('error', () => resolve(false));
  });
}

/**
 * @param {object} opts
 * @param {string} opts.socketPath
 * @param {(event: object) => void} opts.onEvent
 * @param {(event: object, respond: (d: string) => void) => (string|null)} opts.onPermission
 *        devuelve el id del pedido (o null si no se atiende: el hook sale sin decidir)
 * @param {(id: string) => void} opts.onPermissionClosed el hook cerró antes de recibir respuesta
 */
function createServer({ socketPath, onEvent, onPermission, onPermissionClosed }) {
  let server = null;

  function handle(socket) {
    let buf = '';
    let done = false;
    let requestId = null;
    let answered = false;
    socket.setEncoding('utf8');
    socket.setTimeout(FIRST_LINE_TIMEOUT_MS, () => socket.destroy());

    socket.on('data', (chunk) => {
      if (done) return;
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl === -1) {
        if (buf.length > MAX_LINE) socket.destroy();
        return;
      }
      done = true;
      const event = nl <= MAX_LINE ? parseMessage(buf.slice(0, nl)) : null;
      buf = '';
      if (!event) {
        socket.destroy();
        return;
      }
      if (event.hook_event_name !== 'PermissionRequest') {
        socket.end();
        onEvent(event);
        return;
      }
      const respond = (decision) => {
        if (answered || socket.destroyed) return;
        answered = true;
        socket.end(`${JSON.stringify({ decision })}\n`);
      };
      requestId = onPermission(event, respond);
      if (requestId) socket.setTimeout(0);
      else respond('none');
    });

    socket.on('close', () => {
      if (requestId && !answered) onPermissionClosed(requestId);
    });
    socket.on('error', () => {});
  }

  async function start() {
    ensureSocketDir(socketPath);
    let st = null;
    try {
      st = fs.lstatSync(socketPath);
    } catch {
      // no existe: bien
    }
    if (st) {
      if (!st.isSocket()) throw new Error(`${socketPath} existe y no es un socket; no lo toco`);
      if (await isListening(socketPath)) throw new Error('Hoshii ya está abierta');
      fs.unlinkSync(socketPath); // quedó de una ejecución que no cerró bien
    }
    server = net.createServer(handle);
    server.maxConnections = MAX_CONNECTIONS;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });
    fs.chmodSync(socketPath, 0o600);
  }

  function stop() {
    if (!server) return;
    server.close();
    server = null;
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // ya no estaba
    }
  }

  return { start, stop };
}

module.exports = { createServer, parseMessage, PROTOCOL, MAX_LINE, MAX_CONNECTIONS };
