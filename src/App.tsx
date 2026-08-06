import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Download,
  FileJson,
  FolderOpen,
  LayoutDashboard,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Upload,
  WalletCards,
  X,
} from 'lucide-react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  buildTrend,
  CATEGORY_OPTIONS,
  centsToInput,
  cleanText,
  createLedger,
  formatMoney,
  LedgerData,
  LedgerTransaction,
  localDateTimeValue,
  parseLedgerJson,
  parseMoneyToCents,
  serializeLedger,
  sortTransactions,
  summarize,
  TransactionKind,
  TrendRange,
} from './lib/ledger'
import Launcher from './Launcher'
import { CreateProjectModal, GlobalSettingsModal } from './Launcher'
import {
  closeCurrentProjectBridge,
  createProjectBridge,
  getSettingsBridge,
  listProjectsBridge,
  openProjectBridge,
  readProjectBridge,
  saveProjectBridge,
} from './lib/bridge'
import { applyTheme } from './lib/theme'
import type { AppSettings, ProjectSummary } from './types/electron'
import { CustomSelect, DateTimePicker, ToastNotice, type SelectOption } from './components/UiControls'

type Page = 'overview' | 'transactions' | 'analytics' | 'settings'
type SaveState = 'saved' | 'saving' | 'error'
type TransactionModalState = { kind: TransactionKind; item?: LedgerTransaction; instanceId: string }

const KIND_META: Record<TransactionKind, { label: string; icon: typeof ArrowUpRight; className: string }> = {
  income: { label: '收入', icon: ArrowDownLeft, className: 'income' },
  expense: { label: '支出', icon: ArrowUpRight, className: 'expense' },
  investment: { label: '投入', icon: BriefcaseBusiness, className: 'investment' },
}

const KIND_FILTER_OPTIONS: readonly SelectOption<'all' | TransactionKind>[] = [
  { value: 'all', label: '全部类型' },
  { value: 'income', label: '收入' },
  { value: 'expense', label: '支出' },
  { value: 'investment', label: '投入' },
]

const PERIOD_FILTER_OPTIONS: readonly SelectOption<'all' | 'month'>[] = [
  { value: 'all', label: '全部时间' },
  { value: 'month', label: '本月' },
]

function App() {
  const params = new URLSearchParams(window.location.search)
  const projectId = params.get('projectId')
  return params.get('view') === 'project' && projectId ? <ProjectApp projectId={projectId} /> : <Launcher />
}

