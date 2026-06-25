// NAGIHD — preload (puente seguro)
// © 2026 NAGI STUDIOS
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nagi', {
  // Ventana
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),

  // Motores
  checkEngines: () => ipcRenderer.invoke('engines:check'),
  openBin: () => ipcRenderer.invoke('shell:openBin'),

  // Archivos
  importVideo: () => ipcRenderer.invoke('dialog:import'),
  saveOutput: (name) => ipcRenderer.invoke('dialog:saveOutput', name),
  probe: (file) => ipcRenderer.invoke('media:probe', file),
  thumb: (file, atSec) => ipcRenderer.invoke('media:thumb', file, atSec),
  compare: (original, enhanced, atSec) => ipcRenderer.invoke('media:compare', original, enhanced, atSec),

  // Ajustes persistentes
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (data) => ipcRenderer.invoke('settings:set', data),

  // Trabajo
  startJob: (cfg) => ipcRenderer.invoke('job:start', cfg),
  cancelJob: () => ipcRenderer.invoke('job:cancel'),
  onProgress: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('job:progress', h);
    return () => ipcRenderer.removeListener('job:progress', h);
  },

  // Resultado
  reveal: (file) => ipcRenderer.invoke('shell:reveal', file),
  play: (file) => ipcRenderer.invoke('shell:play', file)
});
