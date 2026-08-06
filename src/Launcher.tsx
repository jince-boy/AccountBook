import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BriefcaseBusiness,
  ChevronRight,
  Clock3,
  Download,
  FolderOpen,
  Import,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Moon,
  Monitor,
  PackageCheck,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react'
import type { AppSettings, AppUpdateState, ProjectSummary } from './types/electron'
import {
  checkForUpdatesBridge,
  createProjectBridge,
  deleteProjectBridge,
  downloadUpdateBridge,
  getSettingsBridge,
  getUpdateStateBridge,
  installUpdateBridge,
  listProjectsBridge,
  openProjectBridge,
  updateSettingsBridge,
} from './lib/bridge'
import { centsToInput, createLedger, formatMoney, parseLedgerJson, parseMoneyToCents, serializeLedger, summarize } from './lib/ledger'
import { applyTheme } from './lib/theme'
import { ToastNotice } from './components/UiControls'

type ImportCandidate = { content: string; path: string }

export default function Launcher() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [projectWindowsOpen, setProjectWindowsOpen] = useState(0)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [importCandidate, setImportCandidate] = useState<ImportCandidate | null>(null)
  const [deletingProject, setDeletingProject] = useState<ProjectSummary | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    document.title = '生意账本 · 项目中心'
    void refresh()
    return window.ledgerDesktop?.onWorkspaceChanged(() => void refresh())
  }, [])
  useEffect(() => settings ? applyTheme(settings.theme) : undefined, [settings?.theme])
  useEffect(() => window.ledgerDesktop?.onSettingsChanged((next) => setSettings(next)), [])
  useEffect(() => window.ledgerDesktop?.onUpdateState((next) => {
    if (next.status === 'available') setToast(`发现新版本 ${next.latestVersion}，可在全局设置中下载`)
    if (next.status === 'downloaded') setToast(`新版本 ${next.latestVersion} 已下载，可在全局设置中重启安装`)
  }), [])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3000)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function refresh() {
    setLoading(true)
    const [projectResult, settingsResult] = await Promise.all([listProjectsBridge(), getSettingsBridge()])
    if (projectResult.ok) setProjects(projectResult.value || [])
    else setToast(projectResult.error || '项目列表读取失败')
    if (settingsResult.ok && settingsResult.value) {
      setSettings(settingsResult.value.settings)
      setProjectWindowsOpen(settingsResult.value.projectWindowsOpen)
    }
    setLoading(false)
  }

  async function createAndOpen(content: string) {
    const result = await createProjectBridge(content)
    if (!result.ok || !result.value) return setToast(result.error || '项目创建失败')
    setCreateOpen(false)
    setImportCandidate(null)
    await refresh()
    const opened = await openProjectBridge(result.value.id)
    if (!opened.ok) setToast(opened.error || '项目窗口打开失败')
  }

  async function openProject(project: ProjectSummary) {
    if (project.error) return setToast(`项目无法打开：${project.error}`)
    const result = await openProjectBridge(project.id)
    if (!result.ok) setToast(result.error || '项目窗口打开失败')
  }

  async function deleteProject(project: ProjectSummary) {
    if (deleteBusy) return
    setDeleteBusy(true)
    try {
      const result = await deleteProjectBridge(project.id)
      if (!result.ok) return setToast(result.error || '项目移除失败')
      setProjects((items) => items.filter((item) => item.id !== project.id))
      setDeletingProject(null)
      setToast('项目已安全移入可恢复的回收目录')
    } finally {
      setDeleteBusy(false)
    }
  }

  async function chooseImport() {
    if (!window.ledgerDesktop) {
      document.getElementById('launcher-import')?.click()
      return
    }
    const result = await window.ledgerDesktop.importProjectFile()
    if (!result.ok) {
      if (!result.canceled) setToast(result.error || '读取导入文件失败')
      return
    }
    validateImport(result.content || '', result.path || '所选文件')
  }

  function validateImport(content: string, path: string) {
    try {
      parseLedgerJson(content)
      setImportCandidate({ content, path })
    } catch (error) {
      setToast(error instanceof Error ? error.message : '导入文件格式无效')
    }
  }

  const filtered = useMemo(() => projects.filter((project) => project.businessName.toLowerCase().includes(query.trim().toLowerCase())), [projects, query])
  const portfolioBalanceBig = projects.reduce((total, item) => total + BigInt(item.error ? 0 : item.balanceCents), 0n)
  const portfolioBalance = portfolioBalanceBig <= BigInt(Number.MAX_SAFE_INTEGER) && portfolioBalanceBig >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(portfolioBalanceBig)
    : null
  const transactionCount = projects.reduce((total, item) => total + item.transactionCount, 0)

  return <div className="launcher-shell">
    <header className="launcher-header">
      <div className="brand launcher-brand"><span className="brand-mark"><WalletCards size={19} /></span><div><strong>生意账本</strong><span>PROJECT WORKSPACE</span></div></div>
      <div className="launcher-header-actions">
        <span className="local-badge"><ShieldCheck size={13} /> 本地离线工作区</span>
        <button className="icon-button" title="全局设置" onClick={() => setSettingsOpen(true)}><Settings size={16} /></button>
      </div>
    </header>

    <main className="launcher-main">
      <section className="launcher-hero">
        <div><span className="eyebrow">PROJECT CENTER</span><h1>今天要管理哪个生意？</h1></div>
        <div className="launcher-primary-actions">
          <button className="button secondary" onClick={() => void chooseImport()}><Import size={14} /> 导入项目</button>
          <button className="button primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> 创建新项目</button>
        </div>
      </section>

      <section className="portfolio-strip">
        <div><span>生意项目</span><strong>{projects.length}</strong><small>个独立账本</small></div>
        <div><span>全部项目余额</span><strong>{portfolioBalance === null ? '超出安全汇总范围' : formatMoney(portfolioBalance)}</strong><small>仅用于项目总览</small></div>
        <div><span>累计资金记录</span><strong>{transactionCount}</strong><small>笔收入、支出与投入</small></div>
      </section>

      <section className="project-section">
        <div className="project-section-heading"><div><h2>我的生意项目</h2></div>{projects.length > 3 && <label className="search-box"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" /></label>}</div>
        {loading ? <LauncherLoading /> : filtered.length ? <div className="project-grid">{filtered.map((project, index) => <ProjectCard key={project.id} project={project} index={index} onOpen={() => void openProject(project)} onDelete={() => setDeletingProject(project)} />)}<button className="new-project-card" onClick={() => setCreateOpen(true)}><span><Plus size={20} /></span><strong>创建另一个生意项目</strong></button></div> : <LauncherEmpty hasQuery={Boolean(query)} onCreate={() => setCreateOpen(true)} onImport={() => void chooseImport()} />}
      </section>
    </main>

    <footer className="launcher-footer"><span>生意账本 2.0</span><span><i /> 自动保存 · JSON 数据 · 精确到分</span></footer>

    {createOpen && <CreateProjectModal onClose={() => setCreateOpen(false)} onCreate={(content) => void createAndOpen(content)} />}
    {importCandidate && <ImportProjectModal candidate={importCandidate} onClose={() => setImportCandidate(null)} onConfirm={() => void createAndOpen(importCandidate.content)} />}
    {deletingProject && <DeleteProjectModal project={deletingProject} busy={deleteBusy} onClose={() => { if (!deleteBusy) setDeletingProject(null) }} onConfirm={() => void deleteProject(deletingProject)} />}
    {settingsOpen && settings && <GlobalSettingsModal settings={settings} projectWindowsOpen={projectWindowsOpen} onClose={() => setSettingsOpen(false)} onSaved={(next) => { setSettings(next); setSettingsOpen(false); void refresh(); setToast('全局设置已保存') }} onError={setToast} />}
    {toast && <ToastNotice message={toast} onClose={() => setToast('')} />}
    <input id="launcher-import" hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((content) => validateImport(content, file.name)); event.target.value = '' }} />
  </div>
}