function ProjectApp({ projectId }: { projectId: string }) {
  const [data, setData] = useState<LedgerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [page, setPage] = useState<Page>('overview')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [toast, setToast] = useState('')
  const [transactionModal, setTransactionModal] = useState<TransactionModalState | null>(null)
  const [transactionToDelete, setTransactionToDelete] = useState<LedgerTransaction | null>(null)
  const [importCandidate, setImportCandidate] = useState<{ data: LedgerData; path: string } | null>(null)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false)
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null)
  const [projectWindowsOpen, setProjectWindowsOpen] = useState(1)
  const saveQueue = useRef(Promise.resolve())

  useEffect(() => {
    void loadLedger()
  }, [projectId])

  useEffect(() => {
    let disposed = false
    void getSettingsBridge().then((result) => {
      if (disposed || !result.ok || !result.value) return
      setAppSettings(result.value.settings)
      setProjectWindowsOpen(result.value.projectWindowsOpen)
    })
    const unsubscribe = window.ledgerDesktop?.onSettingsChanged((next) => {
      setAppSettings(next)
    })
    return () => { disposed = true; unsubscribe?.() }
  }, [])

  useEffect(() => appSettings ? applyTheme(appSettings.theme) : undefined, [appSettings?.theme])

  useEffect(() => window.ledgerDesktop?.onUpdateState((next) => {
    if (next.status === 'available') setToast(`发现新版本 ${next.latestVersion}，可在应用设置中下载`)
    if (next.status === 'downloaded') setToast(`新版本 ${next.latestVersion} 已下载，可在应用设置中重启安装`)
  }), [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2800)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (data) document.title = `${data.profile.businessName} · 生意账本`
  }, [data?.profile.businessName])

  async function loadLedger() {
    setLoading(true)
    setLoadError('')
    try {
      const result = await readProjectBridge(projectId)
      if (!result.ok || !result.value) throw new Error(result.error || '读取项目账本失败')
      setData(parseLedgerJson(result.value))
      if (result.warning) setToast(result.warning)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '读取账本失败')
    } finally {
      setLoading(false)
    }
  }

  function persist(next: LedgerData, successMessage?: string) {
    try {
      summarize(next)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '账本金额无法安全计算')
      return
    }
    const withTimestamp = { ...next, meta: { ...next.meta, updatedAt: new Date().toISOString() } }
    setData(withTimestamp)
    setSaveState('saving')
    const content = JSON.stringify(withTimestamp, null, 2)
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        const result = await saveProjectBridge(projectId, content)
        if (!result.ok) throw new Error(result.error || '保存失败')
        setSaveState('saved')
        if (successMessage) setToast(successMessage)
      } catch (error) {
        setSaveState('error')
        setToast(error instanceof Error ? error.message : '保存失败，请检查数据目录')
      }
    })
  }

  async function handleExport() {
    if (!data) return
    const content = serializeLedger(data)
    if (window.ledgerDesktop) {
      const result = await window.ledgerDesktop.exportProject(projectId, content)
      if (result.ok) setToast(`已导出至 ${result.path}`)
      else if (!result.canceled) setToast(result.error || '导出失败')
      return
    }
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
    link.download = `生意账本-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(link.href)
    setToast('账本已导出')
  }

  async function handleImport() {
    if (!window.ledgerDesktop) {
      document.getElementById('browser-import')?.click()
      return
    }
    const result = await window.ledgerDesktop.importProjectFile()
    if (!result.ok) {
      if (!result.canceled) setToast(result.error || '导入失败')
      return
    }
    try {
      setImportCandidate({ data: parseLedgerJson(result.content || ''), path: result.path || '所选文件' })
    } catch (error) {
      setToast(error instanceof Error ? error.message : '导入文件无效')
    }
  }

  async function toggleProjectMenu() {
    const nextOpen = !projectMenuOpen
    setProjectMenuOpen(nextOpen)
    if (!nextOpen) return
    setProjectsLoading(true)
    const result = await listProjectsBridge()
    if (result.ok) setProjects(result.value || [])
    else setToast(result.error || '项目列表读取失败')
    setProjectsLoading(false)
  }

  async function createAndOpenProject(content: string) {
    const result = await createProjectBridge(content)
    if (!result.ok || !result.value) return setToast(result.error || '项目创建失败')
    setCreateProjectOpen(false)
    const opened = await openProjectBridge(result.value.id)
    if (!opened.ok) setToast(opened.error || '新项目窗口打开失败')
  }

  async function openAnotherProject(id: string) {
    setProjectMenuOpen(false)
    if (id === projectId) return
    const result = await openProjectBridge(id)
    if (!result.ok) setToast(result.error || '项目窗口打开失败')
  }

  async function openGlobalSettings() {
    setProjectMenuOpen(false)
    const result = await getSettingsBridge()
    if (!result.ok || !result.value) return setToast(result.error || '应用设置读取失败')
    setAppSettings(result.value.settings)
    setProjectWindowsOpen(result.value.projectWindowsOpen)
    setGlobalSettingsOpen(true)
  }

  async function confirmImportAsNewProject() {
    if (!importCandidate) return
    const result = await createProjectBridge(serializeLedger(importCandidate.data))
    if (!result.ok || !result.value) return setToast(result.error || '新项目创建失败')
    setImportCandidate(null)
    setToast(`已将 ${importCandidate.path} 导入为新项目`)
    const opened = await openProjectBridge(result.value.id)
    if (!opened.ok) setToast(opened.error || '新项目窗口打开失败')
  }

  async function handleBrowserImport(file?: File) {
    if (!file) return
    try {
      setImportCandidate({ data: parseLedgerJson(await file.text()), path: file.name })
    } catch (error) {
      setToast(error instanceof Error ? error.message : '导入文件无效')
    }
  }

  function upsertTransaction(transaction: LedgerTransaction) {
    if (!data) return
    const exists = data.transactions.some((item) => item.id === transaction.id)
    const transactions = exists
      ? data.transactions.map((item) => item.id === transaction.id ? transaction : item)
      : [...data.transactions, transaction]
    persist({ ...data, transactions }, exists ? '记录已更新' : '记录已保存')
    setTransactionModal(null)
  }

  function openTransaction(kind: TransactionKind, item?: LedgerTransaction) {
    setTransactionModal({ kind, item, instanceId: `transaction-form-${Date.now()}-${Math.random().toString(16).slice(2)}` })
  }

  function deleteTransaction(transaction: LedgerTransaction) {
    setTransactionToDelete(transaction)
  }

  function confirmDeleteTransaction() {
    if (!data || !transactionToDelete) return
    persist({ ...data, transactions: data.transactions.filter((item) => item.id !== transactionToDelete.id) }, '记录已删除')
    setTransactionToDelete(null)
  }

  if (loading) return <LoadingScreen />
  if (loadError) return <LoadErrorScreen message={loadError} onRetry={loadLedger} />
  if (!data) return <LoadErrorScreen message="项目账本为空或不存在" onRetry={loadLedger} />

  const pageTitles: Record<Page, { title: string; subtitle: string }> = {
    overview: { title: '经营概览', subtitle: '掌握每一笔资金的去向与回报' },
    transactions: { title: '收支明细', subtitle: '查看、筛选和管理全部资金记录' },
    analytics: { title: '趋势分析', subtitle: '从日、周、月维度观察现金流变化' },
    settings: { title: '账本设置', subtitle: '管理基本信息与 JSON 数据文件' },
  }

  return (
    <div className="app-shell">
      <Sidebar page={page} onChange={setPage} businessName={data.profile.businessName} />
      <main className="main-content">
        <header className="topbar">
          <div>
            <h1>{pageTitles[page].title}</h1>
            <p>{pageTitles[page].subtitle}</p>
          </div>
          <div className="topbar-actions">
            <span className={`save-indicator ${saveState}`}>
              {saveState === 'saving' ? '正在保存…' : saveState === 'error' ? '保存失败' : <><Check size={13} /> 已自动保存</>}
            </span>
            <ProjectSwitcher
              currentProjectId={projectId}
              currentProjectName={data.profile.businessName}
              open={projectMenuOpen}
              projects={projects}
              loading={projectsLoading}
              onToggle={() => void toggleProjectMenu()}
              onClose={() => setProjectMenuOpen(false)}
              onOpenProject={(id) => void openAnotherProject(id)}
              onCreate={() => { setProjectMenuOpen(false); setCreateProjectOpen(true) }}
              onImport={() => { setProjectMenuOpen(false); void handleImport() }}
              onSettings={() => void openGlobalSettings()}
              onCloseCurrent={() => { setProjectMenuOpen(false); void closeCurrentProjectBridge() }}
            />
            <button className="button secondary" onClick={() => void handleExport()}><Download size={14} /> 导出</button>
            <button className="button primary" onClick={() => openTransaction('income')}><Plus size={15} /> 记一笔</button>
          </div>
        </header>

        <section className="page-content">
          {page === 'overview' && (
            <OverviewPage data={data} onAdd={(kind) => openTransaction(kind)} onViewAll={() => setPage('transactions')} />
          )}
          {page === 'transactions' && (
            <TransactionsPage
              data={data}
              onAdd={(kind) => openTransaction(kind)}
              onEdit={(item) => openTransaction(item.kind, item)}
              onDelete={deleteTransaction}
            />
          )}
          {page === 'analytics' && <AnalyticsPage data={data} />}
          {page === 'settings' && (
            <SettingsPage
              data={data}
              onSave={(next) => persist(next, '账本信息已更新')}
              onImport={() => void handleImport()}
              onExport={() => void handleExport()}
              onCreate={() => setCreateProjectOpen(true)}
              onApplicationSettings={() => void openGlobalSettings()}
              onCloseCurrent={() => void closeCurrentProjectBridge()}
            />
          )}
        </section>
      </main>

      {transactionModal && (
        <TransactionModal
          key={transactionModal.instanceId}
          initialKind={transactionModal.kind}
          item={transactionModal.item}
          onClose={() => setTransactionModal(null)}
          onSave={upsertTransaction}
        />
      )}
      {transactionToDelete && <DeleteTransactionModal transaction={transactionToDelete} onClose={() => setTransactionToDelete(null)} onConfirm={confirmDeleteTransaction} />}
      {importCandidate && (
        <ImportConfirmModal
          candidate={importCandidate}
          onClose={() => setImportCandidate(null)}
          onConfirm={() => void confirmImportAsNewProject()}
        />
      )}
      {createProjectOpen && <CreateProjectModal onClose={() => setCreateProjectOpen(false)} onCreate={(content) => void createAndOpenProject(content)} />}
      {globalSettingsOpen && appSettings && (
        <GlobalSettingsModal
          settings={appSettings}
          projectWindowsOpen={projectWindowsOpen}
          onClose={() => setGlobalSettingsOpen(false)}
          onSaved={(next) => { setAppSettings(next); setGlobalSettingsOpen(false); setToast('应用设置已保存') }}
          onError={setToast}
        />
      )}
      {toast && <ToastNotice message={toast} onClose={() => setToast('')} />}
      <input id="browser-import" hidden type="file" accept="application/json,.json" onChange={(event) => void handleBrowserImport(event.target.files?.[0])} />
    </div>
  )
}

function Sidebar({ page, onChange, businessName }: { page: Page; onChange: (page: Page) => void; businessName: string }) {
  const items: Array<{ id: Page; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'overview', label: '经营概览', icon: LayoutDashboard },
    { id: 'transactions', label: '收支明细', icon: BookOpen },
    { id: 'analytics', label: '趋势分析', icon: BarChart3 },
    { id: 'settings', label: '账本设置', icon: Settings },
  ]
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark"><WalletCards size={19} /></span>
        <div><strong>生意账本</strong></div>
      </div>
      <nav>
        <span className="nav-label">账本管理</span>
        {items.map((item) => {
          const Icon = item.icon
          return <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => onChange(item.id)}><Icon size={16} />{item.label}</button>
        })}
      </nav>
      <div className="sidebar-foot">
        <div className="business-avatar">{businessName.slice(0, 1)}</div>
        <div><strong title={businessName}>{businessName}</strong><span>本地离线账本</span></div>
        <ShieldCheck size={15} />
      </div>
    </aside>
  )
}

function ProjectSwitcher({ currentProjectId, currentProjectName, open, projects, loading, onToggle, onClose, onOpenProject, onCreate, onImport, onSettings, onCloseCurrent }: {
  currentProjectId: string
  currentProjectName: string
  open: boolean
  projects: ProjectSummary[]
  loading: boolean
  onToggle: () => void
  onClose: () => void
  onOpenProject: (id: string) => void
  onCreate: () => void
  onImport: () => void
  onSettings: () => void
  onCloseCurrent: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const handlePointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose()
    }
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', handlePointer)
    window.addEventListener('keydown', handleKey)
    return () => { window.removeEventListener('pointerdown', handlePointer); window.removeEventListener('keydown', handleKey) }
  }, [open, onClose])
  return <div className="project-switcher" ref={root}>
    <button className={`button secondary project-switcher-trigger ${open ? 'active' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={onToggle}>
      <span className="project-switcher-avatar">{currentProjectName.slice(0, 1)}</span>
      <span>{currentProjectName}</span>
      <ChevronDown size={13} />
    </button>
    {open && <div className="project-switcher-menu" role="menu">
      <div className="project-menu-heading"><div><strong>切换生意项目</strong><small>项目会在独立窗口中打开</small></div><span>{projects.length}</span></div>
      <div className="project-menu-list">
        {loading ? <div className="project-menu-loading"><i /> 正在读取项目…</div> : projects.map((project) => {
          const current = project.id === currentProjectId
          return <button key={project.id} disabled={Boolean(project.error)} className={current ? 'current' : ''} onClick={() => onOpenProject(project.id)}>
            <span className="project-menu-avatar">{project.error ? '!' : project.businessName.slice(0, 1)}</span>
            <span><strong>{project.businessName}</strong><small>{project.error || `${project.transactionCount} 笔记录 · ${formatMoney(project.balanceCents)}`}</small></span>
            {current ? <span className="current-label"><Check size={11} /> 当前</span> : <ChevronRight size={13} />}
          </button>
        })}
      </div>
      <div className="project-menu-actions">
        <button onClick={onCreate}><Plus size={14} /><span><strong>新建项目</strong><small>创建独立 JSON 账本</small></span></button>
        <button onClick={onImport}><Upload size={14} /><span><strong>导入项目</strong><small>从 JSON 新建项目</small></span></button>
        <button onClick={onSettings}><Settings size={14} /><span><strong>应用设置</strong><small>主题、存储与系统托盘</small></span></button>
      </div>
      <button className="close-project-action" onClick={onCloseCurrent}><X size={14} /><span><strong>关闭当前项目</strong><small>关闭这个账本窗口</small></span></button>
    </div>}
  </div>
}

function OverviewPage({ data, onAdd, onViewAll }: { data: LedgerData; onAdd: (kind: TransactionKind) => void; onViewAll: () => void }) {
  const summary = summarize(data)
  const monthTransactions = data.transactions.filter((item) => item.occurredAt.slice(0, 7) === localDateTimeValue().slice(0, 7))
  const monthSummary = summarize(data, monthTransactions)
  const recent = sortTransactions(data.transactions).slice(0, 6)
  const trend = buildTrend(data, 'day').map(toChartPoint)
  const cards = [
    { label: '当前可用余额', value: formatMoney(summary.balanceCents), detail: `初始本金 ${formatMoney(data.profile.initialCapitalCents)}`, tone: 'balance', icon: WalletCards },
    { label: '本月净收益', value: formatMoney(monthSummary.profitCents), detail: monthSummary.profitCents >= 0 ? '收入减去支出' : '本月支出高于收入', tone: monthSummary.profitCents >= 0 ? 'income' : 'expense', icon: TrendingUp },
    { label: '本月收入', value: formatMoney(monthSummary.incomeCents), detail: `${monthTransactions.filter((item) => item.kind === 'income').length} 笔收入`, tone: 'income', icon: ArrowDownLeft },
    { label: '本月支出', value: formatMoney(monthSummary.expenseCents), detail: `${monthTransactions.filter((item) => item.kind === 'expense').length} 笔支出`, tone: 'expense', icon: ArrowUpRight },
  ]
  return (
    <div className="stack-lg">
      <div className="metric-grid">
        {cards.map((card) => <MetricCard key={card.label} {...card} />)}
      </div>
      <div className="overview-grid">
        <section className="card chart-card">
          <div className="card-heading">
            <div><h2>资金走势</h2><p>近 14 天余额及每日收支</p></div>
            <span className="range-badge">按日</span>
          </div>
          <TrendChart data={trend} />
        </section>
        <section className="card quick-card">
          <div className="card-heading"><div><h2>快速记账</h2><p>选择本次资金类型</p></div></div>
          <div className="quick-actions">
            <button onClick={() => onAdd('income')}><span className="quick-icon income"><ArrowDownLeft size={18} /></span><span><strong>记录收入</strong><small>销售、服务、回款</small></span><ChevronRight size={15} /></button>
            <button onClick={() => onAdd('expense')}><span className="quick-icon expense"><ArrowUpRight size={18} /></span><span><strong>记录支出</strong><small>采购、房租、工资</small></span><ChevronRight size={15} /></button>
            <button onClick={() => onAdd('investment')}><span className="quick-icon investment"><BriefcaseBusiness size={18} /></span><span><strong>追加投入</strong><small>补充本金、股东投入</small></span><ChevronRight size={15} /></button>
          </div>
          <div className="roi-strip"><span>累计投入回报率</span><strong>{summary.roiPercent === null ? '—' : `${summary.roiPercent.toFixed(1)}%`}</strong></div>
        </section>
      </div>
      <section className="card">
        <div className="card-heading with-action">
          <div><h2>最近记录</h2><p>最新的资金变动</p></div>
          <button className="text-button" onClick={onViewAll}>查看全部 <ChevronRight size={14} /></button>
        </div>
        <TransactionTable transactions={recent} emptyText="还没有资金记录，点击右上角开始记账" compact />
      </section>
    </div>
  )
}

function MetricCard({ label, value, detail, tone, icon: Icon }: { label: string; value: string; detail: string; tone: string; icon: typeof WalletCards }) {
  return <section className={`metric-card ${tone}`}><div className="metric-top"><span>{label}</span><i><Icon size={16} /></i></div><strong>{value}</strong><p>{detail}</p></section>
}

function TransactionsPage({ data, onAdd, onEdit, onDelete }: { data: LedgerData; onAdd: (kind: TransactionKind) => void; onEdit: (item: LedgerTransaction) => void; onDelete: (item: LedgerTransaction) => void }) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | TransactionKind>('all')
  const [period, setPeriod] = useState<'all' | 'month'>('all')
  const transactions = useMemo(() => sortTransactions(data.transactions).filter((item) => {
    const matchesQuery = !query || `${item.note} ${item.category}`.toLowerCase().includes(query.toLowerCase())
    const matchesKind = kind === 'all' || item.kind === kind
    const matchesPeriod = period === 'all' || item.occurredAt.slice(0, 7) === localDateTimeValue().slice(0, 7)
    return matchesQuery && matchesKind && matchesPeriod
  }), [data.transactions, query, kind, period])
  const filteredSummary = summarize(data, transactions)
  return <div className="stack-lg">
    <div className="mini-stats">
      <span>筛选结果 <strong>{transactions.length} 笔</strong></span>
      <span>收入 <strong className="positive">{formatMoney(filteredSummary.incomeCents)}</strong></span>
      <span>支出 <strong className="negative">{formatMoney(filteredSummary.expenseCents)}</strong></span>
      <span>收支净额 <strong>{formatMoney(filteredSummary.profitCents)}</strong></span>
    </div>
    <section className="card">
      <div className="filterbar">
        <label className="search-box"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索说明或分类" /></label>
        <CustomSelect ariaLabel="筛选交易类型" value={kind} options={KIND_FILTER_OPTIONS} onChange={setKind} />
        <CustomSelect ariaLabel="筛选交易时间" value={period} options={PERIOD_FILTER_OPTIONS} onChange={setPeriod} />
        <button className="button primary" onClick={() => onAdd('income')}><Plus size={14} /> 新增记录</button>
      </div>
      <TransactionTable transactions={transactions} emptyText="没有找到符合条件的记录" onEdit={onEdit} onDelete={onDelete} />
    </section>
  </div>
}

