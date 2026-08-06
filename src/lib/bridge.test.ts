import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProjectBridge,
  checkForUpdatesBridge,
  deleteProjectBridge,
  getSettingsBridge,
  getUpdateStateBridge,
  listProjectsBridge,
  readProjectBridge,
  saveProjectBridge,
  updateSettingsBridge,
} from './bridge'
import { createLedger, LedgerTransaction, parseLedgerJson, serializeLedger } from './ledger'

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  } satisfies Storage)
  delete window.ledgerDesktop
})

describe('多项目浏览器适配层', () => {
  it('创建多个项目并保持数据完全隔离', async () => {
    const first = await createProjectBridge(serializeLedger(createLedger('咖啡店', 10_000_00)))
    const second = await createProjectBridge(serializeLedger(createLedger('网上商店', 20_000_00)))
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(first.value?.id).not.toBe(second.value?.id)

    const projects = await listProjectsBridge()
    expect(projects.value).toHaveLength(2)
    expect(projects.value?.map((item) => item.businessName).sort()).toEqual(['咖啡店', '网上商店'])

    const firstContent = await readProjectBridge(first.value!.id)
    const firstData = parseLedgerJson(firstContent.value!)
    const income: LedgerTransaction = {
      id: crypto.randomUUID(),
      kind: 'income',
      amountCents: 888_88,
      occurredAt: '2026-08-06T10:30',
      category: '销售收入',
      note: '咖啡销售',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    firstData.transactions.push(income)
    await saveProjectBridge(first.value!.id, serializeLedger(firstData))

    const after = await listProjectsBridge()
    expect(after.value?.find((item) => item.id === first.value!.id)?.balanceCents).toBe(10_888_88)
    expect(after.value?.find((item) => item.id === second.value!.id)?.balanceCents).toBe(20_000_00)
  })

  it('删除一个项目不会影响其他项目', async () => {
    const first = await createProjectBridge(serializeLedger(createLedger('项目 A', 100_00)))
    const second = await createProjectBridge(serializeLedger(createLedger('项目 B', 200_00)))
    await deleteProjectBridge(first.value!.id)
    const projects = await listProjectsBridge()
    expect(projects.value?.map((item) => item.id)).toEqual([second.value!.id])
  })

  it('全局设置独立保存关闭托盘选项与主题', async () => {
    const defaults = await getSettingsBridge()
    expect(defaults.value?.settings.closeToTray).toBe(true)
    expect(defaults.value?.settings.theme).toBe('system')
    await updateSettingsBridge({ closeToTray: false, theme: 'dark' })
    const changed = await getSettingsBridge()
    expect(changed.value?.settings.closeToTray).toBe(false)
    expect(changed.value?.settings.theme).toBe('dark')
  })

  it('浏览器预览返回明确且安全的版本检测状态', async () => {
    const current = await getUpdateStateBridge()
    const checked = await checkForUpdatesBridge()
    expect(current.ok).toBe(true)
    expect(current.value).toMatchObject({ currentVersion: '2.0.0', status: 'unavailable' })
    expect(checked.value?.message).toContain('浏览器预览模式')
  })
})
