'use strict';

const { randomUUID } = require('node:crypto');

/*
 * Pedidos de permiso que esperan tu respuesta. Cada pedido tiene una conexión abierta con el hook;
 * `respond` le manda la decisión exactamente una vez.
 *
 * Decisiones: 'allow', 'deny' o 'none'. 'none' significa "no decido": el hook sale sin imprimir nada
 * y Claude Code pregunta en la terminal. Se usa al vencer el plazo, al elegir "Responder en la
 * terminal" y al cerrar la app. Nunca se permite nada por omisión.
 */

const DECISIONS = new Set(['allow', 'deny', 'none']);

function createPermissions({
  waitMs,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  makeId = randomUUID,
  onChange = () => {},
}) {
  /** @type {Map<string, { info: object, respond: Function, timer: any }>} */
  const pending = new Map();

  function finish(id, decision, notify) {
    const p = pending.get(id);
    if (!p) return false;
    pending.delete(id);
    clearTimer(p.timer);
    if (notify) {
      try {
        p.respond(decision);
      } catch {
        // La conexión ya se cerró: Claude Code seguirá por su cuenta.
      }
    }
    onChange();
    return true;
  }

  /**
   * Agrega un pedido. `info`: { sessionId, project, tool, verb, text }.
   * @returns {string} id del pedido
   */
  function add(info, respond) {
    const id = makeId();
    const createdAt = now();
    const timer = setTimer(() => finish(id, 'none', true), waitMs);
    pending.set(id, { info: { ...info, id, createdAt, expiresAt: createdAt + waitMs }, respond, timer });
    onChange();
    return id;
  }

  /** Responde un pedido. Devuelve false si el id no existe o la decisión no es válida. */
  function decide(id, decision) {
    if (typeof id !== 'string' || !DECISIONS.has(decision)) return false;
    return finish(id, decision, true);
  }

  /** El hook se desconectó (Claude Code lo canceló o lo mató): se quita sin responder. */
  function drop(id) {
    return finish(id, null, false);
  }

  /** Suelta todos los pedidos sin decidir (la terminal pregunta). */
  function releaseAll() {
    for (const id of [...pending.keys()]) finish(id, 'none', true);
  }

  /** Pedidos en orden de llegada. */
  function list() {
    return [...pending.values()].map((p) => ({ ...p.info })).sort((a, b) => a.createdAt - b.createdAt);
  }

  function sessionOf(id) {
    return pending.get(id)?.info.sessionId ?? null;
  }

  return {
    add,
    decide,
    drop,
    releaseAll,
    list,
    sessionOf,
    get size() {
      return pending.size;
    },
  };
}

module.exports = { createPermissions };