function TransactionTable({ transactions, emptyText, compact = false, onEdit, onDelete }: { transactions: LedgerTransaction[]; emptyText: string; compact?: boolean; onEdit?: (item: LedgerTransaction) => void; onDelete?: (item: LedgerTransaction) => void }) {
  if (!transactions.length) return <div className="empty-state"><span><FileJson size={23} /></span><strong>{emptyText}</strong><p>所有数据都会安全保存在本地 JSON 文件中</p></div>
  return <div className="table-wrap"><table><thead><tr><th>交易说明</th><th>分类</th><th>时间</th><th>类型</th><th className="align-right">金额</th>{!compact && <th />}</tr></thead><tbody>{transactions.map((item) => {
    const meta = KIND_META[item.kind]
    const Icon = meta.icon
    return <tr key={item.id}><td><div className="transaction-name"><span className={`transaction-icon ${meta.className}`}><Icon size={15} /></span><div><strong>{item.note || item.category}</strong><small>编号 {item.id.slice(0, 8)}</small></div></div></td><td><span className="category-chip">{item.category}</span></td><td>{formatDateTime(item.occurredAt)}</td><td><span className={`kind-text ${meta.className}`}>{meta.label}</span></td><td className={`align-right amount ${meta.className}`}>{item.kind === 'expense' ? '−' : '+'}{formatMoney(item.amountCents)}</td>{!compact && <td className="row-actions"><button type="button" title="编辑" onClick={() => onEdit?.(item)}><Pencil size={14} /></button><button type="button" title="删除" onClick={() => onDelete?.(item)}><Trash2 size={14} /></button></td>}</tr>
  })}</tbody></table></div>
}

