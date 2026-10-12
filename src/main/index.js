'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen, globalShortcut, Notification, session } = require('electron');

const platform = require('./platform');
const paths = require('./paths');
const installer = require('./installer');
const autostart = require('./autostart');
const { createStore } = require('./config');
const { createServer } = require('./server');
const { createSessions } = require('./sessions');
const { createPermissions, GUARD_MS } = require('./permissions');
const { requestInfo, requestAction, projectName } = require('./describe');
const { createTray } = require('./tray');

const ROOT = path.join(__dirname, '..', '..');
const ICON = path.join(ROOT, 'assets', 'icon.png');
const HOOK_SOURCE = path.join(ROOT, 'assets', 'hook.py');
const SOCKET = paths.socketPath();
const HOOK_FILE = path.join(paths.dataDir(), 'hook.py');
const SETTINGS = paths.claudeSettingsPath();

/** La isla: ancho y alto los pide el renderer según su contenido; aquí solo se acotan. */
const ISLAND = { minW: 120, maxW: 520, minH: 40, maxH: 560, top: 6 };
const PUSH_THROTTLE_MS = 40;
const PRUNE_EVERY_MS = 60 * 1000;
const SHORTCUT_ALLOW = 'CommandOrControl+Alt+Y';
const SHORTCUT_DENY = 'CommandOrControl+Alt+N';

let store = null;
let config = null;
let win = null;
let tray = null;
let server = null;
let installed = false;
let lastError = null;
let size = { width: 360, height: 64 };
let shortcutsOn = false;
let pushTimer = null;
let quitting = false;

const sessions = createSessions();
let permissions = null;

/* ---------- estado hacia la isla ---------- */

function snapshot() {
  return {
    sessions: sessions.list(),
    pending: permissions.list(),
    installed,
    approvals: config.approvals,
    shortcuts: config.shortcuts,
    waitMs: config.waitSeconds * 1000,
    guardMs: GUARD_MS,
    error: lastError,
    now: Date.now(),
  };
}

function push() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (win && !win.isDestroyed()) win.webContents.send('island:state', snapshot());
    updateShortcuts();
    tray?.update({ sessions: sessions.list().length, pending: permissions.size });
  }, PUSH_THROTTLE_MS);
}

/* ---------- eventos del hook ---------- */

function notifyDone(session) {
  if (!config.notifyDone || !session || !Notification.isSupported()) return;
  new Notification({ title: 'Hoshii', body: `Claude terminó en ${session.project}`, icon: ICON }).show();
}

function onEvent(event) {
  const changed = sessions.apply(event);
  if (event.hook_event_name === 'Stop') notifyDone(sessions.get(event.session_id));
  if (changed) push();
}

function onPermission(event, respond) {
  sessions.apply(event);
  push();
  if (!config.approvals) return null;
  const s = sessions.get(event.session_id);
  const req = requestInfo(event.tool_name, event.tool_input, event.cwd, {
    truncated: event.truncated === true,
  });
  const id = permissions.add(
    {
      sessionId: event.session_id,
      project: s?.project || projectName(event.cwd),
      tool: event.tool_name || '',
      action: requestAction(event.tool_name),
      ...req,
    },
    respond,
  );
  if (!id) return null; // demasiados pedidos a la vez: este lo pregunta la terminal
  // Se muestra sin robar el foco: puedes estar escribiendo en otra ventana.
  if (!win || win.isDestroyed() || !win.isVisible()) showIsland();
  return id;
}

function onPermissionClosed(id) {
  const sid = permissions.sessionOf(id);
  permissions.drop(id);
  sessions.resolved(sid);
  push();
}

function decide(id, decision) {
  const sid = permissions.sessionOf(id);
  if (!permissions.decide(id, decision)) return false;
  sessions.resolved(sid);
  push();
  return true;
}

/* ---------- atajos globales (solo mientras hay un pedido) ---------- */

function updateShortcuts() {
  const want = config.shortcuts && permissions.size > 0;
  if (want === shortcutsOn) return;
  shortcutsOn = want;
  if (!want) {
    globalShortcut.unregister(SHORTCUT_ALLOW);
    globalShortcut.unregister(SHORTCUT_DENY);
    return;
  }
  const first = (d) => () => {
    const p = permissions.list()[0];
    if (p) decide(p.id, d);
  };
  // Si otra app ya usa la combinación, register devuelve false y la isla sigue funcionando con clic.
  globalShortcut.register(SHORTCUT_ALLOW, first('allow'));
  globalShortcut.register(SHORTCUT_DENY, first('deny'));
}

/* ---------- conexión con Claude Code ---------- */

