const { app, BrowserWindow, session } = require('electron')
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const path = require('node:path')
const readline = require('node:readline')

const root = path.resolve(__dirname, '..')
const serverPath = path.join(root, 'bin', 'replay-server')
const startupTimeoutMs = 30_000
let server
let shuttingDown = false
let readyUrl
const windows = new Set()
const appState = path.join(root, '.cache', 'desktop-state')
const sessionState = path.join(root, '.cache', 'desktop-session')
fs.mkdirSync(appState, { recursive: true })
fs.mkdirSync(sessionState, { recursive: true })
app.setPath('userData', appState)
app.setPath('sessionData', sessionState)

function stopServer() {
  if (shuttingDown) return
  shuttingDown = true
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  server.kill('SIGTERM')
  const force = setTimeout(() => {
    if (server && server.exitCode === null && server.signalCode === null) server.kill('SIGKILL')
  }, 5_000)
  force.unref()
}

function validAppURL(value) {
  try {
    const parsed = new URL(value)
    const expected = new URL(readyUrl)
    return parsed.origin === expected.origin
  } catch {
    return false
  }
}

function trackWindow(win) {
  windows.add(win)
  win.on('closed', () => {
    windows.delete(win)
    if (windows.size === 0) {
      stopServer()
      app.quit()
    }
  })
  win.webContents.setWindowOpenHandler(({ url: requested }) => {
    if (!requested || requested === 'about:blank' || validAppURL(requested)) {
      return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } } }
    }
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, target) => {
    if (!validAppURL(target)) event.preventDefault()
  })
  win.webContents.on('will-redirect', (event, target) => {
    if (!validAppURL(target)) event.preventDefault()
  })
  win.webContents.on('did-create-window', (child) => trackWindow(child))
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  trackWindow(win)
  win.loadURL(url).catch((err) => {
    console.error('Unable to load local application:', err)
    stopServer()
    app.quit()
  })
  return win
}

function launchServer() {
  return new Promise((resolve, reject) => {
    server = spawn(serverPath, [], {
      cwd: root,
      env: { ...process.env, MARKET_REPLAY_DESKTOP: '1' },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let settled = false
    const timer = setTimeout(() => finish(new Error(`server startup exceeded ${startupTimeoutMs}ms`)), startupTimeoutMs)
    const finish = (err, url) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(url)
    }
    const lines = readline.createInterface({ input: server.stdout })
    lines.on('line', (line) => {
      const prefix = 'MARKET_REPLAY_DESKTOP_READY '
      if (!line.startsWith(prefix)) return
      try {
        const message = JSON.parse(line.slice(prefix.length))
        const parsed = new URL(message.url)
        if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) throw new Error('server reported an unsafe URL')
        finish(null, parsed.toString())
      } catch (err) {
        finish(err)
      }
    })
    server.once('error', (err) => finish(err))
    server.once('exit', (code, signal) => {
      if (!settled) finish(new Error(`server exited before readiness (code=${code}, signal=${signal})`))
      else if (!shuttingDown) {
        console.error(`server exited unexpectedly (code=${code}, signal=${signal})`)
        app.quit()
      }
    })
    app.once('before-quit', stopServer)
  })
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  try {
    readyUrl = await launchServer()
    createWindow(readyUrl)
  } catch (err) {
    console.error('Unable to start local server:', err)
    stopServer()
    app.quit()
  }
})

app.on('window-all-closed', () => {
  stopServer()
  app.quit()
})
app.on('before-quit', stopServer)