function AnalyticsPage({ data }: { data: LedgerData }) {
  const [range, setRange] = useState<TrendRange>('day')
  const trend = buildTrend(data, range)
  const chart = trend.map(toChartPoint)
  const rangeTransactions = data.transactions.filter((item) => item.occurredAt >= `${trend[0].key}${range === 'month' ? '-01' : ''}`)
  const summary = summarize(data, rangeTransactions)
  const expenseByCategory = Object.entries(rangeTransactions.filter((item) => item.kind === 'expense').reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + item.amountCents
    return acc
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5)
  return <div className="stack-lg">
    <section className="card analytics-chart">
      <div className="card-heading with-action">
        <div><h2>现金流趋势</h2><p>余额曲线包含本金、追加投入和每笔收支</p></div>
        <div className="segmented">{(['day', 'week', 'month'] as TrendRange[]).map((value) => <button className={range === value ? 'active' : ''} key={value} onClick={() => setRange(value)}>{value === 'day' ? '日' : value === 'week' ? '周' : '月'}</button>)}</div>
      </div>
      <TrendChart data={chart} tall />
    </section>
    <div className="analytics-grid">
      <section className="card insight-card"><div className="card-heading"><div><h2>区间经营表现</h2><p>当前图表覆盖范围</p></div></div><div className="insight-list"><div><span>总收入</span><strong className="positive">{formatMoney(summary.incomeCents)}</strong></div><div><span>总支出</span><strong className="negative">{formatMoney(summary.expenseCents)}</strong></div><div><span>净收益</span><strong>{formatMoney(summary.profitCents)}</strong></div><div><span>追加投入</span><strong>{formatMoney(summary.investmentCents)}</strong></div></div></section>
      <section className="card insight-card"><div className="card-heading"><div><h2>主要支出分类</h2><p>帮助发现成本重点</p></div></div>{expenseByCategory.length ? <div className="category-bars">{expenseByCategory.map(([category, cents]) => <div key={category}><div><span>{category}</span><strong>{formatMoney(cents)}</strong></div><i><b style={{ width: `${summary.expenseCents ? cents / summary.expenseCents * 100 : 0}%` }} /></i></div>)}</div> : <div className="small-empty">当前区间还没有支出</div>}</section>
    </div>
  </div>
}

