'use strict';

const os = require('node:os');
const path = require('node:path');

/** Largo máximo del detalle que se muestra en la isla. */
const DETAIL_MAX = 160;
/** Lo que se aprueba se muestra entero; si pasa de esto, la isla no ofrece "Permitir". */
const REQUEST_MAX = 4000;

/*
 * Caracteres que no se ven o que reordenan el texto (bidi, ancho cero) y controles. Un comando podría
 * verse inofensivo y hacer otra cosa; se reemplazan por una marca visible ⟨U+XXXX⟩.
 */
// Se arma con escapes en un string para que el archivo no contenga los caracteres en sí. Los controles y
// los selectores de variación están a propósito: son justo lo que hay que marcar.
/* eslint-disable no-control-regex, no-misleading-character-class */
const HIDDEN_RE = new RegExp(
  '[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u00ad\\u061c\\u115f-\\u1160\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u206f\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0\\ufff9-\\ufffb]',
  'g',
);
/* eslint-enable no-control-regex, no-misleading-character-class */

/** Reemplaza lo invisible por marcas visibles. Devuelve { text, hidden } (cuántos reemplazó). */
function reveal(text) {
  let hidden = 0;
  const out = String(text ?? '').replace(HIDDEN_RE, (c) => {
    hidden += 1;
    return `⟨U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}⟩`;
  });
  return { text: out, hidden };
}

function clip(text, max) {
  const s = reveal(text).text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function str(v) {
  return typeof v === 'string' ? v : '';
}

/** ¿El archivo está dentro de la carpeta del proyecto? */
function isInside(file, cwd) {
  const f = str(file);
  const c = str(cwd);
  if (!f || !c || !path.isAbsolute(f)) return Boolean(f) && !path.isAbsolute(f) && !f.startsWith('..');
  const rel = path.relative(c, f);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Ruta para mostrar: relativa si está dentro del proyecto; si no, completa con ~ por tu carpeta
 * personal. Nunca solo el nombre: "authorized_keys" no dice que es ~/.ssh/authorized_keys.
 */
function shortPath(file, cwd, home = os.homedir()) {
  const raw = str(file);
  if (!raw) return '';
  // Normalizada: "p/../.ssh/x" se muestra como el destino real.
  const f = path.isAbsolute(raw) ? path.normalize(raw) : raw;
  if (isInside(f, cwd) && path.isAbsolute(f)) return path.relative(cwd, f);
  if (home && (f === home || f.startsWith(`${home}/`))) return `~${f.slice(home.length)}`;
  return f;
}

function host(url) {
  try {
    return new URL(str(url)).host;
  } catch {
    return '';
  }
}

/** Verbo (en español) y detalle por herramienta de Claude Code. */
const TOOLS = {
  Bash: (i) => ['Ejecutando', str(i.command)],
  Read: (i, cwd) => ['Leyendo', shortPath(i.file_path, cwd)],
  Edit: (i, cwd) => ['Editando', shortPath(i.file_path, cwd)],
  MultiEdit: (i, cwd) => ['Editando', shortPath(i.file_path, cwd)],
  Write: (i, cwd) => ['Escribiendo', shortPath(i.file_path, cwd)],
  NotebookEdit: (i, cwd) => ['Editando', shortPath(i.notebook_path, cwd)],
  Grep: (i) => ['Buscando', str(i.pattern)],
  Glob: (i) => ['Buscando', str(i.pattern)],
  WebFetch: (i) => ['Leyendo web', host(i.url) || str(i.url)],
  WebSearch: (i) => ['Buscando en la web', str(i.query)],
  Task: (i) => ['Delegando', str(i.description)],
  Agent: (i) => ['Delegando', str(i.description)],
  TodoWrite: () => ['Organizando tareas', ''],
  TaskCreate: (i) => ['Organizando tareas', str(i.subject)],
  TaskUpdate: () => ['Organizando tareas', ''],
};

/**
 * Resume el uso de una herramienta para la línea de estado de la isla.
 * @returns {{ verb: string, detail: string }}
 */
function describeTool(toolName, toolInput, cwd) {
  const name = str(toolName);
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const fn = TOOLS[name];
  if (fn) {
    const [verb, detail] = fn(input, cwd);
    return { verb, detail: clip(detail, DETAIL_MAX) };
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return { verb: 'Usando', detail: clip(`${mcp[1]} · ${mcp[2]}`, DETAIL_MAX) };
  return { verb: 'Usando', detail: clip(name, DETAIL_MAX) };
}

const FILE_FIELD = {
  Read: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
};

/**
 * Lo que se va a aprobar, completo y sin trucos.
 * @param {object} opts
 * @param {boolean} [opts.truncated] el hook recortó parte de la entrada
 * @returns {{ text: string, complete: boolean, outside: boolean, hidden: number }}
 *   complete=false: no se puede mostrar entero → la isla no ofrece "Permitir".
 *   outside=true: toca un archivo fuera de la carpeta del proyecto.
 *   hidden: caracteres invisibles que se marcaron.
 */
function requestInfo(toolName, toolInput, cwd, { truncated = false, home = os.homedir() } = {}) {
  const name = str(toolName);
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  let raw;
  let outside = false;
  if (name === 'Bash') raw = str(input.command);
  else if (FILE_FIELD[name]) {
    const file = str(input[FILE_FIELD[name]]);
    raw = shortPath(file, cwd, home);
    outside = Boolean(file) && !isInside(file, cwd);
  } else if (name === 'WebFetch') raw = str(input.url);
  else if (name === 'WebSearch') raw = str(input.query);
  else {
    // MCP y herramientas desconocidas: nombre y todos sus argumentos, para no aprobar a ciegas.
    const args = Object.keys(input).length ? `\n${JSON.stringify(input, null, 2)}` : '';
    raw = `${name || 'Herramienta sin nombre'}${args}`;
  }
  const { text, hidden } = reveal(raw.trim());
  const complete = !truncated && text.length <= REQUEST_MAX;
  return {
    text: text.length > REQUEST_MAX ? `${text.slice(0, REQUEST_MAX - 1)}…` : text,
    complete,
    outside,
    hidden,
  };
}

/** Qué quiere hacer, en infinitivo, para "<proyecto> quiere …". */
const ACTIONS = {
  Bash: 'ejecutar',
  Read: 'leer',
  Edit: 'editar',
  MultiEdit: 'editar',
  Write: 'escribir',
  NotebookEdit: 'editar',
  WebFetch: 'abrir',
  WebSearch: 'buscar en la web',
  Grep: 'buscar',
  Glob: 'buscar',
  Task: 'delegar',
  Agent: 'delegar',
};

function requestAction(toolName) {
  const name = str(toolName);
  if (ACTIONS[name]) return ACTIONS[name];
  const mcp = /^mcp__(.+?)__/.exec(name);
  return mcp ? `usar ${mcp[1]}` : `usar ${name || 'una herramienta'}`;
}

/** Nombre del proyecto a partir del directorio de trabajo. */
function projectName(cwd) {
  const c = str(cwd).replace(/\/+$/, '');
  return c ? clip(path.basename(c), 80) : 'Claude Code';
}

module.exports = {
  describeTool,
  requestInfo,
  requestAction,
  projectName,
  shortPath,
  isInside,
  reveal,
  clip,
  DETAIL_MAX,
  REQUEST_MAX,
};
