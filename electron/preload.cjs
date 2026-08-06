const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ledgerDesktop', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (content) => ipcRenderer.invoke('projects:create', content),
  openProject: (id) => ipcRenderer.invoke('projects:open', id),
  readProject: (id) => ipcRenderer.invoke('projects:read', id),
  saveProject: (id, content) => ipcRenderer.invoke('projects:save', id, content),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),
  importProjectFile: () => ipcRenderer.invoke('projects:import-file'),
  exportProject: (id, content) => ipcRenderer.invoke('projects:export', id, content),
  showLauncher: () => ipcRenderer.invoke('workspace:show-launcher'),
  closeCurrentProject: () => ipcRenderer.invoke('window:close-current-project'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  chooseDataRoot: () => ipcRenderer.invoke('settings:choose-root'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  showDataRoot: () => ipcRenderer.invoke('workspace:open-data-root'),
  getUpdateState: () => ipcRenderer.invoke('app:get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  onWorkspaceChanged: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('workspace:changed', handler)
    return () => ipcRenderer.removeListener('workspace:changed', handler)
  },
  onSettingsChanged: (callback) => {
    const handler = (_event, settings) => callback(settings)
    ipcRenderer.on('settings:changed', handler)
    return () => ipcRenderer.removeListener('settings:changed', handler)
  },
  onUpdateState: (callback) => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('app:update-state', handler)
    return () => ipcRenderer.removeListener('app:update-state', handler)
  },
})