function TrendChart({ data, tall = false }: { data: ReturnType<typeof toChartPoint>[]; tall?: boolean }) {
  return <div className={tall ? 'chart tall' : 'chart'}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}><defs><linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4d9b76" stopOpacity={0.24} /><stop offset="100%" stopColor="#4d9b76" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid stroke="var(--chart-grid)" vertical={false} /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--chart-axis)' }} dy={8} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--chart-axis)' }} tickFormatter={(value) => compactYuan(value)} width={54} /><Tooltip content={<ChartTooltip />} /><Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, paddingTop: 12 }} /><Bar name="收入" dataKey="income" fill="#78b997" radius={[3, 3, 0, 0]} maxBarSize={18} /><Bar name="支出" dataKey="expense" fill="#dc927d" radius={[3, 3, 0, 0]} maxBarSize={18} /><Area name="余额" type="monotone" dataKey="balance" stroke="#4d9b76" strokeWidth={2.4} fill="url(#balanceFill)" dot={false} activeDot={{ r: 4, fill: '#4d9b76', stroke: 'var(--panel)', strokeWidth: 2 }} /></ComposedChart></ResponsiveContainer></div>
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return <div className="chart-tooltip"><strong>{label}</strong>{payload.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}<b>{formatMoney(Math.round(item.value * 100))}</b></span>)}</div>
}

