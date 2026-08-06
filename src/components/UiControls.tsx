import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Info,
  X,
} from 'lucide-react'

export type SelectOption<T extends string> = { value: T; label: string }

export function CustomSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  compact = false,
}: {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value) || options[0]

  useEffect(() => {
    if (!open) return
    const handlePointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', handlePointer)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('pointerdown', handlePointer)
      window.removeEventListener('keydown', handleKey)
    }
  }, [open])

  function handleTriggerKey(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Enter' || event.key === ' ') return setOpen((current) => !current)
    const currentIndex = Math.max(0, options.findIndex((option) => option.value === value))
    const step = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = (currentIndex + step + options.length) % options.length
    onChange(options[nextIndex].value)
    setOpen(true)
  }

  return <div className={`custom-select ${compact ? 'compact' : ''} ${open ? 'open' : ''}`} ref={root}>
    <button
      type="button"
      className="custom-select-trigger"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={handleTriggerKey}
    >
      <span>{selected?.label}</span><ChevronDown size={13} />
    </button>
    {open && <div className="custom-select-menu" role="listbox" aria-label={ariaLabel}>
      {options.map((option) => <button
        type="button"
        role="option"
        aria-selected={option.value === value}
        className={option.value === value ? 'selected' : ''}
        key={option.value}
        onClick={() => { onChange(option.value); setOpen(false) }}
      >
        <span>{option.label}</span>{option.value === value && <Check size={13} />}
      </button>)}
    </div>}
  </div>
}

function parseLocalDateTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!match) return new Date()
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]))
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function toLocalDateTimeValue(date: Date) {
  const two = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`
}

function sameDay(first: Date, second: Date) {
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth() && first.getDate() === second.getDate()
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

export function DateTimePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = parseLocalDateTime(value)
  const [open, setOpen] = useState(false)
  const [popoverPosition, setPopoverPosition] = useState({ top: 10, left: 10 })
  const [viewMonth, setViewMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1))
  const root = useRef<HTMLDivElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const hours = useMemo(() => Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: String(hour).padStart(2, '0') })), [])
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, minute) => ({ value: String(minute), label: String(minute).padStart(2, '0') })), [])

  useEffect(() => {
    if (!open) return
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !popover.current?.contains(target)) setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', handlePointer)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('pointerdown', handlePointer)
      window.removeEventListener('keydown', handleKey)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const triggerBounds = root.current?.getBoundingClientRect()
      if (!triggerBounds) return
      const gap = 10
      const offset = 7
      const width = popover.current?.offsetWidth || 322
      const height = popover.current?.offsetHeight || 334
      const availableBelow = window.innerHeight - triggerBounds.bottom - gap
      const availableAbove = triggerBounds.top - gap
      let top = triggerBounds.bottom + offset
      if (availableBelow < height) {
        top = availableAbove >= height
          ? triggerBounds.top - height - offset
          : Math.max(gap, Math.min(triggerBounds.top - height - offset, window.innerHeight - height - gap))
      }
      const left = Math.max(gap, Math.min(triggerBounds.left, window.innerWidth - width - gap))
      setPopoverPosition({ top: Math.round(top), left: Math.round(left) })
    }
    updatePosition()
    const frame = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, viewMonth, value])

  function openPicker() {
    const current = parseLocalDateTime(value)
    setViewMonth(new Date(current.getFullYear(), current.getMonth(), 1))
    setOpen((previous) => !previous)
  }

  function updateDate(next: Date) {
    const current = parseLocalDateTime(value)
    current.setFullYear(next.getFullYear(), next.getMonth(), next.getDate())
    onChange(toLocalDateTimeValue(current))
  }

  function updateTime(part: 'hour' | 'minute', nextValue: string) {
    const current = parseLocalDateTime(value)
    if (part === 'hour') current.setHours(Number(nextValue))
    else current.setMinutes(Number(nextValue))
    onChange(toLocalDateTimeValue(current))
  }

  const firstDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
  const leadingBlanks = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate()
  const cells = Array.from({ length: 42 }, (_, index) => index - leadingBlanks + 1)
  const today = new Date()
  const display = `${selected.getFullYear()}/${String(selected.getMonth() + 1).padStart(2, '0')}/${String(selected.getDate()).padStart(2, '0')} · ${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}`

  const picker = <div ref={popover} className="datetime-popover" role="dialog" aria-label="选择日期和时间" style={popoverPosition}>
      <div className="calendar-heading">
        <button type="button" aria-label="上个月" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}><ChevronLeft size={15} /></button>
        <strong>{viewMonth.getFullYear()} 年 {viewMonth.getMonth() + 1} 月</strong>
        <button type="button" aria-label="下个月" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}><ChevronRight size={15} /></button>
      </div>
      <div className="calendar-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">{cells.map((day, index) => {
        if (day < 1 || day > daysInMonth) return <span className="calendar-blank" key={`blank-${index}`} />
        const date = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day)
        const className = `${sameDay(date, selected) ? 'selected' : ''} ${sameDay(date, today) ? 'today' : ''}`.trim()
        return <button type="button" className={className} aria-label={`${viewMonth.getMonth() + 1}月${day}日`} key={day} onClick={() => updateDate(date)}>{day}</button>
      })}</div>
      <div className="datetime-time-row">
        <span><Clock3 size={14} /> 时间</span>
        <div className="time-selectors">
          <CustomSelect compact ariaLabel="小时" value={String(selected.getHours())} options={hours} onChange={(next) => updateTime('hour', next)} />
          <b>:</b>
          <CustomSelect compact ariaLabel="分钟" value={String(selected.getMinutes())} options={minutes} onChange={(next) => updateTime('minute', next)} />
        </div>
      </div>
      <div className="datetime-actions">
        <button type="button" className="text-button" onClick={() => { const now = new Date(); onChange(toLocalDateTimeValue(now)); setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1)) }}>设为现在</button>
        <button type="button" className="button primary" onClick={() => setOpen(false)}>完成</button>
      </div>
    </div>

  return <>
    <div className={`datetime-picker ${open ? 'open' : ''}`} ref={root}>
      <button type="button" className="datetime-trigger" aria-label="选择发生时间" aria-haspopup="dialog" aria-expanded={open} onClick={openPicker}>
        <CalendarDays size={15} /><span>{display}</span><ChevronDown size={13} />
      </button>
    </div>
    {open && createPortal(picker, document.body)}
  </>
}

function toastTone(message: string) {
  if (/失败|错误|无法|无效|异常|超出|请先|不存在/.test(message)) return 'error'
  if (/警告|注意|恢复|稍候/.test(message)) return 'warning'
  return 'success'
}

export function ToastNotice({ message, onClose }: { message: string; onClose: () => void }) {
  const tone = toastTone(message)
  const Icon = tone === 'error' ? CircleAlert : tone === 'warning' ? Info : CircleCheck
  const title = tone === 'error' ? '操作未完成' : tone === 'warning' ? '请注意' : '操作成功'
  return <div className={`toast toast-${tone}`} role="status" aria-live="polite">
    <span className="toast-symbol"><Icon size={17} /></span>
    <div><strong>{title}</strong><p>{message}</p></div>
    <button type="button" aria-label="关闭消息" onClick={onClose}><X size={13} /></button>
    <i className="toast-progress" />
  </div>
}
