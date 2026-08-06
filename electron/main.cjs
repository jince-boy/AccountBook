const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } = require('electron')
const { autoUpdater } = require('electron-updater')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const fs = require('node:fs/promises')

const MAX_DATA_BYTES = 20 * 1024 * 1024
const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
let launcherWindow = null
const projectWindows = new Map()
const deletingProjects = new Set()
const closingProjectWindows = new WeakSet()
let tray = null
let isQuitting = false
let settingsCache = null
let updaterConfigured = false
let updaterListenersRegistered = false
let updateCheckPromise = null
let updateRepositoryCache = null
let updateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  latestVersion: null,
  progress: null,
  message: '尚未检查更新',
  checkedAt: null,
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

function defaultSettings() {
  return {
    version: 1,
    dataRoot: path.join(app.getPath('userData'), 'workspace'),
    closeToTray: true,
    theme: 'system',
    migrationCompleted: false,
    recentProjectIds: [],
  }
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function iconPath() {
  return path.join(__dirname, '..', 'build', 'icon.png')
}

function updaterWindows() {
  const windows = []
  if (launcherWindow && !launcherWindow.isDestroyed()) windows.push(launcherWindow)
  for (const window of projectWindows.values()) {
    if (!window.isDestroyed()) windows.push(window)
  }
  return windows
}

function publishUpdateState(patch) {
  updateState = { ...updateState, ...patch }
  for (const window of updaterWindows()) window.webContents.send('app:update-state', updateState)
  return updateState
}

function updaterErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || '未知错误')
  return message.replace(/https?:\/\/[^\s]+/g, '更新服务器').slice(0, 240)
}

function parseUpdateRepository(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const normalized = value.trim().replace(/\.git$/i, '').replace(/\/$/, '')
  const githubMatch = normalized.match(/github\.com[/:]([^/]+)\/([^/]+)$/i)
  const shortMatch = normalized.match(/^([^/\s]+)\/([^/\s]+)$/)
  const match = githubMatch || shortMatch
  if (!match) return null
  return { owner: match[1], repo: match[2], slug: `${match[1]}/${match[2]}` }
}

async function resolveUpdateRepository() {
  if (updateRepositoryCache) return updateRepositoryCache
  let repository = process.env.ACCOUNTBOOK_UPDATE_REPOSITORY || ''
  if (!repository) {
    try {
      const metadata = JSON.parse(await fs.readFile(path.join(app.getAppPath(), 'package.json'), 'utf8'))
      repository = metadata.updateRepository || metadata.repository?.url || metadata.repository || ''
    } catch (error) {
      console.error('读取更新仓库配置失败', error)
    }
  }
  updateRepositoryCache = parseUpdateRepository(repository)
  return updateRepositoryCache
}

function registerUpdaterListeners() {
  if (updaterListenersRegistered) return
  updaterListenersRegistered = true
  autoUpdater.on('checking-for-update', () => publishUpdateState({ status: 'checking', progress: null, message: '正在连接更新服务器…' }))
  autoUpdater.on('update-available', (info) => publishUpdateState({
    status: 'available',
    latestVersion: info.version,
    progress: null,
    message: `发现新版本 ${info.version}`,
    checkedAt: new Date().toISOString(),
  }))
  autoUpdater.on('update-not-available', (info) => publishUpdateState({
    status: 'up-to-date',
    latestVersion: info?.version || app.getVersion(),
    progress: null,
    message: '当前已经是最新版本',
    checkedAt: new Date().toISOString(),
  }))
  autoUpdater.on('download-progress', (progress) => publishUpdateState({
    status: 'downloading',
    progress: Math.max(0, Math.min(100, Number(progress.percent.toFixed(1)))),
    message: `正在下载新版本 ${progress.percent.toFixed(1)}%`,
  }))
  autoUpdater.on('update-downloaded', (info) => publishUpdateState({
    status: 'downloaded',
    latestVersion: info.version,
    progress: 100,
    message: `新版本 ${info.version} 已下载，可以重启安装`,
    checkedAt: new Date().toISOString(),
  }))
  autoUpdater.on('error', (error) => publishUpdateState({
    status: 'error',
    progress: null,
    message: `检查更新失败：${updaterErrorMessage(error)}`,
    checkedAt: new Date().toISOString(),
  }))
}