function SettingsPage({ data, onSave, onImport, onExport, onCreate, onApplicationSettings, onCloseCurrent }: { data: LedgerData; onSave: (data: LedgerData) => void; onImport: () => void; onExport: () => void; onCreate: () => void; onApplicationSettings: () => void; onCloseCurrent: () => void }) {
  const [name, setName] = useState(data.profile.businessName)
  const [capital, setCapital] = useState(centsToInput(data.profile.initialCapitalCents))
  const [error, setError] = useState('')
  function submit(event: React.FormEvent) {
    event.preventDefault()
    const cents = parseMoneyToCents(capital)
    if (cents === null) return setError('请输入正确的本金金额，最多保留两位小数')
    onSave({ ...data, profile: { ...data.profile, businessName: cleanText(name, 60) || '我的生意', initialCapitalCents: cents } })
    setError('')
  }
  return <div className="settings-grid">
    <section className="card settings-card"><div className="card-heading"><div><h2>账本基本信息</h2><p>修改名称或初始本金后，所有统计会自动重算</p></div></div><form onSubmit={submit} className="settings-form"><Field label="生意 / 项目名称"><input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} /></Field><Field label="初始本金（元）" hint="只修改起始本金，不会产生交易记录"><div className="money-input"><span>¥</span><input inputMode="decimal" value={capital} onChange={(event) => setCapital(event.target.value)} /></div></Field>{error && <p className="form-error">{error}</p>}<button className="button primary" type="submit">保存基本信息</button></form></section>
    <section className="card settings-card"><div className="card-heading"><div><h2>项目与 JSON 数据</h2><p>备份当前项目，或同时处理其他生意</p></div></div><div className="data-actions"><button onClick={onExport}><span><Download size={17} /></span><div><strong>导出当前项目</strong><small>保存当前项目的本金、交易与设置</small></div><ChevronRight size={15} /></button><button onClick={onCreate}><span><Plus size={17} /></span><div><strong>创建新项目</strong><small>在新的独立窗口中开始记账</small></div><ChevronRight size={15} /></button><button onClick={onImport}><span><Upload size={17} /></span><div><strong>导入为新项目</strong><small>校验 JSON 后在新的独立窗口打开</small></div><ChevronRight size={15} /></button><button onClick={onApplicationSettings}><span><Settings size={17} /></span><div><strong>应用设置</strong><small>主题、数据保存位置和系统托盘</small></div><ChevronRight size={15} /></button><button className="close-current-data-action" onClick={onCloseCurrent}><span><X size={17} /></span><div><strong>关闭当前项目</strong><small>关闭这个账本窗口</small></div><ChevronRight size={15} /></button></div><div className="safety-note"><ShieldCheck size={16} /><p><strong>项目互相隔离</strong><span>当前窗口只会写入这个项目；其他项目拥有各自独立的 JSON 和备份。</span></p></div></section>
    <section className="card settings-card full"><div className="card-heading"><div><h2>账本信息</h2><p>用于核对导出文件和记录规模</p></div></div><div className="info-grid"><div><span>数据版本</span><strong>Version {data.version}</strong></div><div><span>交易记录</span><strong>{data.transactions.length} 笔</strong></div><div><span>创建时间</span><strong>{new Date(data.meta.createdAt).toLocaleDateString('zh-CN')}</strong></div><div><span>币种</span><strong>人民币 CNY</strong></div></div></section>
  </div>
}

