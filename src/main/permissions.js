'use strict';

const { randomUUID } = require('node:crypto');

/*
 * Pedidos de permiso que esperan tu respuesta. Cada pedido tiene una conexión abierta con el hook;
 * `respond` le manda la decisión exactamente una vez.
 *
 * Decisiones: 'allow', 'deny' o 'none'. 'none' significa "no decido": el hook sale sin imprimir nada
 * y Claude Code pregunta en la terminal. Se usa al vencer el plazo, al elegir "Responder en la
 * terminal" y al cerrar la app. Nunca se permite nada por omisión.
 *
 * Reglas para "allow" (también si la isla estuviera comprometida, porque se aplican aquí):
 * - Solo si el texto se pudo mostrar completo (info.complete).
 * - No en los primeros guardMs desde que el pedido quedó al frente: evita aprobar por error uno que
 *   acaba de aparecer (clic o atajo justo cuando cambia la tarjeta, o una tecla que se repite).
 */

const DECISIONS = new Set(['allow', 'deny', 'none']);
/** Tiempo mínimo que un pedido debe estar al frente antes de poder permitirlo. */
const GUARD_MS = 600;
/** Pedidos en espera a la vez; los que pasan de aquí vuelven a la terminal. */
const MAX_PENDING = 8;

function createPermissions({
  waitMs,
  guardMs = GUARD_MS,
  maxPending = MAX_PENDING,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  makeId = randomUUID,
  onChange = () => {},
}) {
  /** @type {Map<string, { info: object, respond: Function, timer: any }>} */
  const pending = new Map();
  /** Cuándo se resolvió el último pedido: el siguiente quedó al frente en ese momento. */
  let lastFinishAt = 0;

  function finish(id, decision, notify) {
    const p = pending.get(id);
    if (!p) return false;
    pending.delete(id);
    clearTimer(p.timer);
    lastFinishAt = now();
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
   * Agrega un pedido. `info`: { sessionId, project, tool, action, text, complete, outside, hidden }.
   * @returns {string|null} id del pedido, o null si la cola está llena (el llamador responde 'none')
   */
  function add(info, respond) {
    if (pending.size >= maxPending) return null;
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
    const p = pending.get(id);
    if (!p) return false;
    if (decision === 'allow') {
      if (p.info.complete !== true) return false;
      if (now() - Math.max(p.info.createdAt, lastFinishAt) < guardMs) return false;
    }
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

module.exports = { createPermissions, GUARD_MS, MAX_PENDING };
