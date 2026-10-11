'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Lo único que la isla puede pedirle a la app. */
contextBridge.exposeInMainWorld('hoshii', {
  onState: (cb) => ipcRenderer.on('island:state', (_e, state) => cb(state)),
  decide: (id, decision) => ipcRenderer.invoke('island:decide', id, decision),
  connect: () => ipcRenderer.invoke('island:connect'),
  resize: (width, height) => ipcRenderer.send('island:resize', width, height),
  hide: () => ipcRenderer.send('island:hide'),
});