function SetupScreen({ onComplete }: { onComplete: (data: LedgerData) => void }) {
  const [name, setName] = useState('')
  const [capital, setCapital] = useState('')
  const [error, setError] = useState('')
  function submit(event: React.FormEvent) {
    event.preventDefault()
    const cents = parseMoneyToCents(capital)
    if (cents === null) return setError('请输入正确的本金金额，最多保留两位小数')
    onComplete(createLedger(name, cents))
  }
  return <div className="setup-screen"><div className="setup-decoration"><span /><span /><span /></div><div className="setup-card"><div className="setup-brand"><span className="brand-mark"><WalletCards size={21} /></span><strong>生意账本</strong></div><span className="eyebrow">欢迎使用</span><h1>从第一笔本金开始，<br />把生意经营得更清楚。</h1><p className="setup-intro">所有数据仅保存在你的电脑中。金额以“分”精确计算，并可随时导入、导出 JSON 备份。</p><form onSubmit={submit}><Field label="生意 / 项目名称"><input autoFocus value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="例如：城南咖啡店" /></Field><Field label="初始本金（元）" hint="这是开始经营前可使用的资金"><div className="money-input large"><span>¥</span><input inputMode="decimal" value={capital} onChange={(event) => setCapital(event.target.value)} placeholder="0.00" /></div></Field>{error && <p className="form-error">{error}</p>}<button className="button primary setup-submit" type="submit">创建我的账本 <ChevronRight size={16} /></button></form><div className="setup-features"><span><ShieldCheck size={14} /> 本地离线</span><span><CircleDollarSign size={14} /> 精确到分</span><span><FileJson size={14} /> JSON 备份</span></div></div></div>
}

function TransactionModal({ initialKind, item, onClose, onSave }: { initialKind: TransactionKind; item?: LedgerTransaction; onClose: () => void; onSave: (item: LedgerTransaction) => void }) {
  const [kind, setKind] = useState(item?.kind || initialKind)
  const [amount, setAmount] = useState(item ? centsToInput(item.amountCents) : '')
  const [occurredAt, setOccurredAt] = useState(item?.occurredAt || localDateTimeValue())
  const [category, setCategory] = useState(item?.category || CATEGORY_OPTIONS[initialKind][0])
  const [note, setNote] = useState(item?.note || '')
  const [error, setError] = useState('')
  const amountInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => amountInput.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [])
  function changeKind(next: TransactionKind) { setKind(next); setCategory(CATEGORY_OPTIONS[next][0]) }
  function submit(event: React.FormEvent) {
    event.preventDefault()
    const cents = parseMoneyToCents(amount)
    if (cents === null || cents <= 0) return setError('请输入大于 0 的正确金额，最多保留两位小数')
    if (!occurredAt || Number.isNaN(new Date(occurredAt).getTime())) return setError('请选择正确的交易时间')
    const now = new Date().toISOString()
    onSave({ id: item?.id || createId(), kind, amountCents: cents, occurredAt, category: cleanText(category, 30), note: cleanText(note, 200), createdAt: item?.createdAt || now, updatedAt: now })
  }
  const categoryOptions: readonly SelectOption<string>[] = CATEGORY_OPTIONS[kind].map((value) => ({ value, label: value }))
  return <Modal onClose={onClose} className="transaction-modal-panel"><div className="modal-heading"><div><span className="eyebrow">{item ? '修改记录' : '新增记录'}</span><h2>{item ? '编辑这笔资金记录' : '记一笔资金变动'}</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div><form onSubmit={submit} className="transaction-form"><div className="kind-selector">{(['income', 'expense', 'investment'] as TransactionKind[]).map((value) => { const meta = KIND_META[value]; const Icon = meta.icon; return <button type="button" key={value} className={`${meta.className} ${kind === value ? 'active' : ''}`} onClick={() => changeKind(value)}><Icon size={16} />{meta.label}</button> })}</div><Field label="金额（元）"><div className="money-input large"><span>¥</span><input ref={amountInput} autoFocus type="text" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); if (error) setError('') }} placeholder="0.00" /></div></Field><div className="form-row"><Field label="发生时间"><DateTimePicker value={occurredAt} onChange={setOccurredAt} /></Field><Field label="分类"><CustomSelect ariaLabel="选择交易分类" value={category} options={categoryOptions} onChange={setCategory} /></Field></div><Field label="说明" hint="可选，建议写清楚用途或来源"><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder="例如：8 月 6 日门店销售收入" /></Field>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="submit" className="button primary">{item ? '保存修改' : '保存记录'}</button></div></form></Modal>
}

