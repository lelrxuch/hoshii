'use strict';

const path = require('node:path');

/** Largo máximo del detalle que se muestra en la isla (el pedido de permiso muestra más). */
const DETAIL_MAX = 160;
const REQUEST_MAX = 1200;

function clip(text, max) {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function str(v) {
  return typeof v === 'string' ? v : '';
}

/** Nombre corto de un archivo, relativo al proyecto si está dentro. */
function shortPath(file, cwd) {
  const f = str(file);
  if (!f) return '';
  const c = str(cwd);
  if (c && path.isAbsolute(f)) {
    const rel = path.relative(c, f);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  }
  return path.basename(f);
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
 * Resume el uso de una herramienta para la isla.
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

/**
 * Texto completo de lo que se va a aprobar: el comando entero, la ruta del archivo, la URL.
 * Se muestra tal cual (sin interpretar) para que veas exactamente qué permites.
 */
function requestText(toolName, toolInput, cwd) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  let text;
  switch (str(toolName)) {
    case 'Bash':
      text = str(input.command);
      break;
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      text = shortPath(input.file_path, cwd);
      break;
    case 'NotebookEdit':
      text = shortPath(input.notebook_path, cwd);
      break;
    case 'WebFetch':
      text = str(input.url);
      break;
    case 'WebSearch':
      text = str(input.query);
      break;
    default:
      text = describeTool(toolName, input, cwd).detail;
      if (!text) text = JSON.stringify(input);
  }
  const s = text.trim();
  return s.length > REQUEST_MAX ? `${s.slice(0, REQUEST_MAX - 1)}…` : s;
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
  return c ? path.basename(c) : 'Claude Code';
}

module.exports = {
  describeTool,
  requestText,
  requestAction,
  projectName,
  shortPath,
  clip,
  DETAIL_MAX,
  REQUEST_MAX,
};
