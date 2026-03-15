const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { Client, Server } = require('node-osc')
const http = require('http')
const fs = require('fs')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow
let oscClient = null
let oscServer = null
let httpServer = null

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

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// ── OSC Client ──────────────────────────────────────────────────────────────

ipcMain.handle('osc:connect', (_, { host, port }) => {
  try {
    if (oscClient) {
      oscClient.close()
      oscClient = null
    }
    oscClient = new Client(host, port)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
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

// ── File Save (LUA plugin download) ─────────────────────────────────────────

ipcMain.handle('file:save', async (_, { defaultName, content }) => {
  const { dialog } = require('electron')
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'LUA Script', extensions: ['lua'] }],
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

// ── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (oscClient) oscClient.close()
  if (oscServer) oscServer.close()
  if (httpServer) httpServer.close()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
