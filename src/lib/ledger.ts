export type TransactionKind = 'income' | 'expense' | 'investment'
export type TrendRange = 'day' | 'week' | 'month'

export interface LedgerTransaction {
  id: string
  kind: TransactionKind
  amountCents: number
  occurredAt: string
  category: string
  note: string
  createdAt: string
  updatedAt: string
}

export interface LedgerData {
  version: 1
  profile: {
    businessName: string
    initialCapitalCents: number
    currency: 'CNY'
  }
  transactions: LedgerTransaction[]
  meta: {
    createdAt: string
    updatedAt: string
  }
}

export interface LedgerSummary {
  balanceCents: number
  incomeCents: number
  expenseCents: number
  investmentCents: number
  profitCents: number
  roiPercent: number | null
}

export interface TrendPoint {
  key: string
  label: string
  incomeCents: number
  expenseCents: number
  investmentCents: number
  balanceCents: number
}

export const CATEGORY_OPTIONS: Record<TransactionKind, string[]> = {
  income: ['销售收入', '服务收入', '回款', '利息', '其他收入'],
  expense: ['进货成本', '房租', '工资', '营销推广', '物流', '水电杂费', '设备', '税费', '其他支出'],
  investment: ['追加本金', '股东投入', '借款注入', '其他投入'],
}

const MAX_CENTS = 999_999_999_999_99
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

export function createLedger(businessName: string, initialCapitalCents: number): LedgerData {
  if (!isValidCents(initialCapitalCents, true)) throw new Error('初始本金金额无效')
  const now = new Date().toISOString()
  return {
    version: 1,
    profile: {
      businessName: cleanText(businessName, 60) || '我的生意',
      initialCapitalCents,
      currency: 'CNY',
    },
    transactions: [],
    meta: { createdAt: now, updatedAt: now },
  }
}

export function parseMoneyToCents(input: string): number | null {
  const normalized = input.trim().replaceAll(',', '').replaceAll('，', '')
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(normalized)) return null
  const [yuan, fraction = ''] = normalized.split('.')
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'))
  return isValidCents(cents, true) ? cents : null
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function formatMoney(cents: number, compact = false): string {
  const yuan = cents / 100
  if (compact && Math.abs(yuan) >= 10_000) {
    return `¥${(yuan / 10_000).toFixed(Math.abs(yuan) >= 100_000 ? 0 : 1)}万`
  }
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(yuan)
}

export function transactionEffect(transaction: LedgerTransaction): number {
  return transaction.kind === 'expense' ? -transaction.amountCents : transaction.amountCents
}

export function summarize(data: LedgerData, transactions = data.transactions): LedgerSummary {
  let income = 0n
  let expense = 0n
  let investment = 0n
  for (const transaction of transactions) {
    if (transaction.kind === 'income') income += BigInt(transaction.amountCents)
    if (transaction.kind === 'expense') expense += BigInt(transaction.amountCents)
    if (transaction.kind === 'investment') investment += BigInt(transaction.amountCents)
  }
  let allBalance = BigInt(data.profile.initialCapitalCents)
  for (const transaction of data.transactions) {
    allBalance += transaction.kind === 'expense' ? -BigInt(transaction.amountCents) : BigInt(transaction.amountCents)
  }
  const profit = income - expense
  const invested = BigInt(data.profile.initialCapitalCents) + investment
  const values = [allBalance, income, expense, investment, profit, invested]
  if (values.some((value) => value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER))) {
    throw new Error('账本累计金额超出安全计算范围，请拆分为多个账本')
  }
  const incomeCents = Number(income)
  const expenseCents = Number(expense)
  const investmentCents = Number(investment)
  const profitCents = Number(profit)
  return {
    balanceCents: Number(allBalance),
    incomeCents,
    expenseCents,
    investmentCents,
    profitCents,
    roiPercent: invested > 0n ? (profitCents / Number(invested)) * 100 : null,
  }
}

export function sortTransactions(transactions: LedgerTransaction[]): LedgerTransaction[] {
  return [...transactions].sort((a, b) => {
    const byTime = b.occurredAt.localeCompare(a.occurredAt)
    return byTime || b.createdAt.localeCompare(a.createdAt)
  })
}

export function buildTrend(data: LedgerData, range: TrendRange, now = new Date()): TrendPoint[] {
  const buckets = makeBuckets(range, now)
  const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]))
  let runningBalance = data.profile.initialCapitalCents

  const ordered = [...data.transactions].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  for (const transaction of ordered) {
    const key = periodKey(new Date(transaction.occurredAt), range)
    const bucket = bucketMap.get(key)
    if (bucket) {
      if (transaction.kind === 'income') bucket.incomeCents += transaction.amountCents
      if (transaction.kind === 'expense') bucket.expenseCents += transaction.amountCents
      if (transaction.kind === 'investment') bucket.investmentCents += transaction.amountCents
    } else if (transaction.occurredAt < buckets[0].startAt) {
      runningBalance += transactionEffect(transaction)
    }
  }

  return buckets.map(({ startAt: _startAt, ...bucket }) => {
    runningBalance += bucket.incomeCents + bucket.investmentCents - bucket.expenseCents
    return { ...bucket, balanceCents: runningBalance }
  })
}

export function serializeLedger(data: LedgerData): string {
  const next: LedgerData = {
    ...data,
    meta: { ...data.meta, updatedAt: new Date().toISOString() },
  }
  return JSON.stringify(next, null, 2)
}

