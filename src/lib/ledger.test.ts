import { describe, expect, it, vi } from 'vitest'
import {
  buildTrend,
  createLedger,
  formatMoney,
  LedgerData,
  LedgerTransaction,
  parseLedgerJson,
  parseMoneyToCents,
  serializeLedger,
  summarize,
  transactionEffect,
} from './ledger'

function transaction(overrides: Partial<LedgerTransaction> = {}): LedgerTransaction {
  return {
    id: crypto.randomUUID(),
    kind: 'income',
    amountCents: 100,
    occurredAt: '2026-08-06T12:30',
    category: '销售收入',
    note: '测试记录',
    createdAt: '2026-08-06T04:30:00.000Z',
    updatedAt: '2026-08-06T04:30:00.000Z',
    ...overrides,
  }
}

function ledger(transactions: LedgerTransaction[] = []): LedgerData {
  return {
    ...createLedger('测试商店', 10_000_00),
    transactions,
  }
}

describe('金额输入与显示', () => {
  it.each([
    ['0', 0],
    ['0.01', 1],
    ['12.3', 1230],
    ['1,234.56', 123456],
    ['999999999999.99', 99_999_999_999_999],
  ])('将 %s 精确转换为整数分', (input, expected) => {
    expect(parseMoneyToCents(input)).toBe(expected)
  })

  it.each(['', '-1', '1.001', '1e3', 'NaN', '100元', '9999999999999'])('拒绝不安全的金额 %s', (input) => {
    expect(parseMoneyToCents(input)).toBeNull()
  })

  it('人民币显示保留两位小数', () => {
    expect(formatMoney(123456)).toContain('1,234.56')
  })
})

describe('资金核算', () => {
  it('按本金 + 投入 + 收入 - 支出计算余额，并独立计算利润', () => {
    const data = ledger([
      transaction({ kind: 'investment', amountCents: 2_000_00 }),
      transaction({ kind: 'income', amountCents: 888_88 }),
      transaction({ kind: 'expense', amountCents: 123_45 }),
    ])
    expect(summarize(data)).toMatchObject({
      balanceCents: 12_765_43,
      incomeCents: 888_88,
      expenseCents: 123_45,
      investmentCents: 2_000_00,
      profitCents: 765_43,
    })
    expect(summarize(data).roiPercent).toBeCloseTo(6.37858, 4)
  })

  it('支出产生负向余额影响，其余类型产生正向影响', () => {
    expect(transactionEffect(transaction({ kind: 'expense', amountCents: 50 }))).toBe(-50)
    expect(transactionEffect(transaction({ kind: 'income', amountCents: 50 }))).toBe(50)
    expect(transactionEffect(transaction({ kind: 'investment', amountCents: 50 }))).toBe(50)
  })
})

describe('JSON 导入校验', () => {
  it('导出后可无损导入金额和交易', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T09:00:00.000Z'))
    const original = ledger([transaction({ amountCents: 10_01, note: '精确到分' })])
    const restored = parseLedgerJson(serializeLedger(original))
    expect(restored.profile.initialCapitalCents).toBe(original.profile.initialCapitalCents)
    expect(restored.transactions).toEqual(original.transactions)
    vi.useRealTimers()
  })

  it('拒绝损坏的 JSON', () => {
    expect(() => parseLedgerJson('{broken')).toThrow('有效的 JSON')
  })

  it('拒绝非整数分金额', () => {
    const value = ledger([transaction()])
    value.transactions[0].amountCents = 1.5
    expect(() => parseLedgerJson(JSON.stringify(value))).toThrow('交易金额无效')
  })

  it('拒绝重复交易编号，防止重复记账', () => {
    const first = transaction({ id: 'same-id' })
    const value = ledger([first, transaction({ id: 'same-id' })])
    expect(() => parseLedgerJson(JSON.stringify(value))).toThrow('无效或重复')
  })

  it('拒绝无效日期和未知交易类型', () => {
    const badDate = ledger([transaction({ occurredAt: '2026-99-99T99:99' })])
    expect(() => parseLedgerJson(JSON.stringify(badDate))).toThrow('交易时间无效')
    const impossibleDate = ledger([transaction({ occurredAt: '2026-02-30T12:00' })])
    expect(() => parseLedgerJson(JSON.stringify(impossibleDate))).toThrow('交易时间无效')
    const badKind = ledger([transaction()]) as unknown as { transactions: Array<Record<string, unknown>> }
    badKind.transactions[0].kind = 'refund'
    expect(() => parseLedgerJson(JSON.stringify(badKind))).toThrow('交易类型无效')
  })

  it('拒绝累计后超出 JavaScript 安全整数范围的账本', () => {
    const huge = Array.from({ length: 100 }, (_, index) => transaction({ id: `huge-${index}`, amountCents: 99_999_999_999_999 }))
    expect(() => parseLedgerJson(JSON.stringify(ledger(huge)))).toThrow('安全计算范围')
  })
})

describe('趋势统计', () => {
  it('日趋势包含区间前余额，并按日累计收入支出', () => {
    const data = ledger([
      transaction({ occurredAt: '2026-07-01T09:00', amountCents: 500_00 }),
      transaction({ occurredAt: '2026-08-05T10:00', kind: 'expense', amountCents: 120_00 }),
      transaction({ occurredAt: '2026-08-06T10:00', kind: 'income', amountCents: 300_00 }),
    ])
    const points = buildTrend(data, 'day', new Date('2026-08-06T20:00:00'))
    expect(points).toHaveLength(14)
    expect(points.at(-2)).toMatchObject({ key: '2026-08-05', expenseCents: 120_00, balanceCents: 10_380_00 })
    expect(points.at(-1)).toMatchObject({ key: '2026-08-06', incomeCents: 300_00, balanceCents: 10_680_00 })
  })

  it('周趋势以周一为开始，月趋势固定生成 12 个月', () => {
    const data = ledger()
    const weeks = buildTrend(data, 'week', new Date('2026-08-06T20:00:00'))
    const months = buildTrend(data, 'month', new Date('2026-08-06T20:00:00'))
    expect(weeks).toHaveLength(12)
    expect(weeks.at(-1)?.key).toBe('2026-08-03')
    expect(months).toHaveLength(12)
    expect(months[0].key).toBe('2025-09')
    expect(months.at(-1)?.key).toBe('2026-08')
  })
})
