'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  /** Atender los pedidos de permiso en la isla. Si está apagado, la terminal pregunta como siempre. */
  approvals: true,
  /** Notificación del sistema cuando una sesión termina su turno. */
  notifyDone: true,
  /** Segundos que la isla espera tu respuesta antes de devolverle la pregunta a la terminal. */
  waitSeconds: 90,
  /** Ctrl+Alt+Y permite y Ctrl+Alt+N deniega el pedido visible, solo mientras hay uno. */
  shortcuts: true,
});
const LIMITS = Object.freeze({ waitSeconds: [15, 300] });

/** Mezcla lo guardado con los valores por omisión y descarta lo inválido. */
function validate(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of ['approvals', 'notifyDone', 'shortcuts']) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key];
  }
  const [min, max] = LIMITS.waitSeconds;
  if (Number.isInteger(raw.waitSeconds) && raw.waitSeconds >= min && raw.waitSeconds <= max) {
    out.waitSeconds = raw.waitSeconds;
  }
  return out;
}

function createStore(dir) {
  const file = path.join(dir, 'config.json');
  return {
    load() {
      try {
        return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
      } catch {
        return { ...DEFAULTS };
      }
    },
    save(config) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(validate(config), null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, file);
    },
  };
}

module.exports = { DEFAULTS, LIMITS, validate, createStore };
