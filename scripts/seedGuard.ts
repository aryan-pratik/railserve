/**
 * Demo and seed scripts write fake data and some delete orders. They may only
 * touch the throwaway databases, never production (`railserve` on the VPS, or
 * the frozen `railserve` copy on Atlas).
 */
const ALLOWED = ['railserve_dev', 'railserve_staging', 'railserve_test']

export function assertSeedTarget(uri = process.env.MONGODB_URI ?? ''): string {
  const db = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'http://')).pathname.replace(/^\//, '')
  if (!ALLOWED.includes(db)) {
    throw new Error(`Refusing to run: MONGODB_URI names database "${db || '(none)'}"; allowed: ${ALLOWED.join(', ')}.`)
  }
  return db
}
