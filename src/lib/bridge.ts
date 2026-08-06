import packageMetadata from '../../package.json'
import type { AppSettings, AppUpdateState, ProjectSummary } from '../types/electron'
import { parseLedgerJson, summarize } from './ledger'

const BROWSER_PROJECTS_KEY = 'account-book-projects-v2'
const BROWSER_SETTINGS_KEY = 'account-book-settings-v2'

interface BrowserProject { id: string; content: string }
export interface BridgeResult<T = undefined> { ok: boolean; value?: T; error?: string; canceled?: boolean; warning?: string; path?: string }

function browserProjects(): BrowserProject[] {
  try { return JSON.parse(localStorage.getItem(BROWSER_PROJECTS_KEY) || '[]') as BrowserProject[] } catch { return [] }
}

function saveBrowserProjects(projects: BrowserProject[]) {
  localStorage.setItem(BROWSER_PROJECTS_KEY, JSON.stringify(projects))
}

function summaryFromContent(id: string, content: string): ProjectSummary {
  const data = parseLedgerJson(content)
  const summary = summarize(data)
  return {
    id,
    businessName: data.profile.businessName,
    initialCapitalCents: data.profile.initialCapitalCents,
    balanceCents: summary.balanceCents,
    transactionCount: data.transactions.length,
    createdAt: data.meta.createdAt,
    updatedAt: data.meta.updatedAt,
    error: null,
  }
}

export async function listProjectsBridge(): Promise<BridgeResult<ProjectSummary[]>> {
  if (window.ledgerDesktop) {
    const result = await window.ledgerDesktop.listProjects()
    return result.ok ? { ok: true, value: result.projects || [] } : { ok: false, error: result.error }
  }
  return { ok: true, value: browserProjects().map((item) => summaryFromContent(item.id, item.content)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }
}

export async function createProjectBridge(content: string): Promise<BridgeResult<ProjectSummary>> {
  if (window.ledgerDesktop) {
    const result = await window.ledgerDesktop.createProject(content)
    return result.ok ? { ok: true, value: result.project } : { ok: false, error: result.error }
  }
  const id = crypto.randomUUID()
  const projects = browserProjects()
  projects.push({ id, content })
  saveBrowserProjects(projects)
  return { ok: true, value: summaryFromContent(id, content) }
}

export async function openProjectBridge(id: string): Promise<BridgeResult> {
  if (window.ledgerDesktop) {
    const result = await window.ledgerDesktop.openProject(id)
    return { ok: result.ok, error: result.error }
  }
  window.location.href = `/?view=project&projectId=${encodeURIComponent(id)}`
  return { ok: true }
}

export async function readProjectBridge(id: string): Promise<BridgeResult<string | null>> {
  if (window.ledgerDesktop) {
    const result = await window.ledgerDesktop.readProject(id)
    return result.ok
      ? { ok: true, value: result.content || null, warning: result.warning, path: result.path }
      : { ok: false, error: result.error, path: result.path }
  }
  const project = browserProjects().find((item) => item.id === id)
  return project ? { ok: true, value: project.content } : { ok: false, error: '找不到这个生意项目' }
}

export async function saveProjectBridge(id: string, content: string): Promise<BridgeResult> {
  if (window.ledgerDesktop) {
    const result = await window.ledgerDesktop.saveProject(id, content)
    return { ok: result.ok, error: result.error, path: result.path }
  }
  const projects = browserProjects()
  const index = projects.findIndex((item) => item.id === id)
  if (index < 0) return { ok: false, error: '找不到这个生意项目' }
  projects[index] = { id, content }
  saveBrowserProjects(projects)
  return { ok: true }
}

export async function deleteProjectBridge(id: string): Promise<BridgeResult<string>> {
  if (window.ledgerDesktop) {
    const result = await window.ledgerDesktop.deleteProject(id)
    return result.ok ? { ok: true, value: result.recoverablePath || '' } : { ok: false, error: result.error }
  }
  saveBrowserProjects(browserProjects().filter((item) => item.id !== id))
  return { ok: true, value: '浏览器测试数据' }
}

export async function showLauncherBridge(): Promise<void> {
  if (window.ledgerDesktop) await window.ledgerDesktop.showLauncher()
  else window.location.href = '/?view=launcher'
}

export function getBrowserSettings(): AppSettings {
  const defaults: AppSettings = { version: 1, dataRoot: '浏览器本地存储（桌面版可自定义）', closeToTray: true, theme: 'system', migrationCompleted: true, recentProjectIds: [] }
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(BROWSER_SETTINGS_KEY) || '{}') } } catch { return defaults }
}

