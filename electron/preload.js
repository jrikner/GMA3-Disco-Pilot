const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // OSC
  oscConnect: (opts) => ipcRenderer.invoke('osc:connect', opts),
  oscSend: (msg) => ipcRenderer.invoke('osc:send', msg),
  oscDisconnect: () => ipcRenderer.invoke('osc:disconnect'),
  oscStartReceive: (opts) => ipcRenderer.invoke('osc:startReceive', opts),
  onOscReceived: (cb) => {
    ipcRenderer.on('osc:received', (_, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('osc:received')
  },

  // HTTP server for iPad
  httpStart: (opts) => ipcRenderer.invoke('http:start', opts),

  // File operations
  fileSave: (opts) => ipcRenderer.invoke('file:save', opts),

  // Profile persistence
  profileSave: (opts) => ipcRenderer.invoke('profile:save', opts),
  profileLoad: (opts) => ipcRenderer.invoke('profile:load', opts),
  profileList: () => ipcRenderer.invoke('profile:list'),
})