function refreshInstalled() {
  installed = installer.status({ settingsPath: SETTINGS, hookFile: HOOK_FILE });
  if (installed) {
    try {
      installer.syncHookFile(HOOK_SOURCE, HOOK_FILE); // la app se actualizó: el hook también
    } catch (err) {
      lastError = `No pude actualizar el hook: ${err.message}`;
    }
  }
}

function setConnected(on) {
  try {
    const { backupPath } = installer.apply(on ? 'install' : 'uninstall', {
      settingsPath: SETTINGS,
      hookSource: HOOK_SOURCE,
      hookFile: HOOK_FILE,
    });
    lastError = null;
    refreshInstalled();
    push();
    return { ok: true, backupPath };
  } catch (err) {
    lastError = err.message;
    push();
    return { ok: false, error: err.message };
  }
}

/* ---------- ventana ---------- */

function bounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.round(size.width);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: area.y + ISLAND.top,
    width,
    height: Math.round(size.height),
  };
}

function place() {
  if (win && !win.isDestroyed()) win.setBounds(bounds());
}

function createWindow() {
  win = new BrowserWindow({
    ...bounds(),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: 'Hoshii',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.on('did-finish-load', push);
  // Cerrar la ventana (Alt+F4) solo la oculta; para salir está "Salir de Hoshii" en el menú.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  win.on('closed', () => {
    win = null;
  });
}

function showIsland() {
  if (!win || win.isDestroyed()) createWindow();
  else win.showInactive();
}

function toggleWindow() {
  if (win && !win.isDestroyed() && win.isVisible()) win.hide();
  else showIsland();
}

/* ---------- IPC (solo desde la isla) ---------- */

function fromIsland(event) {
  return win && event.sender === win.webContents;
}

function setupIpc() {
  ipcMain.on('island:resize', (event, width, height) => {
    if (!fromIsland(event) || !Number.isFinite(width) || !Number.isFinite(height)) return;
    size = {
      width: Math.min(ISLAND.maxW, Math.max(ISLAND.minW, width)),
      height: Math.min(ISLAND.maxH, Math.max(ISLAND.minH, height)),
    };
    place();
  });
  ipcMain.handle('island:decide', (event, id, decision) => fromIsland(event) && decide(id, decision));
  ipcMain.handle('island:connect', (event) => (fromIsland(event) ? setConnected(true) : { ok: false }));
  ipcMain.on('island:menu', (event) => {
    if (fromIsland(event)) tray?.menu().popup({ window: win });
  });
  ipcMain.on('island:hide', (event) => {
    if (fromIsland(event)) win.hide();
  });
}

/* ---------- arranque ---------- */

function saveConfig(patch) {
  config = { ...config, ...patch };
  store.save(config);
  if (patch.approvals === false) permissions.releaseAll(); // devuelve lo pendiente a la terminal
  push();
}

async function start() {
  // La isla solo carga archivos locales: cualquier otra petición se corta.
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    cb({ cancel: !details.url.startsWith('file://') && !details.url.startsWith('devtools://') });
  });
  store = createStore(app.getPath('userData'));
  config = store.load();
  permissions = createPermissions({ waitMs: config.waitSeconds * 1000, onChange: push });

  setupIpc();
  createWindow();
  refreshInstalled();

  tray = createTray({
    icon: ICON,
    onToggle: toggleWindow,
    isConnected: () => installed,
    onConnect: (on) => setConnected(on),
    get: () => ({ ...config, autostart: autostart.isEnabled() }),
    set: (key, value) => (key === 'autostart' ? autostart.setEnabled(value) : saveConfig({ [key]: value })),
    onQuit: () => app.quit(),
  });

  server = createServer({ socketPath: SOCKET, onEvent, onPermission, onPermissionClosed });
  try {
    await server.start();
  } catch (err) {
    lastError = `No pude abrir el socket: ${err.message}`;
  }
  setInterval(() => sessions.prune() && push(), PRUNE_EVERY_MS).unref();
  screen.on('display-metrics-changed', place);
  push();
}

// Chromium busca actualizaciones de componentes por red; Hoshii no los usa.
app.commandLine.appendSwitch('disable-component-update');

if (platform.relaunchInX11IfNeeded()) {
  app.exit(0);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Abrir Hoshii otra vez muestra la isla de la instancia que ya corre.
  app.on('second-instance', () => app.isReady() && showIsland());
  app.on('before-quit', () => {
    quitting = true;
  });
  app.whenReady().then(start);
  // La isla no se cierra con la ventana: vive en la bandeja.
  app.on('window-all-closed', () => {});
  // Al cerrar sesión o con kill: salir ordenado para soltar los permisos y borrar el socket.
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => app.quit());
  app.on('will-quit', () => {
    permissions?.releaseAll();
    server?.stop();
    globalShortcut.unregisterAll();
  });
}