function ProjectCard({ project, index, onOpen, onDelete }: { project: ProjectSummary; index: number; onOpen: () => void; onDelete: () => void }) {
  const colors = ['green', 'blue', 'amber', 'purple', 'slate']
  return <article className={`project-card ${project.error ? 'damaged' : ''}`}>
    <button className="project-open-area" onClick={onOpen}>
      <span className={`project-avatar ${colors[index % colors.length]}`}>{project.error ? '!' : project.businessName.slice(0, 1)}</span>
      <span className="project-info"><strong>{project.businessName}</strong><small>{project.error || `${project.transactionCount} 笔记录 · 更新于 ${formatRelativeDate(project.updatedAt)}`}</small></span>
      <span className="project-money"><small>当前余额</small><strong>{project.error ? '无法读取' : formatMoney(project.balanceCents)}</strong></span>
      <ArrowRight size={16} />
    </button>
    <button className="project-more" title={`移除项目：${project.businessName}`} aria-label={`移除项目：${project.businessName}`} onClick={onDelete}><Trash2 size={14} /></button>
  </article>
}

export function CreateProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (content: string) => void }) {
  const [name, setName] = useState('')
  const [capital, setCapital] = useState('')
  const [error, setError] = useState('')
  function submit(event: React.FormEvent) {
    event.preventDefault()
    const cents = parseMoneyToCents(capital)
    if (cents === null) return setError('请输入正确的本金金额，最多保留两位小数')
    if (!name.trim()) return setError('请填写一个便于识别的项目名称')
    onCreate(serializeLedger(createLedger(name, cents)))
  }
  return <LauncherModal onClose={onClose}><div className="modal-heading"><div><span className="eyebrow">NEW PROJECT</span><h2>创建一个生意项目</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><form onSubmit={submit} className="transaction-form"><LauncherField label="项目名称"><input autoFocus value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="例如：城南咖啡店" /></LauncherField><LauncherField label="初始本金（元）" hint="项目开始经营前可使用的资金"><div className="money-input large"><span>¥</span><input inputMode="decimal" value={capital} onChange={(event) => setCapital(event.target.value)} placeholder="0.00" /></div></LauncherField>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" type="submit">创建并打开</button></div></form></LauncherModal>
}

