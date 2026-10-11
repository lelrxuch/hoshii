'use strict';

const { describeTool, projectName, clip } = require('./describe');

/*
 * Estado de cada sesión de Claude Code a partir de los eventos de los hooks. Sin Electron ni
 * temporizadores: el reloj se inyecta para poder probarlo.
 *
 * Estados: idle (lista, esperando tu mensaje), work (trabajando), ask (pide permiso),
 * done (terminó su turno), error (el turno falló).
 */

/** Una sesión sin eventos durante este tiempo se da por cerrada (Claude Code murió sin SessionEnd). */
const STALE_MS = 2 * 60 * 60 * 1000;
const MAX_SESSIONS = 20;
const MESSAGE_MAX = 160;

/** Prioridad para elegir qué sesión muestra la mascota. */
const PRIORITY = { ask: 4, error: 3, work: 2, done: 1, idle: 0 };

function createSessions({ now = () => Date.now() } = {}) {
  /** @type {Map<string, object>} */
  const sessions = new Map();

  function touch(id, cwd) {
    let s = sessions.get(id);
    if (!s) {
      s = { id, cwd: '', project: '', state: 'idle', verb: '', detail: '', since: now(), updatedAt: now() };
      sessions.set(id, s);
      if (sessions.size > MAX_SESSIONS) {
        const oldest = [...sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
        sessions.delete(oldest.id);
      }
    }
    if (typeof cwd === 'string' && cwd) {
      s.cwd = cwd;
      s.project = projectName(cwd);
    }
    if (!s.project) s.project = projectName('');
    s.updatedAt = now();
    return s;
  }

  function set(s, state, verb = '', detail = '') {
    if (s.state !== state) s.since = now();
    s.state = state;
    s.verb = verb;
    s.detail = detail;
  }

  /**
   * Aplica un evento de hook. Devuelve true si cambió algo visible.
   * @param {object} e evento ya validado (hook_event_name y session_id son strings)
   */
  function apply(e) {
    const id = e.session_id;
    const name = e.hook_event_name;
    if (name === 'SessionEnd') return sessions.delete(id);

    const s = touch(id, e.cwd);
    switch (name) {
      case 'SessionStart':
        set(s, 'idle', 'Lista');
        break;
      case 'UserPromptSubmit':
        set(s, 'work', 'Pensando');
        break;
      case 'PreToolUse': {
        const { verb, detail } = describeTool(e.tool_name, e.tool_input, s.cwd);
        set(s, 'work', verb, detail);
        break;
      }
      case 'PostToolUse':
        // Después de una herramienta Claude sigue pensando; si antes pedía permiso, ya se resolvió.
        set(s, 'work', 'Pensando');
        break;
      case 'PermissionRequest': {
        const { verb, detail } = describeTool(e.tool_name, e.tool_input, s.cwd);
        set(s, 'ask', `Quiere permiso · ${verb.toLowerCase()}`, detail);
        break;
      }
      case 'Notification':
        if (e.notification_type === 'idle_prompt') set(s, 'idle', 'Esperando tu mensaje');
        else if (e.notification_type === 'permission_prompt') {
          // Si el permiso ya se pide desde la isla (PermissionRequest), no se pisa ese detalle.
          if (s.state !== 'ask') set(s, 'ask', 'Te pregunta en la terminal', clip(e.message, MESSAGE_MAX));
        } else if (typeof e.message === 'string' && e.message) {
          set(s, s.state, s.verb || 'Aviso', clip(e.message, MESSAGE_MAX));
        }
        break;
      case 'Stop':
        set(s, 'done', 'Terminó');
        break;
      case 'StopFailure':
        set(s, 'error', 'Falló', clip(e.message || e.reason, MESSAGE_MAX));
        break;
      default:
        return false;
    }
    return true;
  }

  /** El permiso se respondió (aquí o en la terminal): la sesión vuelve a "trabajando". */
  function resolved(id) {
    const s = sessions.get(id);
    if (!s || s.state !== 'ask') return false;
    s.updatedAt = now();
    set(s, 'work', 'Pensando');
    return true;
  }

  /** Quita sesiones viejas. Devuelve true si quitó alguna. */
  function prune() {
    const limit = now() - STALE_MS;
    let changed = false;
    for (const [id, s] of sessions) {
      if (s.updatedAt < limit) {
        sessions.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  /** Sesiones ordenadas: primero las que piden algo, luego la actividad más reciente. */
  function list() {
    return [...sessions.values()]
      .map((s) => ({ ...s }))
      .sort((a, b) => PRIORITY[b.state] - PRIORITY[a.state] || b.updatedAt - a.updatedAt);
  }

  function get(id) {
    const s = sessions.get(id);
    return s ? { ...s } : null;
  }

  return { apply, resolved, prune, list, get };
}

module.exports = { createSessions, STALE_MS, MAX_SESSIONS, PRIORITY };
