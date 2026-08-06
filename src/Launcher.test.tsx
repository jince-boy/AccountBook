import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Launcher from './Launcher'
import { createProjectBridge } from './lib/bridge'
import { createLedger, serializeLedger } from './lib/ledger'

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
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
    matches: false,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
})

describe('项目中心', () => {
  it('不展示数据保存路径，并要求输入完整项目名后才能移除', async () => {
    await createProjectBridge(serializeLedger(createLedger('城南咖啡店', 30_000_00)))
    render(<Launcher />)

    expect(await screen.findByText('城南咖啡店')).toBeInTheDocument()
    expect(screen.queryByText('浏览器本地存储（桌面版可自定义）')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '移除项目：城南咖啡店' }))
    const removeButton = screen.getByRole('button', { name: /移入回收目录/ })
    expect(removeButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('请输入项目名称“城南咖啡店”以确认'), { target: { value: '城南咖啡' } })
    expect(removeButton).toBeDisabled()
    fireEvent.change(screen.getByLabelText('请输入项目名称“城南咖啡店”以确认'), { target: { value: '城南咖啡店' } })
    expect(removeButton).toBeEnabled()
    fireEvent.click(removeButton)

    await waitFor(() => expect(screen.queryByText('移除“城南咖啡店”？')).not.toBeInTheDocument())
    expect(screen.queryByText('城南咖啡店')).not.toBeInTheDocument()
  })
})
