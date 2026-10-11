'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/*
 * Rutas que comparten la app y el hook. La búsqueda del socket debe ser idéntica a socket_path()
 * en assets/hook.py: si cambia aquí, cambia allá.
 */

/** Directorio real (no enlace), del usuario y sin permisos para otros. */
function usableDir(dir, uid) {
  try {
    const st = fs.lstatSync(dir);
    return st.isDirectory() && st.uid === uid && (st.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

/**
 * Ruta del socket. Orden: HOSHII_SOCKET, $XDG_RUNTIME_DIR/hoshii, /run/user/<uid>/hoshii,
 * /tmp/hoshii-<uid>.
 */
function socketPath({ env = process.env, uid = process.getuid(), isUsable = usableDir } = {}) {
  if (env.HOSHII_SOCKET) return env.HOSHII_SOCKET;
  let runtime = env.XDG_RUNTIME_DIR || '';
  if (!path.isAbsolute(runtime)) {
    const run = `/run/user/${uid}`;
    runtime = isUsable(run, uid) ? run : '';
  }
  if (runtime) return path.join(runtime, 'hoshii', 'hoshii.sock');
  return `/tmp/hoshii-${uid}/hoshii.sock`;
}

/** Datos del usuario según XDG: ahí vive la copia del hook que ejecuta Claude Code. */
function dataDir(env = process.env, home = os.homedir()) {
  const base = path.isAbsolute(env.XDG_DATA_HOME || '')
    ? env.XDG_DATA_HOME
    : path.join(home, '.local', 'share');
  return path.join(base, 'hoshii');
}

/** settings.json de usuario de Claude Code. CLAUDE_CONFIG_DIR lo mueve, igual que en Claude Code. */
function claudeSettingsPath(env = process.env, home = os.homedir()) {
  const dir = path.isAbsolute(env.CLAUDE_CONFIG_DIR || '')
    ? env.CLAUDE_CONFIG_DIR
    : path.join(home, '.claude');
  return path.join(dir, 'settings.json');
}

/**
 * Crea el directorio del socket con permisos 700. Si ya existe, exige que sea un directorio real del
 * usuario sin permisos para otros; si no, se niega (alguien más pudo prepararlo).
 */
function ensureSocketDir(socketFile, uid = process.getuid()) {
  const dir = path.dirname(socketFile);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  // Un directorio propio con permisos de más (umask raro) se corrige; uno ajeno o un enlace, no.
  if (st.isDirectory() && st.uid === uid && (st.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
  if (!usableDir(dir, uid)) {
    throw new Error(`El directorio del socket no es seguro: ${dir} (debe ser tuyo y con permisos 700)`);
  }
  return dir;
}

module.exports = { socketPath, dataDir, claudeSettingsPath, ensureSocketDir, usableDir };
