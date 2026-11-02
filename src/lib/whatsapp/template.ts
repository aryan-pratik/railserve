/**
 * Filling a WhatsApp template's body the way Meta does: `{{1}}`, `{{2}}`…
 * replaced positionally. Anything the values do not cover is left as it was,
 * so a mismatch is visible in the thread rather than silently blank.
 */
export function renderTemplateBody(body: string, values: readonly string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n: string) => {
    const v = values[Number(n) - 1]
    return v === undefined ? m : v
  })
}