export function ImportProjectModal({ candidate, onClose, onConfirm }: { candidate: ImportCandidate; onClose: () => void; onConfirm: () => void }) {
  const data = parseLedgerJson(candidate.content)
  const summary = summarize(data)
  return <LauncherModal onClose={onClose}><div className="modal-heading"><div><span className="eyebrow">VALID JSON</span><h2>作为新项目导入？</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="import-preview"><div><span>项目名称</span><strong>{data.profile.businessName}</strong></div><div><span>初始本金</span><strong>{formatMoney(data.profile.initialCapitalCents)}</strong></div><div><span>当前余额</span><strong>{formatMoney(summary.balanceCents)}</strong></div><div><span>资金记录</span><strong>{data.transactions.length} 笔</strong></div></div><p className="success-box"><ShieldCheck size={14} /> 文件校验通过。导入会创建新项目，不会覆盖任何现有账本。</p><div className="modal-actions"><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" onClick={onConfirm}>导入并打开</button></div></LauncherModal>
}

export function GlobalSettingsModal({ settings, projectWindowsOpen, onClose, onSaved, onError }: { settings: AppSettings; projectWindowsOpen: number; onClose: () => void; onSaved: (settings: AppSettings) => void; onError: (message: string) => void }) {
  const [dataRoot, setDataRoot] = useState(settings.dataRoot)
  const [closeToTray, setCloseToTray] = useState(settings.closeToTray)
  const [copyExisting, setCopyExisting] = useState(true)
  const [theme, setTheme] = useState(settings.theme)
  const [update, setUpdate] = useState<AppUpdateState | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const rootChanged = dataRoot !== settings.dataRoot

  useEffect(() => {
    let active = true
    void getUpdateStateBridge().then((result) => {
      if (active && result.value) setUpdate(result.value)
    })
    const unsubscribe = window.ledgerDesktop?.onUpdateState((next) => {
      if (active) setUpdate(next)
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  async function chooseRoot() {
    if (!window.ledgerDesktop) return onError('桌面应用中可以选择实际文件夹')
    const result = await window.ledgerDesktop.chooseDataRoot()
    if (result.ok && result.path) setDataRoot(result.path)
    else if (!result.canceled) onError(result.error || '文件夹选择失败')
  }
  async function save() {
    const result = await updateSettingsBridge({ dataRoot, closeToTray, copyExisting, theme })
    if (!result.ok || !result.value) return onError(result.error || '设置保存失败')
    onSaved(result.value)
  }

  async function handleUpdateAction() {
    if (!update || updateBusy || update.status === 'checking' || update.status === 'downloading') return
    setUpdateBusy(true)
    try {
      const result = update.status === 'available'
        ? await downloadUpdateBridge()
        : update.status === 'downloaded'
          ? await installUpdateBridge()
          : await checkForUpdatesBridge()
      if (result.value) setUpdate(result.value)
      if (!result.ok) onError(result.error || '软件更新操作失败')
    } finally {
      setUpdateBusy(false)
    }
  }

  const updateButtonLabel = updateBusy || update?.status === 'checking'
    ? '检查中…'
    : update?.status === 'available'
      ? '下载更新'
      : update?.status === 'downloading'
        ? `${update.progress?.toFixed(0) || 0}%`
        : update?.status === 'downloaded'
          ? '重启安装'
          : '检查更新'

  return <LauncherModal onClose={onClose} wide>
    <div className="modal-heading"><div><span className="eyebrow">APPLICATION SETTINGS</span><h2>全局设置</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div>
    <div className="global-settings-list">
      <section className="theme-setting"><span className="settings-symbol"><Sun size={17} /></span><div><strong>界面主题</strong><p>主题会立即同步到项目中心和所有已打开项目。</p><div className="theme-options">{([{ value: 'system', label: '跟随系统', icon: Monitor }, { value: 'light', label: '浅色', icon: Sun }, { value: 'dark', label: '深色', icon: Moon }] as const).map((item) => { const Icon = item.icon; return <button type="button" key={item.value} className={theme === item.value ? 'active' : ''} onClick={() => setTheme(item.value)}><Icon size={14} />{item.label}</button> })}</div></div></section>
      <section><span className="settings-symbol"><FolderOpen size={17} /></span><div><strong>账本数据保存位置</strong><p>所有项目目录与 JSON 备份都会保存在这里。</p><div className="path-picker"><input readOnly value={dataRoot} /><button className="button secondary" onClick={() => void chooseRoot()}>选择目录</button></div>{rootChanged && <label className="check-row"><input type="checkbox" checked={copyExisting} onChange={(event) => setCopyExisting(event.target.checked)} /> 将现有项目复制到新位置（旧位置数据仍会保留）</label>}{rootChanged && projectWindowsOpen > 0 && <p className="setting-warning">当前仍有 {projectWindowsOpen} 个项目窗口打开，请先关闭后再切换目录。</p>}</div></section>
      <section><span className="settings-symbol"><Clock3 size={17} /></span><div><strong>关闭后驻留系统托盘</strong><p>开启后关闭项目窗口或项目中心会隐藏到托盘，双击托盘即可返回。</p></div><button role="switch" aria-checked={closeToTray} className={`switch ${closeToTray ? 'on' : ''}`} onClick={() => setCloseToTray(!closeToTray)}><i /></button></section>
      <section className="update-setting"><span className="settings-symbol"><PackageCheck size={17} /></span><div><strong>软件更新 <small>v{update?.currentVersion || '—'}</small></strong><p>{update?.message || '正在读取版本信息…'}</p>{update?.status === 'downloading' && <div className="update-progress"><i style={{ width: `${update.progress || 0}%` }} /></div>}</div><button type="button" className={`button secondary update-action ${update?.status === 'downloaded' ? 'ready' : ''}`} disabled={!update || updateBusy || update.status === 'checking' || update.status === 'downloading'} onClick={() => void handleUpdateAction()}>{updateButtonLabel}</button></section>
      <section><span className="settings-symbol"><ShieldCheck size={17} /></span><div><strong>数据保护</strong><p>每次保存前自动保留上一版备份；移除项目只会进入工作区的 .trash 目录。</p></div></section>
    </div>
    <div className="modal-actions"><button className="button secondary" onClick={() => void window.ledgerDesktop?.showDataRoot()}><FolderOpen size={14} /> 打开当前目录</button><span className="spacer" /><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={rootChanged && projectWindowsOpen > 0} onClick={() => void save()}>保存设置</button></div>
  </LauncherModal>
}

function DeleteProjectModal({ project, busy, onClose, onConfirm }: { project: ProjectSummary; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const [confirmName, setConfirmName] = useState('')
  return <LauncherModal onClose={onClose}><div className="modal-heading"><div><span className="eyebrow danger">REMOVE PROJECT</span><h2>移除“{project.businessName}”？</h2></div><button className="icon-button" disabled={busy} onClick={onClose}><X size={18} /></button></div><div className="delete-project-summary"><span className="project-avatar amber">{project.businessName.slice(0, 1)}</span><div><strong>{project.businessName}</strong><small>{project.transactionCount} 笔记录 · 当前余额 {formatMoney(project.balanceCents)}</small></div></div><div className="recover-note"><ShieldCheck size={15} /><p><strong>不会立即永久删除</strong><span>项目文件会完整移动到工作区的 <code>.trash</code> 目录，需要时可人工恢复。</span></p></div><LauncherField label={`请输入项目名称“${project.businessName}”以确认`}><input autoFocus disabled={busy} value={confirmName} onChange={(event) => setConfirmName(event.target.value)} /></LauncherField><div className="modal-actions delete-actions"><button className="button secondary" disabled={busy} onClick={onClose}>取消</button><button className="button danger-button" disabled={busy || confirmName !== project.businessName} onClick={onConfirm}><Trash2 size={14} /> {busy ? '正在安全移除…' : '移入回收目录'}</button></div></LauncherModal>
}

function LauncherEmpty({ hasQuery, onCreate, onImport }: { hasQuery: boolean; onCreate: () => void; onImport: () => void }) {
  return <div className="launcher-empty"><span><BriefcaseBusiness size={25} /></span><h2>{hasQuery ? '没有匹配的项目' : '建立你的第一个生意项目'}</h2>{hasQuery && <p>试试其他项目名称</p>}{!hasQuery && <div><button className="button primary" onClick={onCreate}><Plus size={14} /> 创建项目</button><button className="button secondary" onClick={onImport}><Download size={14} /> 导入 JSON</button></div>}</div>
}

function LauncherLoading() { return <div className="launcher-loading"><i /><span>正在整理项目列表…</span></div> }
function LauncherField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label> }
function LauncherModal({ children, onClose, wide = false }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) { useEffect(() => { const handler = (event: KeyboardEvent) => event.key === 'Escape' && onClose(); window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler) }, [onClose]); return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className={`modal-panel ${wide ? 'wide' : ''}`}>{children}</div></div> }
function formatRelativeDate(value: string) { if (!value) return '未知时间'; const date = new Date(value); const difference = Date.now() - date.getTime(); if (difference < 60_000) return '刚刚'; if (difference < 3_600_000) return `${Math.floor(difference / 60_000)} 分钟前`; if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} 小时前`; return date.toLocaleDateString('zh-CN') }
