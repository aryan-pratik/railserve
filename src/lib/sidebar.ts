/**
 * Cookie that remembers the desktop sidebar's collapsed state. A cookie rather
 * than localStorage so AppShell can read it on the server and render the
 * right width first time, instead of flashing wide and snapping narrow.
 */
export const SIDEBAR_COOKIE = 'rs_sidebar'
