import type { AppSettings } from '../types/electron'

export type ThemePreference = AppSettings['theme']

export function applyTheme(theme: ThemePreference): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const update = () => {
    const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
    document.documentElement.dataset.theme = resolved
    document.documentElement.dataset.themePreference = theme
    document.documentElement.style.colorScheme = resolved
  }
  update()
  if (theme === 'system') media.addEventListener('change', update)
  return () => media.removeEventListener('change', update)
}