export async function getSettingsBridge(): Promise<BridgeResult<{ settings: AppSettings; projectWindowsOpen: number }>> {
  if (window.ledgerDesktop) {
    const result = await window.ledgerDesktop.getSettings()
    return result.ok && result.settings ? { ok: true, value: { settings: result.settings, projectWindowsOpen: result.projectWindowsOpen || 0 } } : { ok: false, error: result.error }
  }
  return { ok: true, value: { settings: getBrowserSettings(), projectWindowsOpen: 0 } }
}

export async function updateSettingsBridge(patch: { dataRoot?: string; closeToTray?: boolean; copyExisting?: boolean; theme?: 'light' | 'dark' | 'system' }): Promise<BridgeResult<AppSettings>> {
  if (window.ledgerDesktop) {
    const result = await window.ledgerDesktop.updateSettings(patch)
    return result.ok && result.settings ? { ok: true, value: result.settings } : { ok: false, error: result.error }
  }
  const settings = { ...getBrowserSettings(), ...patch, version: 1 as const }
  localStorage.setItem(BROWSER_SETTINGS_KEY, JSON.stringify(settings))
  return { ok: true, value: settings }
}

export async function closeCurrentProjectBridge(): Promise<void> {
  if (window.ledgerDesktop) await window.ledgerDesktop.closeCurrentProject()
  else window.location.href = '/?view=launcher'
}

function browserUpdateState(): AppUpdateState {
  return {
    status: 'unavailable',
    currentVersion: packageMetadata.version,
    latestVersion: null,
    progress: null,
    message: '浏览器预览模式不连接更新服务器',
    checkedAt: null,
  }
}

export async function getUpdateStateBridge(): Promise<BridgeResult<AppUpdateState>> {
  if (!window.ledgerDesktop) return { ok: true, value: browserUpdateState() }
  const result = await window.ledgerDesktop.getUpdateState()
  return result.ok && result.update ? { ok: true, value: result.update } : { ok: false, error: result.error }
}

export async function checkForUpdatesBridge(): Promise<BridgeResult<AppUpdateState>> {
  if (!window.ledgerDesktop) return { ok: true, value: browserUpdateState() }
  const result = await window.ledgerDesktop.checkForUpdates()
  return result.update
    ? { ok: result.ok, value: result.update, error: result.error }
    : { ok: false, error: result.error || '检查更新失败' }
}

export async function downloadUpdateBridge(): Promise<BridgeResult<AppUpdateState>> {
  if (!window.ledgerDesktop) return { ok: false, value: browserUpdateState(), error: '浏览器预览模式不能下载更新' }
  const result = await window.ledgerDesktop.downloadUpdate()
  return result.update
    ? { ok: result.ok, value: result.update, error: result.error }
    : { ok: false, error: result.error || '更新下载失败' }
}

export async function installUpdateBridge(): Promise<BridgeResult<AppUpdateState>> {
  if (!window.ledgerDesktop) return { ok: false, value: browserUpdateState(), error: '浏览器预览模式不能安装更新' }
  const result = await window.ledgerDesktop.installUpdate()
  return result.update
    ? { ok: result.ok, value: result.update, error: result.error }
    : { ok: false, error: result.error || '更新安装失败' }
}