async function configureUpdater() {
  if (updaterConfigured) return true
  const repository = await resolveUpdateRepository()
  if (!repository) return false
  registerUpdaterListeners()
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.setFeedURL({ provider: 'github', owner: repository.owner, repo: repository.repo })
  updaterConfigured = true
  return true
}

async function checkForApplicationUpdates() {
  if (!app.isPackaged && !process.env.ACCOUNTBOOK_UPDATE_REPOSITORY) {
    return { ok: true, update: publishUpdateState({ status: 'unavailable', message: '开发模式不连接更新服务器', checkedAt: new Date().toISOString() }) }
  }
  if (!await configureUpdater()) {
    return { ok: false, error: '当前安装包没有配置更新仓库', update: publishUpdateState({ status: 'unavailable', message: '当前安装包没有配置更新仓库', checkedAt: new Date().toISOString() }) }
  }
  if (updateCheckPromise) return updateCheckPromise
  publishUpdateState({ status: 'checking', progress: null, message: '正在检查最新版本…' })
  updateCheckPromise = autoUpdater.checkForUpdates()
    .then(() => ({ ok: true, update: updateState }))
    .catch((error) => ({ ok: false, error: updaterErrorMessage(error), update: updateState }))
    .finally(() => { updateCheckPromise = null })
  return updateCheckPromise
}

async function downloadApplicationUpdate() {
  if (!await configureUpdater()) return { ok: false, error: '当前安装包没有配置更新仓库', update: updateState }
  if (updateState.status !== 'available') return { ok: false, error: '当前没有可下载的新版本', update: updateState }
  try {
    publishUpdateState({ status: 'downloading', progress: 0, message: '准备下载新版本…' })
    await autoUpdater.downloadUpdate()
    return { ok: true, update: updateState }
  } catch (error) {
    return { ok: false, error: updaterErrorMessage(error), update: updateState }
  }
}

function installDownloadedUpdate() {
  if (updateState.status !== 'downloaded') return { ok: false, error: '新版本尚未下载完成', update: updateState }
  setImmediate(() => {
    isQuitting = true
    autoUpdater.quitAndInstall(false, true)
  })
  return { ok: true, update: updateState }
}

function scheduleBackgroundUpdateCheck() {
  if (!app.isPackaged) return
  const timer = setTimeout(() => void checkForApplicationUpdates(), 8000)
  timer.unref?.()
}

