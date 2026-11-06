/**
 * 神笔 · Electron 主进程
 * 同一进程内启动现有 Node HTTP 服务，窗口加载本机页面。
 * 数据目录可通过设置页更换；换电脑时拷走该目录即可还原渠道与画廊。
 */
import { app, BrowserWindow, shell, dialog, ipcMain } from 'electron'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import net from 'node:net'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DEV_ROOT = join(__dirname, '..')

/** 固定配置目录（不随数据目录迁移） */
function configDir() {
  return join(app.getPath('appData'), 'ShenbiConfig')
}

function bootstrapPath() {
  return join(configDir(), 'bootstrap.json')
}

function defaultDataRoot() {
  return join(app.getPath('appData'), '神笔')
}

function readBootstrap() {
  try {
    const raw = readFileSync(bootstrapPath(), 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function writeBootstrap(data) {
  mkdirSync(configDir(), { recursive: true })
  writeFileSync(bootstrapPath(), JSON.stringify(data, null, 2), 'utf8')
}

function resolveDataRoot() {
  const b = readBootstrap()
  const custom = typeof b.dataRoot === 'string' ? b.dataRoot.trim() : ''
  if (custom && existsSync(custom)) return custom
  return defaultDataRoot()
}

function projectRoot() {
  return app.isPackaged ? app.getAppPath() : DEV_ROOT
}

function findFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, host, () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close((err) => (err ? reject(err) : resolve(port)))
    })
    srv.on('error', reject)
  })
}

async function waitHealth(base, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${base}/api/health`)
      if (res.ok) return
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('后端启动超时')
}

/** 首次启动：把开发态渠道配置拷进用户目录（含已有 Key） */
function seedUserData(dataDir) {
  mkdirSync(dataDir, { recursive: true })
  const dest = join(dataDir, 'channels.json')
  if (existsSync(dest)) return
  const candidates = [
    join(DEV_ROOT, 'server', 'data', 'channels.json'),
    join(projectRoot(), 'server', 'data', 'channels.json'),
  ]
  for (const seed of candidates) {
    if (existsSync(seed)) {
      copyFileSync(seed, dest)
      console.log('[神笔] 已导入渠道配置 →', dest)
      return
    }
  }
}

function isDirEmpty(dir) {
  if (!existsSync(dir)) return true
  return readdirSync(dir).length === 0
}

function relaunchApp() {
  app.relaunch()
  app.exit(0)
}

let mainWindow = null
let httpServer = null
let serverBase = ''
let currentDataRoot = ''

async function startBackend() {
  const dataDir = join(app.getPath('userData'), 'data')
  seedUserData(dataDir)
  process.env.SHENBI_DATA_DIR = dataDir
  process.env.HOST = '127.0.0.1'

  const port = await findFreePort()
  process.env.PORT = String(port)

  const serverPath = join(projectRoot(), 'server', 'index.js')
  const mod = await import(pathToFileURL(serverPath).href)
  const started = await mod.startServer({ host: '127.0.0.1', port })
  httpServer = started.server
  const base = `http://127.0.0.1:${started.port}`
  await waitHealth(base)
  serverBase = base
  return { base, port: started.port }
}

function createWindow(base) {
  const preload = join(__dirname, 'preload.cjs')
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: '神笔',
    show: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.loadURL(base)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerSettingsIpc() {
  ipcMain.handle('settings:get', () => {
    const dataRoot = app.getPath('userData')
    const def = defaultDataRoot()
    return {
      dataRoot,
      defaultDataRoot: def,
      isCustom: dataRoot !== def,
      channelsPath: join(dataRoot, 'data', 'channels.json'),
    }
  })

  ipcMain.handle('settings:chooseDataRoot', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: '选择神笔数据目录',
      properties: ['openDirectory', 'createDirectory'],
      message: '该目录将保存渠道配置、画廊与本地草稿。换电脑时拷走整个目录即可。',
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('settings:setDataRoot', async (_evt, path, options = {}) => {
    try {
      if (!path || typeof path !== 'string') {
        return { ok: false, error: '路径无效' }
      }
      mkdirSync(path, { recursive: true })
      const migrate = Boolean(options.migrate)
      const from = app.getPath('userData')
      if (migrate && path !== from && isDirEmpty(path)) {
        // 把当前画像拷到新目录（渠道 + Chromium 本地存储）
        for (const name of readdirSync(from)) {
          if (name === 'SingletonLock' || name === 'SingletonCookie' || name === 'SingletonSocket') {
            continue
          }
          cpSync(join(from, name), join(path, name), { recursive: true })
        }
      }
      writeBootstrap({ dataRoot: path })
      setImmediate(() => relaunchApp())
      return { ok: true, needsRestart: true }
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('settings:resetDataRoot', async () => {
    try {
      writeBootstrap({ dataRoot: null })
      setImmediate(() => relaunchApp())
      return { ok: true, needsRestart: true }
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('settings:openDataRoot', async () => {
    try {
      const err = await shell.openPath(app.getPath('userData'))
      if (err) return { ok: false, error: err }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e?.message ?? String(e) }
    }
  })
}

async function boot() {
  app.setName('神笔')

  // 必须在 ready 之前设定 userData，画廊 IndexedDB / 渠道才会进同一便携目录
  currentDataRoot = resolveDataRoot()
  mkdirSync(currentDataRoot, { recursive: true })
  app.setPath('userData', currentDataRoot)
  console.log('[神笔] 数据目录', currentDataRoot)

  const locked = app.requestSingleInstanceLock()
  if (!locked) {
    app.quit()
    return
  }
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  registerSettingsIpc()
  await app.whenReady()

  try {
    const { base } = await startBackend()
    createWindow(base)
  } catch (err) {
    console.error(err)
    dialog.showErrorBox('神笔启动失败', err?.message ?? String(err))
    app.quit()
    return
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverBase) {
      createWindow(serverBase)
    }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  try {
    httpServer?.close()
  } catch {
    // ignore
  }
})

boot()
