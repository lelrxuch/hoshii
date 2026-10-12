'use strict';

const { Tray, Menu, nativeImage } = require('electron');

const TRAY_ICON_PX = 22;

/**
 * Ícono de bandeja con el menú de ajustes. En GNOME requiere la extensión AppIndicator; si no se
 * puede crear, update() no hace nada y la isla sigue funcionando.
 */
function createTray({ icon, onToggle, isConnected, onConnect, get, set, onQuit }) {
  let tray = null;
  try {
    tray = new Tray(nativeImage.createFromPath(icon).resize({ width: TRAY_ICON_PX, height: TRAY_ICON_PX }));
    tray.on('click', onToggle);
  } catch {
    tray = null;
  }

  function check(label, key) {
    return { label, type: 'checkbox', checked: Boolean(get()[key]), click: (item) => set(key, item.checked) };
  }

  /** El mismo menú sirve para la bandeja y para el clic derecho en la isla (GNOME sin AppIndicator). */
  function menu() {
    const connected = isConnected();
    return Menu.buildFromTemplate([
      { label: 'Mostrar u ocultar la isla', click: onToggle },
      { type: 'separator' },
      check('Aprobar permisos desde la isla', 'approvals'),
      check('Atajos Ctrl+Alt+Y / Ctrl+Alt+N', 'shortcuts'),
      check('Avisar cuando Claude termine', 'notifyDone'),
      check('Iniciar con el sistema', 'autostart'),
      { type: 'separator' },
      connected
        ? { label: 'Desconectar de Claude Code', click: () => onConnect(false) }
        : { label: 'Conectar con Claude Code', click: () => onConnect(true) },
      { type: 'separator' },
      { label: 'Salir de Hoshii', click: onQuit },
    ]);
  }

  function update({ sessions, pending }) {
    if (!tray) return;
    tray.setToolTip(
      pending
        ? `Hoshii · ${pending} permiso${pending === 1 ? '' : 's'} pendiente${pending === 1 ? '' : 's'}`
        : `Hoshii · ${sessions} sesión${sessions === 1 ? '' : 'es'}`,
    );
    tray.setContextMenu(menu());
  }

  return { update, menu };
}

module.exports = { createTray };