async function readSettings() {
  if (settingsCache) return settingsCache
  const defaults = defaultSettings()
  try {
    const parsed = JSON.parse(await readUtf8File(settingsPath()))
    settingsCache = {
      ...defaults,
      dataRoot: typeof parsed.dataRoot === 'string' && path.isAbsolute(parsed.dataRoot) ? parsed.dataRoot : defaults.dataRoot,
      closeToTray: parsed.closeToTray !== false,
      theme: ['light', 'dark', 'system'].includes(parsed.theme) ? parsed.theme : 'system',
      migrationCompleted: parsed.migrationCompleted === true,
      recentProjectIds: Array.isArray(parsed.recentProjectIds)
        ? parsed.recentProjectIds.filter((id) => typeof id === 'string' && PROJECT_ID_PATTERN.test(id)).slice(0, 30)
        : [],
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('读取设置失败，已使用默认设置', error)
    settingsCache = defaults
  }
  await ensureWorkspace(settingsCache.dataRoot)
  return settingsCache
}

async function writeSettings(next) {
  settingsCache = { ...next, version: 1 }
  await atomicWrite(settingsPath(), JSON.stringify(settingsCache, null, 2), `${settingsPath()}.backup`)
  return settingsCache
}

async function ensureWorkspace(root) {
  await fs.mkdir(path.join(root, 'projects'), { recursive: true })
  await fs.mkdir(path.join(root, '.trash'), { recursive: true })
}

function assertProjectId(id) {
  if (typeof id !== 'string' || !PROJECT_ID_PATTERN.test(id)) throw new Error('项目编号无效')
  return id
}

function projectIdFromArguments(argumentsList) {
  const value = argumentsList.find((item) => typeof item === 'string' && item.startsWith('--open-project='))?.slice('--open-project='.length)
  return value && PROJECT_ID_PATTERN.test(value) ? value : null
}

async function projectPaths(id) {
  assertProjectId(id)
  const settings = await readSettings()
  const directory = path.join(settings.dataRoot, 'projects', id)
  return {
    directory,
    file: path.join(directory, 'ledger.json'),
    backup: path.join(directory, 'ledger.backup.json'),
  }
}

async function readUtf8File(file) {
  const stat = await fs.stat(file)
  if (stat.size > MAX_DATA_BYTES) throw new Error('数据文件超过 20MB，无法安全读取')
  return fs.readFile(file, 'utf8')
}

async function atomicWrite(file, content, backup) {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_DATA_BYTES) {
    throw new Error('数据内容无效或超过 20MB')
  }
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temporary, content, 'utf8')
  try {
    await fs.copyFile(file, backup)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  try {
    await fs.rm(file, { force: true })
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

function inspectLedger(content, id) {
  const value = JSON.parse(content)
  if (!value || value.version !== 1 || !value.profile || !Array.isArray(value.transactions)) {
    throw new Error('账本格式无效')
  }
  const initial = value.profile.initialCapitalCents
  if (!Number.isSafeInteger(initial) || initial < 0) throw new Error('初始本金无效')
  let balance = BigInt(initial)
  for (const item of value.transactions) {
    if (!item || !['income', 'expense', 'investment'].includes(item.kind) || !Number.isSafeInteger(item.amountCents) || item.amountCents <= 0) {
      throw new Error('交易数据无效')
    }
    balance += item.kind === 'expense' ? -BigInt(item.amountCents) : BigInt(item.amountCents)
  }
  if (balance > BigInt(Number.MAX_SAFE_INTEGER) || balance < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('累计金额超出安全范围')
  return {
    id,
    businessName: typeof value.profile.businessName === 'string' ? value.profile.businessName.slice(0, 60) : '未命名项目',
    initialCapitalCents: initial,
    balanceCents: Number(balance),
    transactionCount: value.transactions.length,
    createdAt: value.meta?.createdAt || '',
    updatedAt: value.meta?.updatedAt || '',
    error: null,
  }
}

async function listProjects() {
  const settings = await readSettings()
  await ensureWorkspace(settings.dataRoot)
  const entries = await fs.readdir(path.join(settings.dataRoot, 'projects'), { withFileTypes: true })
  const summaries = await Promise.all(entries.filter((entry) => entry.isDirectory() && PROJECT_ID_PATTERN.test(entry.name)).map(async (entry) => {
    try {
      const { file } = await projectPaths(entry.name)
      return inspectLedger(await readUtf8File(file), entry.name)
    } catch (error) {
      return { id: entry.name, businessName: '账本读取异常', initialCapitalCents: 0, balanceCents: 0, transactionCount: 0, createdAt: '', updatedAt: '', error: error.message }
    }
  }))
  const recentOrder = new Map(settings.recentProjectIds.map((id, index) => [id, index]))
  return summaries.sort((a, b) => {
    const aRecent = recentOrder.get(a.id) ?? 999
    const bRecent = recentOrder.get(b.id) ?? 999
    return aRecent - bRecent || b.updatedAt.localeCompare(a.updatedAt)
  })
}

async function createProject(content) {
  inspectLedger(content, 'new')
  const id = randomUUID()
  const paths = await projectPaths(id)
  await fs.mkdir(paths.directory, { recursive: true })
  await atomicWrite(paths.file, content, paths.backup)
  return inspectLedger(content, id)
}

async function readProject(id) {
  const paths = await projectPaths(id)
  try {
    return { ok: true, content: await readUtf8File(paths.file), path: paths.file }
  } catch (error) {
    try {
      return { ok: true, content: await readUtf8File(paths.backup), path: paths.file, warning: '主数据文件读取失败，已从该项目的自动备份恢复' }
    } catch {
      return { ok: false, error: error.message, path: paths.file }
    }
  }
}

async function saveProject(id, content) {
  const summary = inspectLedger(content, id)
  const paths = await projectPaths(id)
  await atomicWrite(paths.file, content, paths.backup)
  const window = projectWindows.get(id)
  if (window && !window.isDestroyed()) window.setTitle(`${summary.businessName} · 生意账本`)
  rebuildTrayMenu()
  return paths.file
}

function makeWindow(options) {
  return new BrowserWindow({
    backgroundColor: '#f4f6f2',
    autoHideMenuBar: true,
    icon: iconPath(),
    show: false,
    ...options,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
}

function loadWindow(window, query) {
  const queryString = new URLSearchParams(query).toString()
  if (app.isPackaged) return window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query })
  return window.loadURL(`http://127.0.0.1:5173/?${queryString}`)
}

async function showLauncher() {
  if (projectWindows.size > 0) {
    const target = [...projectWindows.values()].at(-1)
    target?.show()
    target?.focus()
    return null
  }
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.webContents.send('workspace:changed')
    launcherWindow.show()
    launcherWindow.focus()
    return launcherWindow
  }
  launcherWindow = makeWindow({ width: 900, height: 620, minWidth: 900, minHeight: 620, maxWidth: 900, maxHeight: 620, resizable: false, maximizable: false, fullscreenable: false, title: '生意账本 · 项目中心' })
  launcherWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  launcherWindow.once('ready-to-show', () => launcherWindow?.show())
  launcherWindow.on('close', (event) => {
    if (isQuitting) return
    if (settingsCache?.closeToTray) {
      event.preventDefault()
      launcherWindow?.hide()
      createTray()
    }
  })
  launcherWindow.on('closed', () => {
    launcherWindow = null
    if (!isQuitting && projectWindows.size === 0) app.quit()
  })
  await loadWindow(launcherWindow, { view: 'launcher' })
  return launcherWindow
}

async function openProjectWindow(id) {
  assertProjectId(id)
  const existing = projectWindows.get(id)
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return
  }
  const result = await readProject(id)
  if (!result.ok) throw new Error(result.error)
  const summary = inspectLedger(result.content, id)
  const window = makeWindow({ width: 1040, height: 680, minWidth: 1040, minHeight: 680, maxWidth: 1040, maxHeight: 680, resizable: false, maximizable: false, fullscreenable: false, title: `${summary.businessName} · 生意账本` })
  projectWindows.set(id, window)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.once('ready-to-show', () => {
    window.show()
    if (launcherWindow && !launcherWindow.isDestroyed()) launcherWindow.destroy()
  })
  window.on('close', (event) => {
    if (isQuitting || closingProjectWindows.has(window)) return
    if (settingsCache?.closeToTray) {
      event.preventDefault()
      window.hide()
      createTray()
    }
  })
  window.on('closed', () => {
    closingProjectWindows.delete(window)
    projectWindows.delete(id)
    rebuildTrayMenu()
    if (!isQuitting && projectWindows.size === 0) {
      if (settingsCache?.closeToTray) createTray()
      else app.quit()
    }
  })
  await loadWindow(window, { view: 'project', projectId: id })
  const settings = await readSettings()
  await writeSettings({ ...settings, recentProjectIds: [id, ...settings.recentProjectIds.filter((item) => item !== id)].slice(0, 30) })
  rebuildTrayMenu()
}

function createTray() {
  if (tray) return tray
  const image = nativeImage.createFromPath(iconPath()).resize({ width: 18, height: 18 })
  tray = new Tray(image)
  tray.setToolTip('生意账本')
  tray.on('double-click', () => void showLauncher())
  rebuildTrayMenu()
  return tray
}

function rebuildTrayMenu() {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '退出', click: () => { isQuitting = true; app.quit() } },
  ]))
}

