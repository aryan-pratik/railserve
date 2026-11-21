/** Cookie holding the v2 screen choice; a plain module so server and client import the same string. */
export const THEME_COOKIE = 'rs_theme'
/** Light unless the person picked dark. There is no "follow the phone" option: one predictable look. */
export type ThemeChoice = 'light' | 'dark'
export function readThemeChoice(raw: string | undefined): ThemeChoice {
  return raw === 'dark' ? 'dark' : 'light'
}
