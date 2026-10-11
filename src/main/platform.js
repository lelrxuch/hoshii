'use strict';

const { spawn } = require('node:child_process');

// En Wayland, GNOME no deja que una app se ponga encima de todo ni elija su posición, y la isla
// necesita ambas cosas. Se relanza una vez en X11 (XWayland). appendSwitch('ozone-platform') llega
// tarde en Electron 44, y app.relaunch deja de funcionar dentro de una AppImage (su auxiliar vive en
// el montaje, que desaparece al salir). Misma solución que Canvas Today.
function needsX11Relaunch({ platform, ozone, env }) {
  return platform === 'linux' && ozone !== 'x11' && Boolean(env.DISPLAY) && !env.HOSHII_X11_RELAUNCH;
}

/** Relanza la app en X11 si hace falta. Devuelve true si lo hizo (el llamador debe salir). */
function relaunchInX11IfNeeded() {
  const { app } = require('electron'); // aquí y no arriba: las pruebas cargan este módulo sin Electron
  const ozone = app.commandLine.getSwitchValue('ozone-platform');
  if (!needsX11Relaunch({ platform: process.platform, ozone, env: process.env })) return false;
  spawn(process.env.APPIMAGE || process.execPath, [...process.argv.slice(1), '--ozone-platform=x11'], {
    detached: true,
    // fd 3 es el pipe con el que el runtime de la AppImage sabe que la app terminó; si se hereda,
    // la instancia original y su montaje nunca se cierran.
    stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
    env: { ...process.env, HOSHII_X11_RELAUNCH: '1' },
  }).unref();
  return true;
}

module.exports = { needsX11Relaunch, relaunchInX11IfNeeded };
