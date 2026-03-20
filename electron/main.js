const { app, BrowserWindow, ipcMain, session, systemPreferences } = require('electron')
const path = require('path')
const { Client, Server } = require('node-osc')
const http = require('http')
const https = require('https')
const fs = require('fs')
const { execFile } = require('child_process')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow
let oscClient = null
let oscServer = null
let httpServer = null
let wsServer = null
let microphonePermissionState = {
  granted: process.platform !== 'darwin',
  error: null,
}

function fetchJsonViaNode(url, timeoutMs = 10000, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (!url || typeof url !== 'string') {
      reject(new Error('A valid URL string is required'))
      return
    }

    const parsed = new URL(url)
    const client = parsed.protocol === 'http:' ? http : https

    const req = client.get(url, {
      headers: {
        'Accept': 'application/json,text/plain,*/*',
        'User-Agent': 'GMA3-Disco-Pilot/1.0 (+https://github.com)',
      },
    }, (res) => {
      const { statusCode = 0, headers } = res

      if ([301, 302, 307, 308].includes(statusCode) && headers.location) {
        res.resume()
        if (redirectCount >= 5) {
          reject(new Error(`Too many redirects while requesting ${url}`))
          return
        }
        const nextUrl = new URL(headers.location, url).toString()
        fetchJsonViaNode(nextUrl, timeoutMs, redirectCount + 1).then(resolve).catch(reject)
        return
      }

      if (statusCode < 200 || statusCode >= 300) {
        res.resume()
        reject(new Error(`HTTP ${statusCode} from ${url}`))
        return
      }

      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8')
          resolve(JSON.parse(raw))
        } catch (error) {
          reject(new Error(`Invalid JSON from ${url}: ${error.message}`))
        }
      })
    })

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout fetching ${url}`))
    })

    req.on('error', reject)
  })
}

function sendMicrophonePermissionState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('permissions:microphone', microphonePermissionState)
  }
}

function isTrustedAppRequest(webContents, requestingOrigin = '') {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (webContents !== mainWindow.webContents) return false

  if (isDev) {
    return requestingOrigin.startsWith('http://localhost:5173') || requestingOrigin.startsWith('http://127.0.0.1:5173')
  }

  return requestingOrigin === 'file://' || requestingOrigin.startsWith('file://')
}

function registerPermissionHandlers() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
    if ((permission === 'media' || permission === 'audioCapture') && isTrustedAppRequest(webContents, details.requestingOrigin || '')) {
      const allowed = microphonePermissionState.granted !== false
      if (!allowed) {
        microphonePermissionState = {
          granted: false,
          error: 'Microphone access was denied in macOS. Enable microphone access for GMA3 Disco Pilot in System Settings → Privacy & Security → Microphone.',
        }
        sendMicrophonePermissionState()
      }
      callback(allowed)
      return
    }

    callback(false)
  })
}

async function requestMicrophoneAccess() {
  if (process.platform !== 'darwin') {
    microphonePermissionState = { granted: true, error: null }
    return
  }

  const currentStatus = systemPreferences.getMediaAccessStatus('microphone')
  if (currentStatus === 'granted') {
    microphonePermissionState = { granted: true, error: null }
    return
  }

  const granted = await systemPreferences.askForMediaAccess('microphone')
  microphonePermissionState = granted
    ? { granted: true, error: null }
    : {
        granted: false,
        error: 'Microphone access was denied in macOS. Enable microphone access for GMA3 Disco Pilot in System Settings → Privacy & Security → Microphone.',
      }
}

function probeOscHost(host) {
  return new Promise((resolve) => {
    const target = String(host || '').trim()
    if (!target) {
      resolve({ reachable: false, error: 'Host is required' })
      return
    }

    const pingArgs = process.platform === 'darwin'
      ? ['-c', '1', '-t', '1', target]
      : ['-c', '1', '-W', '1', target]

    execFile('ping', pingArgs, { timeout: 2000 }, (error) => {
      if (!error) {
        resolve({ reachable: true })
        return
      }

      if (error.code === 'ENOENT') {
        resolve({
          reachable: null,
          warning: 'Ping is unavailable on this system, so the console could not be verified.',
        })
        return
      }

      resolve({
        reachable: false,
        warning: 'OSC socket opened, but the configured host did not respond to a reachability check.',
      })
    })
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.webContents.on('did-finish-load', () => {
    sendMicrophonePermissionState()
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// ── OSC Client ──────────────────────────────────────────────────────────────

ipcMain.handle('osc:connect', async (_, { host, port }) => {
  try {
    if (oscClient) {
      oscClient.close()
      oscClient = null
    }
    oscClient = new Client(host, port)

    const probe = await probeOscHost(host)
    return {
      success: true,
      socketReady: true,
      verified: probe.reachable === true,
      warning: probe.warning || null,
      error: probe.reachable === false ? probe.warning : null,
    }
  } catch (err) {
    return { success: false, socketReady: false, verified: false, error: err.message }
  }
})

ipcMain.handle('osc:send', (_, { address, args }) => {
  if (!oscClient) return { success: false, error: 'Not connected' }
  try {
    oscClient.send(address, ...args)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('osc:disconnect', () => {
  if (oscClient) {
    oscClient.close()
    oscClient = null
  }
  return { success: true }
})

// ── OSC Receive (for MA3 feedback) ──────────────────────────────────────────

ipcMain.handle('osc:startReceive', (_, { port }) => {
  try {
    if (oscServer) {
      oscServer.close()
      oscServer = null
    }
    oscServer = new Server(port, '0.0.0.0', () => {
      console.log(`OSC server listening on port ${port}`)
    })
    oscServer.on('message', (msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('osc:received', { address: msg[0], args: msg.slice(1) })
      }
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ── iPad HTTP Server ─────────────────────────────────────────────────────────
// Serves the built React app to iPads on the same network

ipcMain.handle('http:start', (_, { port }) => {
  try {
    if (httpServer) {
      httpServer.close()
      httpServer = null
    }
    const distPath = isDev
      ? path.join(__dirname, '../dist')
      : path.join(__dirname, '../dist')

    httpServer = http.createServer((req, res) => {
      const safePath = req.url === '/' ? '/index.html' : req.url
      const filePath = path.join(distPath, safePath)
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404)
          res.end('Not found')
          return
        }
        const ext = path.extname(filePath)
        const mimeTypes = {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.wasm': 'application/wasm',
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' })
        res.end(data)
      })
    })
    httpServer.listen(port)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ── WebSocket Bridge (for iPad control) ──────────────────────────────────────
// iPad connects to this WebSocket server and sends JSON control commands.
// Electron forwards them to the renderer, which executes the actions.

ipcMain.handle('ws:start', (_, { port }) => {
  try {
    if (wsServer) {
      wsServer.close()
      wsServer = null
    }
    // Use ws package if available, otherwise skip gracefully
    let WebSocketServer
    try {
      WebSocketServer = require('ws').Server
    } catch {
      return { success: false, error: 'ws package not installed. Run: npm install ws' }
    }

    wsServer = new WebSocketServer({ port })
    wsServer.on('connection', (socket, req) => {
      console.log('[WS] iPad connected from', req.socket.remoteAddress)
      socket.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString())
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ws:control', msg)
          }
        } catch (e) {
          console.warn('[WS] Invalid message:', e.message)
        }
      })
      // Send current state snapshot on connect
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ws:ipadConnected', { remoteAddress: req.socket.remoteAddress })
      }
    })
    wsServer.on('error', (err) => {
      console.error('[WS] Server error:', err.message)
    })
    return { success: true, port }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('ws:stop', () => {
  if (wsServer) {
    wsServer.close()
    wsServer = null
  }
  return { success: true }
})

// Send a state update broadcast to all connected iPad clients
ipcMain.handle('ws:broadcast', (_, payload) => {
  if (!wsServer) return { success: false }
  const msg = JSON.stringify(payload)
  wsServer.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg)
  })
  return { success: true }
})

// ── File Save (LUA plugin download) ─────────────────────────────────────────

ipcMain.handle('file:save', async (_, { defaultName, content, fileType }) => {
  const { dialog } = require('electron')
  const filters = fileType === 'csv'
    ? [{ name: 'CSV', extensions: ['csv'] }]
    : fileType === 'xml'
      ? [{ name: 'XML File', extensions: ['xml'] }]
      : [{ name: 'LUA Script', extensions: ['lua'] }]
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters,
  })
  if (result.canceled) return { success: false }
  fs.writeFileSync(result.filePath, content, 'utf8')
  return { success: true, filePath: result.filePath }
})

// ── Session Profile Persistence ──────────────────────────────────────────────

const profilesDir = path.join(app.getPath('userData'), 'profiles')

ipcMain.handle('profile:save', (_, { name, data }) => {
  if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true })
  const filePath = path.join(profilesDir, `${name}.json`)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
  return { success: true }
})

ipcMain.handle('profile:load', (_, { name }) => {
  const filePath = path.join(profilesDir, `${name}.json`)
  if (!fs.existsSync(filePath)) return { success: false, error: 'Not found' }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  return { success: true, data }
})

ipcMain.handle('profile:list', () => {
  if (!fs.existsSync(profilesDir)) return { success: true, profiles: [] }
  const files = fs.readdirSync(profilesDir).filter(f => f.endsWith('.json'))
  return { success: true, profiles: files.map(f => f.replace('.json', '')) }
})

// ── Remote JSON Fetch (CORS-safe fixture library access) ───────────────────

ipcMain.handle('net:fetchJson', async (_, { url, timeoutMs = 10000 } = {}) => {
  try {
    const data = await fetchJsonViaNode(url, timeoutMs)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// ── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  registerPermissionHandlers()
  await requestMicrophoneAccess()
  createWindow()
})

app.on('window-all-closed', () => {
  if (oscClient) oscClient.close()
  if (oscServer) oscServer.close()
  if (httpServer) httpServer.close()
  if (wsServer) wsServer.close()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
