/** Cookie holding the v2 theme choice; a plain module so server and client import the same string. */
export const THEME_COOKIE = 'rs_theme'
export type ThemeChoice = 'light' | 'dark' | 'system'
export function readThemeChoice(raw: string | undefined): ThemeChoice {
  return raw === 'dark' || raw === 'light' ? raw : 'system'
}