function DeleteTransactionModal({ transaction, onClose, onConfirm }: { transaction: LedgerTransaction; onClose: () => void; onConfirm: () => void }) {
  const meta = KIND_META[transaction.kind]
  return <Modal onClose={onClose} className="confirm-panel">
    <div className="confirm-icon danger"><Trash2 size={20} /></div>
    <div className="confirm-copy"><span className="eyebrow danger">DELETE RECORD</span><h2>删除这条资金记录？</h2><p>删除后会立即重新计算余额，这个操作无法在应用内撤销。</p></div>
    <div className="delete-record-preview">
      <span className={`transaction-icon ${meta.className}`}><meta.icon size={15} /></span>
      <div><strong>{transaction.note || transaction.category}</strong><small>{meta.label} · {transaction.category} · {formatDateTime(transaction.occurredAt)}</small></div>
      <strong className={`amount ${meta.className}`}>{transaction.kind === 'expense' ? '−' : '+'}{formatMoney(transaction.amountCents)}</strong>
    </div>
    <div className="modal-actions confirm-actions"><button type="button" className="button secondary" onClick={onClose}>保留记录</button><button type="button" className="button danger-button" onClick={onConfirm}><Trash2 size={14} /> 确认删除</button></div>
  </Modal>
}

function ImportConfirmModal({ candidate, onClose, onConfirm }: { candidate: { data: LedgerData; path: string }; onClose: () => void; onConfirm: () => void }) {
  const summary = summarize(candidate.data)
  return <Modal onClose={onClose}><div className="modal-heading"><div><span className="eyebrow">数据校验通过</span><h2>作为新项目导入？</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="import-preview"><div><span>项目名称</span><strong>{candidate.data.profile.businessName}</strong></div><div><span>初始本金</span><strong>{formatMoney(candidate.data.profile.initialCapitalCents)}</strong></div><div><span>当前余额</span><strong>{formatMoney(summary.balanceCents)}</strong></div><div><span>交易记录</span><strong>{candidate.data.transactions.length} 笔</strong></div></div><p className="success-box"><ShieldCheck size={14} /> 导入会创建全新的独立项目，不会覆盖当前或其他账本。</p><div className="modal-actions"><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" onClick={onConfirm}>导入并打开新项目</button></div></Modal>
}

function Modal({ children, onClose, className = '' }: { children: React.ReactNode; onClose: () => void; className?: string }) {
  useEffect(() => { const handler = (event: KeyboardEvent) => event.key === 'Escape' && onClose(); window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler) }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className={`modal-panel ${className}`} role="dialog" aria-modal="true">{children}</div></div>
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</div>
}

function LoadingScreen() { return <div className="center-screen"><div className="loader"><WalletCards size={22} /></div><strong>正在打开账本…</strong></div> }
function LoadErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="center-screen error-screen"><span><FileJson size={25} /></span><h1>账本数据无法读取</h1><p>{message}</p><small>为保护原始数据，应用没有自动覆盖文件。你可以打开工作区检查项目备份。</small><div><button className="button secondary" onClick={() => void window.ledgerDesktop?.showDataRoot()}><FolderOpen size={14} /> 打开工作区</button><button className="button secondary" onClick={() => void closeCurrentProjectBridge()}><X size={14} /> 关闭当前项目</button><button className="button primary" onClick={onRetry}>重新读取</button></div></div> }

function toChartPoint(point: ReturnType<typeof buildTrend>[number]) { return { label: point.label, balance: point.balanceCents / 100, income: point.incomeCents / 100, expense: point.expenseCents / 100 } }
function compactYuan(value: number) { return Math.abs(value) >= 10_000 ? `${(value / 10_000).toFixed(1)}万` : `${Math.round(value)}` }
function formatDateTime(value: string) { const date = new Date(value); return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
function createId() { return globalThis.crypto?.randomUUID?.() || `tx-${Date.now()}-${Math.random().toString(16).slice(2)}` }

export default App
