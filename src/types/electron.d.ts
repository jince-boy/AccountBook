export {}

export interface ProjectSummary {
  id: string
  businessName: string
  initialCapitalCents: number
  balanceCents: number
  transactionCount: number
  createdAt: string
  updatedAt: string
  error: string | null
}

export interface AppSettings {
  version: 1
  dataRoot: string
  closeToTray: boolean
  theme: 'light' | 'dark' | 'system'
  migrationCompleted: boolean
  recentProjectIds: string[]
}

export type AppUpdateStatus = 'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'error' | 'unavailable'

export interface AppUpdateState {
  status: AppUpdateStatus
  currentVersion: string
  latestVersion: string | null
  progress: number | null
  message: string
  checkedAt: string | null
}

type DesktopResult = {
  ok: boolean
  canceled?: boolean
  content?: string | null
  path?: string
  warning?: string
  error?: string
  project?: ProjectSummary
  projects?: ProjectSummary[]
  settings?: AppSettings
  projectWindowsOpen?: number
  recoverablePath?: string
  update?: AppUpdateState
}

declare global {
  interface Window {
    ledgerDesktop?: {
      listProjects: () => Promise<DesktopResult>
      createProject: (content: string) => Promise<DesktopResult>
      openProject: (id: string) => Promise<DesktopResult>
      readProject: (id: string) => Promise<DesktopResult>
      saveProject: (id: string, content: string) => Promise<DesktopResult>
      deleteProject: (id: string) => Promise<DesktopResult>
      importProjectFile: () => Promise<DesktopResult>
      exportProject: (id: string, content: string) => Promise<DesktopResult>
      showLauncher: () => Promise<DesktopResult>
      closeCurrentProject: () => Promise<DesktopResult>
      getSettings: () => Promise<DesktopResult>
      chooseDataRoot: () => Promise<DesktopResult>
      updateSettings: (settings: { dataRoot?: string; closeToTray?: boolean; copyExisting?: boolean; theme?: 'light' | 'dark' | 'system' }) => Promise<DesktopResult>
      showDataRoot: () => Promise<string>
      getUpdateState: () => Promise<DesktopResult>
      checkForUpdates: () => Promise<DesktopResult>
      downloadUpdate: () => Promise<DesktopResult>
      installUpdate: () => Promise<DesktopResult>
      onWorkspaceChanged: (callback: () => void) => () => void
      onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void
      onUpdateState: (callback: (state: AppUpdateState) => void) => () => void
    }
  }
}