export function parseLedgerJson(content: string): LedgerData {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    throw new Error('文件不是有效的 JSON 格式')
  }
  if (!isRecord(value)) throw new Error('账本数据必须是 JSON 对象')
  if (value.version !== 1) throw new Error('不支持的账本版本，仅支持版本 1')
  if (!isRecord(value.profile)) throw new Error('缺少账本基本信息')
  if (!Array.isArray(value.transactions)) throw new Error('交易记录格式无效')
  if (value.transactions.length > 100_000) throw new Error('交易记录超过 10 万条，无法安全导入')

  const profile = value.profile
  if (!isValidCents(profile.initialCapitalCents, true)) throw new Error('初始本金金额无效')
  if (profile.currency !== 'CNY') throw new Error('当前只支持人民币 CNY')

  const ids = new Set<string>()
  const transactions = value.transactions.map((item, index) => validateTransaction(item, index, ids))
  const meta = isRecord(value.meta) ? value.meta : {}
  const createdAt = validIsoString(meta.createdAt) ? meta.createdAt : new Date().toISOString()
  const updatedAt = validIsoString(meta.updatedAt) ? meta.updatedAt : createdAt

  const result: LedgerData = {
    version: 1,
    profile: {
      businessName: cleanText(String(profile.businessName ?? ''), 60) || '我的生意',
      initialCapitalCents: profile.initialCapitalCents,
      currency: 'CNY',
    },
    transactions,
    meta: { createdAt, updatedAt },
  }
  summarize(result)
  return result
}

export function localDateTimeValue(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function cleanText(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, maxLength)
}

function validateTransaction(value: unknown, index: number, ids: Set<string>): LedgerTransaction {
  if (!isRecord(value)) throw new Error(`第 ${index + 1} 条交易格式无效`)
  if (!['income', 'expense', 'investment'].includes(String(value.kind))) {
    throw new Error(`第 ${index + 1} 条交易类型无效`)
  }
  if (!isValidCents(value.amountCents, false)) throw new Error(`第 ${index + 1} 条交易金额无效`)
  if (typeof value.id !== 'string' || !value.id || ids.has(value.id)) {
    throw new Error(`第 ${index + 1} 条交易编号无效或重复`)
  }
  ids.add(value.id)
  if (typeof value.occurredAt !== 'string' || !validLocalDateTime(value.occurredAt)) {
    throw new Error(`第 ${index + 1} 条交易时间无效`)
  }
  const createdAt = validIsoString(value.createdAt) ? value.createdAt : new Date().toISOString()
  const updatedAt = validIsoString(value.updatedAt) ? value.updatedAt : createdAt
  return {
    id: value.id,
    kind: value.kind as TransactionKind,
    amountCents: value.amountCents,
    occurredAt: value.occurredAt,
    category: cleanText(String(value.category ?? ''), 30) || '未分类',
    note: cleanText(String(value.note ?? ''), 200),
    createdAt,
    updatedAt,
  }
}

function isValidCents(value: unknown, allowZero: boolean): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value <= MAX_CENTS
    && (allowZero ? value >= 0 : value > 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validIsoString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function validLocalDateTime(value: string): boolean {
  if (!LOCAL_DATE_TIME_PATTERN.test(value)) return false
  const [datePart, timePart] = value.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  const date = new Date(year, month - 1, day, hour, minute)
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    && date.getHours() === hour
    && date.getMinutes() === minute
}

interface InternalBucket extends TrendPoint { startAt: string }

function makeBuckets(range: TrendRange, now: Date): InternalBucket[] {
  const count = range === 'day' ? 14 : 12
  const current = startOfPeriod(now, range)
  const result: InternalBucket[] = []
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = shiftPeriod(current, range, -index)
    result.push({
      key: periodKey(date, range),
      label: periodLabel(date, range),
      startAt: localDateTimeValue(date),
      incomeCents: 0,
      expenseCents: 0,
      investmentCents: 0,
      balanceCents: 0,
    })
  }
  return result
}

function startOfPeriod(source: Date, range: TrendRange): Date {
  const date = new Date(source)
  date.setHours(0, 0, 0, 0)
  if (range === 'week') {
    const mondayOffset = (date.getDay() + 6) % 7
    date.setDate(date.getDate() - mondayOffset)
  }
  if (range === 'month') date.setDate(1)
  return date
}

function shiftPeriod(source: Date, range: TrendRange, amount: number): Date {
  const date = new Date(source)
  if (range === 'day') date.setDate(date.getDate() + amount)
  if (range === 'week') date.setDate(date.getDate() + amount * 7)
  if (range === 'month') date.setMonth(date.getMonth() + amount)
  return date
}

function periodKey(date: Date, range: TrendRange): string {
  const start = startOfPeriod(date, range)
  const year = start.getFullYear()
  const month = String(start.getMonth() + 1).padStart(2, '0')
  if (range === 'month') return `${year}-${month}`
  return `${year}-${month}-${String(start.getDate()).padStart(2, '0')}`
}

function periodLabel(date: Date, range: TrendRange): string {
  if (range === 'month') return `${date.getMonth() + 1}月`
  if (range === 'week') return `${date.getMonth() + 1}/${date.getDate()}`
  return `${date.getMonth() + 1}/${date.getDate()}`
}
