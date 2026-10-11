'use strict';

const fs = require('node:fs');
const path = require('node:path');

/*
 * Conecta Hoshii con Claude Code agregando hooks a ~/.claude/settings.json.
 *
 * - Antes de escribir guarda un respaldo con fecha junto al archivo.
 * - Solo toca las entradas cuyo comando contiene HOOK_MARK; tus otros hooks y ajustes quedan igual.
 * - Si settings.json no es JSON válido, no lo modifica.
 * - Escribe con archivo temporal + rename, y respeta enlaces simbólicos (dotfiles).
 */

const HOOK_MARK = 'hoshii/hook.py';
/** Eventos que escucha la isla. Solo PermissionRequest bloquea: los demás corren en segundo plano. */
const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Notification',
  'Stop',
  'StopFailure',
  'SessionEnd',
];
/** Segundos. Algo más que el tope de espera del hook (WAIT_S en hook.py). */
const PERMISSION_TIMEOUT_S = 330;
const EVENT_TIMEOUT_S = 5;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Comando que ejecuta Claude Code. La ruta va entre comillas por si tiene espacios. */
function hookCommand(hookFile) {
  return `python3 "${hookFile.replace(/(["\\$`])/g, '\\$1')}"`;
}

function isOurs(handler) {
  return isPlainObject(handler) && typeof handler.command === 'string' && handler.command.includes(HOOK_MARK);
}

function handlerFor(event, command) {
  if (event === 'PermissionRequest') return { type: 'command', command, timeout: PERMISSION_TIMEOUT_S };
  // SessionEnd tiene un presupuesto de 1.5 s al salir: sin async para que alcance a avisar.
  if (event === 'SessionEnd') return { type: 'command', command, timeout: 2 };
  return { type: 'command', command, timeout: EVENT_TIMEOUT_S, async: true };
}

/** Copia de settings sin las entradas de Hoshii. No modifica el original. */
function removeHooks(settings) {
  const out = structuredClone(settings);
  if (!isPlainObject(out.hooks)) return out;
  for (const [event, groups] of Object.entries(out.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const group of groups) {
      if (!isPlainObject(group) || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const hooks = group.hooks.filter((h) => !isOurs(h));
      if (hooks.length) kept.push({ ...group, hooks });
    }
    if (kept.length) out.hooks[event] = kept;
    else delete out.hooks[event];
  }
  if (!Object.keys(out.hooks).length) delete out.hooks;
  return out;
}

/** Copia de settings con las entradas de Hoshii (reemplaza las anteriores). */
function addHooks(settings, command) {
  const out = removeHooks(settings);
  if (out.hooks !== undefined && !isPlainObject(out.hooks)) {
    throw new Error('"hooks" en settings.json no es un objeto; no lo modifico');
  }
  out.hooks = out.hooks || {};
  for (const event of EVENTS) {
    const groups = out.hooks[event];
    if (groups !== undefined && !Array.isArray(groups)) {
      throw new Error(`"hooks.${event}" en settings.json no es una lista; no lo modifico`);
    }
    out.hooks[event] = [...(groups || []), { hooks: [handlerFor(event, command)] }];
  }
  return out;
}

/** ¿Están todas las entradas de Hoshii con este comando? */
function isInstalled(settings, command) {
  if (!isPlainObject(settings) || !isPlainObject(settings.hooks)) return false;
  return EVENTS.every((event) => {
    const groups = settings.hooks[event];
    return (
      Array.isArray(groups) &&
      groups.some(
        (g) =>
          isPlainObject(g) &&
          Array.isArray(g.hooks) &&
          g.hooks.some((h) => isOurs(h) && h.command === command),
      )
    );
  });
}

/* ---------- archivos ---------- */

function stamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** Lee settings.json. Devuelve { settings, exists, realPath, mode }. Lanza si no es JSON objeto. */
function readSettings(settingsPath) {
  let realPath = settingsPath;
  try {
    realPath = fs.realpathSync(settingsPath);
  } catch {
    // no existe todavía
  }
  let text;
  try {
    text = fs.readFileSync(realPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { settings: {}, exists: false, realPath, mode: 0o600 };
    throw err;
  }
  let settings;
  try {
    settings = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${settingsPath} no es JSON válido; corrígelo antes de conectar Hoshii`);
  }
  if (!isPlainObject(settings)) throw new Error(`${settingsPath} no contiene un objeto JSON`);
  return { settings, exists: true, realPath, mode: fs.statSync(realPath).mode & 0o777 };
}

function writeAtomic(file, text, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.hoshii-tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

/** Respaldo con fecha. Devuelve la ruta del respaldo. */
function backup(realPath, date) {
  const dest = `${realPath}.hoshii-${stamp(date)}.bak`;
  fs.copyFileSync(realPath, dest, fs.constants.COPYFILE_EXCL);
  return dest;
}

/** Copia el hook a su ruta fija si falta o cambió (actualizaciones de la app). */
function syncHookFile(source, dest) {
  const text = fs.readFileSync(source, 'utf8');
  let current = null;
  try {
    current = fs.readFileSync(dest, 'utf8');
  } catch {
    // no existe
  }
  if (current === text) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  writeAtomic(dest, text, 0o700);
  return true;
}

/**
 * Instala o desinstala. Devuelve { changed, backupPath }.
 * @param {'install'|'uninstall'} action
 */
function apply(action, { settingsPath, hookSource, hookFile, date = new Date() }) {
  const command = hookCommand(hookFile);
  const { settings, exists, realPath, mode } = readSettings(settingsPath);
  if (action === 'install') syncHookFile(hookSource, hookFile);
  const next = action === 'install' ? addHooks(settings, command) : removeHooks(settings);
  if (JSON.stringify(next) === JSON.stringify(settings)) return { changed: false, backupPath: null };
  const backupPath = exists ? backup(realPath, date) : null;
  writeAtomic(realPath, `${JSON.stringify(next, null, 2)}\n`, mode);
  return { changed: true, backupPath };
}

/** ¿Está conectado? No lanza: un settings.json roto cuenta como no conectado. */
function status({ settingsPath, hookFile }) {
  try {
    return isInstalled(readSettings(settingsPath).settings, hookCommand(hookFile));
  } catch {
    return false;
  }
}

module.exports = {
  HOOK_MARK,
  EVENTS,
  hookCommand,
  addHooks,
  removeHooks,
  isInstalled,
  readSettings,
  syncHookFile,
  apply,
  status,
  stamp,
};
