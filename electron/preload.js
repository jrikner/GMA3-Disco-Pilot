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

  // Permissions
  onMicrophonePermission: (cb) => {
    ipcRenderer.on('permissions:microphone', (_, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('permissions:microphone')
  },

  // HTTP server for iPad
  httpStart: (opts) => ipcRenderer.invoke('http:start', opts),

  // WebSocket bridge for iPad control
  wsStart: (opts) => ipcRenderer.invoke('ws:start', opts),
  wsStop: () => ipcRenderer.invoke('ws:stop'),
  wsBroadcast: (payload) => ipcRenderer.invoke('ws:broadcast', payload),
  onWsControl: (cb) => {
    ipcRenderer.on('ws:control', (_, msg) => cb(msg))
    return () => ipcRenderer.removeAllListeners('ws:control')
  },
  onWsIpadConnected: (cb) => {
    ipcRenderer.on('ws:ipadConnected', (_, info) => cb(info))
    return () => ipcRenderer.removeAllListeners('ws:ipadConnected')
  },

  // File operations
  fileSave: (opts) => ipcRenderer.invoke('file:save', opts),

  // Profile persistence
  profileSave: (opts) => ipcRenderer.invoke('profile:save', opts),
  profileLoad: (opts) => ipcRenderer.invoke('profile:load', opts),
  profileList: () => ipcRenderer.invoke('profile:list'),

  // Network helper (runs in main process to avoid renderer CORS issues)
  netFetchJson: (opts) => ipcRenderer.invoke('net:fetchJson', opts),
})