async function migrateLegacyLedger() {
  const settings = await readSettings()
  if (settings.migrationCompleted) return
  const legacyFile = path.join(app.getPath('userData'), 'data', 'account-book-data.json')
  try {
    const content = await readUtf8File(legacyFile)
    inspectLedger(content, 'legacy')
    const projects = await listProjects()
    if (!projects.length) await createProject(content)
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('旧账本迁移跳过', error)
  }
  await writeSettings({ ...settings, migrationCompleted: true })
}

async function copyProjects(sourceRoot, targetRoot) {
  if (path.resolve(sourceRoot) === path.resolve(targetRoot)) return
  await ensureWorkspace(targetRoot)
  const source = path.join(sourceRoot, 'projects')
  let entries = []
  try { entries = await fs.readdir(source, { withFileTypes: true }) } catch (error) { if (error.code !== 'ENOENT') throw error }
  for (const entry of entries) {
    if (!entry.isDirectory() || !PROJECT_ID_PATTERN.test(entry.name)) continue
    const target = path.join(targetRoot, 'projects', entry.name)
    try {
      await fs.access(target)
    } catch {
      await fs.cp(path.join(source, entry.name), target, { recursive: true, errorOnExist: true })
    }
  }
}

async function moveProjectToTrash(source, target, id) {
  let renameError = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await fs.rename(source, target)
      return
    } catch (error) {
      renameError = error
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error
      await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)))
    }
  }

  try {
    await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false })
    const copiedLedger = await readUtf8File(path.join(target, 'ledger.json'))
    inspectLedger(copiedLedger, id)
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true }).catch(() => {})
    throw new Error(`项目移入回收目录失败，原项目保持不变：${error.message || renameError?.message || '未知错误'}`)
  }

  try {
    await fs.rm(source, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 })
  } catch (error) {
    throw new Error(`项目已安全复制到回收目录，但原目录暂时无法移除：${error.message}`)
  }
}

