/**
 * OSC Client — thin wrapper around the Electron IPC bridge to node-osc.
 * All UDP sending happens in the main process via electron/main.js.
 */

const api = () => window.electronAPI

let connected = false
const RATE_LIMIT_MS = 50  // Max one OSC message per 50ms per address

// Per-address rate limiting
const lastSendByAddress = {}

export async function connect(host, port) {
  const result = await api().oscConnect({ host, port })
  connected = result.success && result.socketReady !== false
  return result
}

export async function disconnect() {
  connected = false
  return api().oscDisconnect()
}

export function isConnected() {
  return connected
}

/**
 * Send a single OSC message.
 * @param {string} address - OSC address path e.g. "/gma3/page1/exec1/fader"
 * @param {Array} args - Array of values (numbers or strings)
 * @param {Object} opts - { rateLimit: boolean (default true) }
 */
export async function send(address, args = [], opts = {}) {
  if (!connected) return { success: false, error: 'Not connected' }

  const rateLimit = opts.rateLimit !== false
  if (rateLimit) {
    const now = Date.now()
    const last = lastSendByAddress[address] || 0
    if (now - last < RATE_LIMIT_MS) return { success: false, error: 'Rate limited' }
    lastSendByAddress[address] = now
  }

  return api().oscSend({ address, args })
}

export function sendCmd(cmd) {
  return send('/gma3/cmd', [cmd], { rateLimit: false })
}

export function setFader(page, exec, value, boundaries = { min: 0, max: 1 }) {
  const clamped = Math.max(boundaries.min, Math.min(boundaries.max, value))
  const address = `/gma3/page${page}/exec${exec}/fader`
  return send(address, [clamped])
}

export function pressKey(page, exec, down = true) {
  const address = `/gma3/page${page}/exec${exec}/key`
  return send(address, [down ? 1 : 0], { rateLimit: false })
}

export async function startReceive(port, onMessage) {
  const result = await api().oscStartReceive({ port })
  const unsubscribe = result.success ? api().onOscReceived(onMessage) : () => {}
  return { ...result, unsubscribe }
}
