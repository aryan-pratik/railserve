# RailServe v2 UI: the contract

Every screen under `src/app/v2/**` is built from this folder. Read this before
touching a v2 screen. The goal is one product that feels like one product.

## The look

White rounded "bento" blocks on a soft grey canvas. Each block is a `Card`
(1px `v2-line`, `rounded-v2-lg`, white). Blocks never share a border; the
canvas gap between them is the separation. No shadows on resting blocks; only
floating things (menus, dialogs, toasts) carry `shadow-v2-pop`.

- **Font:** `font-v2` (Plus Jakarta Sans) is inherited from the shell. Mono
  (`font-mono tabular-nums`, or `<Mono>`) for everything the railway issues:
  train numbers, coach/berth, order ids, times, money.
- **One brand colour.** Green (`v2-brand`, `v2-brand-deep`, `v2-mint`,
  `v2-brand-soft`) means action and done. **Amber / orange / red are time
  pressure only** (`v2-soon`, `v2-urgent`, `v2-over`), used through
  `Countdown` and `RunHeader`. Never colour a card by status.
- **Hatching = not yet.** `v2-hatch` for future hours, orders still cooking,
  empty capacity.
- **Status is a `Chip`** with a word (`statusChip(status)`). Only
  "Out for delivery" is a filled chip; everything else is a soft tint.
- **Buttons are pills.** One `primary` per block. Danger actions are outlined
  red and always confirm; the confirm carries the reason field.
- Type scale: page title 30/700, card title 17/700, body 14, small 12.5,
  label 11 uppercase (`Eyebrow`), stat 44/700.
- Phone first: every grid collapses to one column under `xl`; tables sit in
  `TableFrame`, which scrolls sideways on its own.

## Components (import from `@/components/v2/...`)

| File | Exports |
|---|---|
| `ui.tsx` | `Button`, `ButtonLink`, `buttonClass`, `Chip`, `statusChip`, `Card`, `Mono`, `Seat`, `Eyebrow`, `Avatar`, `VegMark`, `cx`, `v2Focus` |
| `Table.tsx` | `TableFrame`, `Table`, `Th`, `Td`, `Pagination`, `PillTabs`, `EmptyState`, `Notice`, `PageHeader`, `KeyValue` |
| `RunHeader.tsx` | `RunHeader` (the departure-board strip for one train run) |
| `Countdown.tsx` | `Countdown` (live chip), `CountdownClock` (mm:ss) |
| `DateFilter.tsx` | `DateFilter`: the one date filter for lists (All time · Today · Yesterday · This month · Month · calendar). Today is the default on every list except the Inbox |
| `DayPicker.tsx` | `DayPicker`: one service day at a time for boards (‹ › arrows, calendar, Today reset), `?date=` |
| `Shell.tsx`, `ShellFrame.tsx`, `SidebarNav.tsx`, `MobileNav.tsx`, `CommandPalette.tsx`, `NotificationsBell.tsx` | the frame (collapsible sticky sidebar, phone drawer, ⌘K search via `/v2/search`, the bell); pages never render these, the `/v2` layout does |

Need something new? Add a new file in this folder and export it. Do not edit
`globals.css`, `src/app/layout.tsx` or `ui.tsx` from a screen build; ask.

**Client/server boundary.** A `'use client'` file may export only components.
A server component that imports a string, constant or helper from a client
module receives a client *reference*, not the value (fields render unstyled,
cookie names never match). Put shared constants and pure helpers in
`src/lib/v2/*Shared.ts` (no repo, model, db or mongoose imports there) and
import them from both sides. Conversely a client file must never import a
value from a module that touches `@/lib/repo`, `@/lib/models` or `@/lib/db`.

## Data and behaviour rules

- Pages are server components. Filters live in the URL; submit them with
  `@/components/QueryForm` (client navigation). Pagination through
  `Pagination` with `page` and `pageSize` params. **No row caps**: every list
  paginates or shows a total.
- Read only through `src/lib/repo/**` and `src/lib/board.ts`; the ESLint
  isolation rule rejects raw `Order` access. Mutations reuse the existing
  server actions in `src/app/actions/*`, `src/app/admin/**/actions.ts`,
  `src/app/store/actions.ts`; do not fork a new copy of a transition.
- Role: every page calls `requireRole(...)`. The `/v2` layout only needs a
  signed-in user; it draws the nav for that role.
- Times are IST through `src/lib/format.ts` (`formatTimeIST`,
  `formatServiceDate`, `utcToIstLocal`). Money through `formatRupees`.
- Live time on the client: `Countdown` with `serverNowMs` from the page, so
  hydration matches.
- Empty states say what will appear and give one action. Loading states are
  skeletons in the shape of the block, never a centred spinner.
- Phone numbers are masked in lists and tables (`98••• 44120`); the full
  number is on the order workspace and as a `tel:` link.
- Copy: short, sentence case, operational. "Hand to rider", "Mark ready",
  "Could not deliver". No exclamation marks, no emoji.

## Where things live (v2 information architecture)

| Route | What | Replaces (v1) |
|---|---|---|
| `/v2/admin` | Today dashboard | `/admin` header area |
| `/v2/orders` | One orders table with saved views (Today, Upcoming, Enquiries, Returns, Cancelled, All) and a grouped-by-train mode | `/admin`, `/admin/orders`, `/store/history`, `/calls`, `/calls/live`, `/admin/enquiries`, `/admin/returns`, `/store/returns`, `/calls/returns` |
| `/v2/orders/new` | Order composer (paste or form) | `/admin/orders/new`, `/store/orders/new`, `/admin/enquiries/new` |
| `/v2/orders/[id]` | Order workspace: facts, role sections, journey timeline, every action | `/admin/orders/[id]`, `/store/orders/[id]`, `/calls/orders/[id]`, `/admin/enquiries/[id]` |
| `/v2/kitchen` | Kitchen board (columns per train, tickets per order; wall mode at `?wall=1`) | `/store`, `/store/runs/*/kot` |
| `/v2/riders` | Map + roster, `/v2/riders/[id]`, `/v2/riders/teams`, cash collection | `/admin/riders/**`, `/store/staff` |
| `/v2/calls` | Call board (telecaller) | `/calls/live` |
| `/v2/chat` | WhatsApp inbox | `/admin/chat`, `/calls/chat` |
| `/v2/inbox` | Review queue for emails that did not become orders | `/admin/inbox` |
| `/v2/payments` | Bank credits ledger | `/admin/payments`, `/store/payments`, `/calls/payments` |
| `/v2/menu` | Dish catalogue and diet tagging | `/admin/menu` |
| `/v2/analytics` | Reports | `/admin/analytics` |
| `/v2/activity` | Audit feed | `/admin/activity` |
| `/v2/settings` | Company, Stations, Outlets (editable), Routing (aggregators), Staff, Integrations, Train lookup | `/admin/setup`, `/admin/trains` |

Feature parity is the contract: `docs/REVAMP_INVENTORY.local.md` lists every
capability of the v1 screen you are replacing. Read its section first.
