/** "18 Nov, 9:40 pm" in IST, for the menu's "last ordered" column. */
const FMT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
})

export function formatShortDateTime(iso: string): string {
  return FMT.format(new Date(iso))
}