function registerIpc() {
  ipcMain.handle('projects:list', async () => ({ ok: true, projects: await listProjects() }))
  ipcMain.handle('projects:create', async (_event, content) => {
    try { const project = await createProject(content); launcherWindow?.webContents.send('workspace:changed'); return { ok: true, project } } catch (error) { return { ok: false, error: error.message } }
  })
  ipcMain.handle('projects:open', async (_event, id) => {
    try { await openProjectWindow(id); return { ok: true } } catch (error) { return { ok: false, error: error.message } }
  })
  ipcMain.handle('projects:read', async (_event, id) => readProject(id))
  ipcMain.handle('projects:save', async (_event, id, content) => {
    try { return { ok: true, path: await saveProject(id, content) } } catch (error) { return { ok: false, error: error.message } }
  })
  ipcMain.handle('projects:delete', async (_event, id) => {
    try {
      assertProjectId(id)
      const openWindow = projectWindows.get(id)
      if (openWindow?.isDestroyed()) projectWindows.delete(id)
      else if (openWindow) throw new Error('该项目正在打开，请先关闭项目窗口再移除')
      if (deletingProjects.has(id)) throw new Error('该项目正在移除，请稍候')
      deletingProjects.add(id)
      const settings = await readSettings()
      const source = (await projectPaths(id)).directory
      const stat = await fs.stat(source).catch((error) => {
        if (error.code === 'ENOENT') throw new Error('项目不存在或已经被移除')
        throw error
      })
      if (!stat.isDirectory()) throw new Error('项目目录无效，未执行移除')
      const trashRoot = path.join(settings.dataRoot, '.trash')
      await fs.mkdir(trashRoot, { recursive: true })
      const target = path.join(trashRoot, `${id}-${Date.now()}-${randomUUID().slice(0, 8)}`)
      await moveProjectToTrash(source, target, id)
      await writeSettings({ ...settings, recentProjectIds: settings.recentProjectIds.filter((projectId) => projectId !== id) })
      launcherWindow?.webContents.send('workspace:changed')
      return { ok: true, recoverablePath: target }
    } catch (error) { return { ok: false, error: error.message } }
    finally { deletingProjects.delete(id) }
  })
  ipcMain.handle('projects:import-file', async (event) => {
    const options = { title: '导入生意项目', properties: ['openFile'], filters: [{ name: 'JSON 数据文件', extensions: ['json'] }] }
    const owner = BrowserWindow.fromWebContents(event.sender) || launcherWindow
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
    try { return { ok: true, content: await readUtf8File(result.filePaths[0]), path: result.filePaths[0] } } catch (error) { return { ok: false, error: error.message } }
  })
  ipcMain.handle('projects:export', async (_event, id, content) => {
    try {
      const summary = inspectLedger(content, id)
      const owner = projectWindows.get(id) || launcherWindow
      const result = await dialog.showSaveDialog(owner, { title: '导出项目账本', defaultPath: `${summary.businessName}-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON 数据文件', extensions: ['json'] }] })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      await fs.writeFile(result.filePath, content, 'utf8')
      return { ok: true, path: result.filePath }
    } catch (error) { return { ok: false, error: error.message } }
  })
  ipcMain.handle('workspace:show-launcher', async () => { await showLauncher(); return { ok: true } })
  ipcMain.handle('window:close-current-project', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window && [...projectWindows.values()].includes(window)) {
      closingProjectWindows.add(window)
      window.close()
    }
    return { ok: true }
  })
  ipcMain.handle('settings:get', async () => ({ ok: true, settings: await readSettings(), projectWindowsOpen: projectWindows.size }))
  ipcMain.handle('settings:choose-root', async (event) => {
    const settings = await readSettings()
    const options = { title: '选择账本数据保存目录', defaultPath: settings.dataRoot, properties: ['openDirectory', 'createDirectory'] }
    const owner = BrowserWindow.fromWebContents(event.sender) || launcherWindow
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    return result.canceled ? { ok: false, canceled: true } : { ok: true, path: result.filePaths[0] }
  })
  ipcMain.handle('settings:update', async (_event, patch) => {
    try {
      const current = await readSettings()
      const nextRoot = typeof patch.dataRoot === 'string' && path.isAbsolute(patch.dataRoot) ? path.resolve(patch.dataRoot) : current.dataRoot
      if (nextRoot !== current.dataRoot && projectWindows.size > 0) throw new Error('请先关闭所有项目窗口，再切换数据保存位置')
      const relativeToCurrent = path.relative(current.dataRoot, nextRoot)
      const relativeToNext = path.relative(nextRoot, current.dataRoot)
      const nestedInCurrent = relativeToCurrent !== '' && !relativeToCurrent.startsWith('..') && !path.isAbsolute(relativeToCurrent)
      const currentNestedInNext = relativeToNext !== '' && !relativeToNext.startsWith('..') && !path.isAbsolute(relativeToNext)
      if (nextRoot !== current.dataRoot && (nestedInCurrent || currentNestedInNext)) {
        throw new Error('新旧数据目录不能互相嵌套，请选择其他位置')
      }
      if (nextRoot !== current.dataRoot && patch.copyExisting === true) await copyProjects(current.dataRoot, nextRoot)
      await ensureWorkspace(nextRoot)
      const theme = ['light', 'dark', 'system'].includes(patch.theme) ? patch.theme : current.theme
      const next = await writeSettings({ ...current, dataRoot: nextRoot, closeToTray: patch.closeToTray !== false, theme })
      if (next.closeToTray) createTray()
      else if (tray) { tray.destroy(); tray = null }
      launcherWindow?.webContents.send('workspace:changed')
      launcherWindow?.webContents.send('settings:changed', next)
      for (const window of projectWindows.values()) window.webContents.send('settings:changed', next)
      return { ok: true, settings: next }
    } catch (error) { return { ok: false, error: error.message } }
  })
  ipcMain.handle('workspace:open-data-root', async () => { const settings = await readSettings(); return shell.openPath(settings.dataRoot) })
  ipcMain.handle('app:get-update-state', async () => ({ ok: true, update: updateState }))
  ipcMain.handle('app:check-for-updates', async () => checkForApplicationUpdates())
  ipcMain.handle('app:download-update', async () => downloadApplicationUpdate())
  ipcMain.handle('app:install-update', async () => installDownloadedUpdate())
}

if (hasSingleInstanceLock) {
  app.on('second-instance', (_event, commandLine) => {
    const projectId = projectIdFromArguments(commandLine)
    if (projectId) void openProjectWindow(projectId).catch(() => void showLauncher())
    else void showLauncher()
  })
  app.whenReady().then(async () => {
    settingsCache = await readSettings()
    await migrateLegacyLedger()
    registerIpc()
    if (settingsCache.closeToTray) createTray()
    await showLauncher()
    const initialProjectId = projectIdFromArguments(process.argv)
    if (initialProjectId) await openProjectWindow(initialProjectId).catch(() => {})
    scheduleBackgroundUpdateCheck()
    app.on('activate', () => void showLauncher())
  })
}

app.on('before-quit', () => { isQuitting = true })
