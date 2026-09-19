# RailServe Frontend UI Audit

**Scope:** everything under `src/app` and `src/components`, as of the current working tree (2026-09-18) — including the uncommitted, in-progress changes to `src/components/ui.tsx`, `src/app/admin/setup/*`, and `src/app/admin/orders/AdminOrdersTable.tsx`. Read-only audit. No code or functionality was changed or invented; every finding below cites the actual file and, where stable enough to be useful, a line range.

## How to read this document

RailServe's frontend is unusually disciplined for a codebase this size: it already has a single, documented shared vocabulary (`src/components/ui.tsx` plus a handful of sibling components) that the large majority of screens build on. Colors, radii and spacing have essentially zero drift. The findings below are therefore almost entirely **duplication of logic/markup that should reuse an existing primitive**, not an absence of a system — either older code that predates a primitive, or new code that quietly reinvents one. A short list of findings are places where the vocabulary itself doesn't yet have the primitive it needs (three or more call sites hand-rolling the same thing independently). The final sections list what's already working well, because that context matters when prioritizing fixes.

---

## 1. Current architecture

- **Stack**: Next.js 16 (App Router), React 19, Tailwind CSS v4 (`@theme` tokens in `globals.css`, no `tailwind.config.*`), TypeScript, Mongoose. No component library (no shadcn/Radix/MUI) — every primitive is hand-built in `src/components/`.
- **Rendering model**: pages are `async` Server Components that read directly from Mongoose repositories (enforced through `lib/repo/orderRepo.ts` by a custom ESLint rule — direct `Order` model access outside the repo/transition layer is a build error, see `eslint.config.mjs`). Interactivity is isolated into small `'use client'` leaf components (action buttons, inline editors, live feeds). Filter/search forms navigate client-side through a shared `QueryForm` + `useNavTransition` pair instead of a full page reload.
- **Three role-scoped surfaces**, each its own route subtree with a `layout.tsx` that gates on role and wraps `AppShell`:
  - **`/admin`** (ADMIN) — order board, all-orders lookup, enquiries (bulk WhatsApp intake), inbox (unparsed-email triage), payments, train status, analytics, setup (outlets/staff).
  - **`/store`** (STORE_MANAGER, ADMIN) — kitchen board, order history, payments.
  - **`/agent`** (DELIVERY_AGENT) — run list, run detail, delivery actions. Visibly tuned for one-handed phone use (`h-12` inputs/buttons, big tap targets).
- **Outside the three surfaces**: `/login`, `/` (role dispatcher), `/not-found`, `/privacy` (OAuth consent page), `/internal/print/*` (headless render targets for the server-side KOT screenshot pipeline — no `AppShell`, no nav), and a set of `/api/*` route handlers (auth, cron jobs, SSE streams, the mobile app's API, print-agent polling).
- **Shared chrome**: `AppShell` → `Sidebar` (desktop rail / mobile drawer, both rendered from one `content` block) → `NavLinks`, plus a `TopProgress` bar keyed to the shared nav-pending transition state and a global skip-to-content link.
- **Design tokens** live in `src/app/globals.css` as a Tailwind v4 `@theme` block: `canvas`/`surface`/`sunken` surface tiers, a `line`/`line-strong` border pair, an `ink`/`muted`/`faint` text triad (contrast ratios measured and commented against every surface — worst case 4.72:1), one accent (indigo), two font faces (Inter for UI, JetBrains Mono for train numbers/seats/KOT, chosen specifically for its unambiguous zero/one/l/I glyphs). Explicitly a **single light theme**, no dark mode, with a stated rationale (daylight kitchen/platform legibility, thermal-print requirement) — see §5.
- **No CSS-in-JS, no per-page stylesheets** — 100% Tailwind utility classes, composed through named string exports (`inputClass`, `focusRing`, `segmentedClass`, …) as often as through wrapper components, which is why several "duplicated pattern" findings below are re-typed class strings rather than copy-pasted JSX.

### Routes / pages inventory

| Surface | Route | File |
|---|---|---|
| Admin | `/admin` | `app/admin/page.tsx` — order board (`TrainGroups` + `OrdersToolbar`) |
| Admin | `/admin/orders` | `app/admin/orders/page.tsx` — flat lookup table |
| Admin | `/admin/orders/new` | `app/admin/orders/new/page.tsx` |
| Admin | `/admin/orders/[id]` | `app/admin/orders/[id]/page.tsx` |
| Admin | `/admin/orders/export` | `app/admin/orders/export/route.ts` (CSV) |
| Admin | `/admin/enquiries` | `app/admin/enquiries/page.tsx` |
| Admin | `/admin/enquiries/new` | `app/admin/enquiries/new/page.tsx` |
| Admin | `/admin/enquiries/[id]` | `app/admin/enquiries/[id]/page.tsx` |
| Admin | `/admin/inbox` | `app/admin/inbox/page.tsx` |
| Admin | `/admin/payments` | `app/admin/payments/page.tsx` (renders shared `PaymentsScreen`) |
| Admin | `/admin/payments/export` | `app/admin/payments/export/route.ts` (CSV) |
| Admin | `/admin/trains` | `app/admin/trains/page.tsx` |
| Admin | `/admin/setup` (+ `?tab=staff`) | `app/admin/setup/page.tsx` |
| Store | `/store` | `app/store/page.tsx` — kitchen board |
| Store | `/store/history` | `app/store/history/page.tsx` |
| Store | `/store/orders/new` | `app/store/orders/new/page.tsx` |
| Store | `/store/orders/[id]` | `app/store/orders/[id]/page.tsx` |
| Store | `/store/orders/[id]/kot` | `app/store/orders/[id]/kot/page.tsx` |
| Store | `/store/runs/[runKey]/kot` | `app/store/runs/[runKey]/kot/page.tsx` |
| Store | `/store/payments` | `app/store/payments/page.tsx` (renders shared `PaymentsScreen`) |
| Agent | `/agent` | `app/agent/page.tsx` — run list |
| Agent | `/agent/orders/[id]` | `app/agent/orders/[id]/page.tsx` |
| Agent | `/agent/runs/[runKey]` | `app/agent/runs/[runKey]/page.tsx` |
| Shared | `/`, `/login`, `/privacy`, `/not-found` | `app/page.tsx`, `app/login/page.tsx`, `app/privacy/page.tsx`, `app/not-found.tsx` |
| Print | `/internal/print/order/[id]`, `/internal/print/run/[runKey]` | headless, no `AppShell` |

Every `loading.tsx`/`error.tsx` pair per surface routes to the same two shared components (`PageSkeleton`, `ErrorState`) — see §6. **No route duplicates another's functionality.** `PaymentsScreen` is explicitly one component serving both `/admin/payments` and `/store/payments` via a `privileged` flag — the right pattern, and the template to follow for the next screen two roles both need (see §6).

## 2. Existing design system

### `src/components/ui.tsx` — the shared vocabulary

Not just a components file: every export carries a comment explaining *why*, not just *what*. Current exports:

| Category | Exports |
|---|---|
| Focus | `focusRing`, `focusRingInset` |
| Surfaces | `Card`, `CardHeader`, `EmptyState`, `PageHeader`, `BackLink` |
| Notices | `Notice` (tone: `info`/`warn`/`danger`/`success`) |
| Stats | `StatStrip`, `Stat` |
| Buttons | `Button`, `ButtonLink`, `ButtonAnchor`, `IconButton` (variants: `primary`/`secondary`/`ghost`/`danger`/`go`; sizes: `sm`/`md`/`lg`) |
| Inline editing | `editTriggerClass`, `editInputClass` — auto-commit-on-blur/Enter idiom, no confirm/cancel buttons (mid-migration, see §3.1) |
| Forms | `inputBase`, `inputClass`, `textareaClass`, `Field`, `FormNote` |
| Segmented control | `segmentedClass`, `segmentClass` |
| Tables | `thClass`, `Dash` |
| Badges | `StatusBadge` (+ `statusLabel`), `TypeBadge`, `PaymentBadge`, `CoachChip` (has an `lg` size variant) |
| Pagination | `Pagination`, `PAGE_SIZE_OPTIONS` |
| Tabs | `Tabs` |

### Adjacent shared components (outside `ui.tsx`)

`Modal` (new, uncommitted), `ConfirmDialog`, `Skeleton` (`PageSkeleton`), `Spinner`, `ErrorState`, `CopyButton`, `DateFilter`, `QueryForm`, `LinkHint`, `AppShell`/`Sidebar`/`NavLinks`, `Icons` (26 hand-drawn 24×24 stroke icons, consistently `strokeWidth="2"`), `OrdersTable`/`TableFrame` (+ role-specific `AdminOrdersTable`, `PaymentsTable`), `OrderCard`, `TrainRunCard`, `TrainTiming` (`DelayPill`, `PlatformBadge`, `StaleFlag`, `FeedUpdated`, `CheckCycle`), `UrgencyRail`, `EventLog`, `AutoRefresh`/`PaymentsLive`/`OrderFeed` (SSE/polling live-status indicators).

### Existing patterns by category (checklist coverage)

- **Forms**: every form uses `Field` + `inputClass`/`textareaClass` + `FormNote`, driven by `useActionState` against a Server Action. Adoption is high — a repo-wide grep found 17 files importing the shared input classes, and every other `<input>` in the codebase that *doesn't* import them turns out to be a `hidden` or checkbox input, not a missed case.
- **Tables**: `thClass` + `px-3 py-2.5` cells + `divide-y divide-line` + `bg-sunken/60` header is applied consistently across `AdminOrdersTable`, `OrdersTable`, `PaymentsTable`, the enquiries/analytics/setup tables, and `TrainGroups`' expanded order table. Density does not drift.
- **Modals/dialogs**: two shapes — `Modal` (arbitrary content, e.g. a form) and `ConfirmDialog` (question + two buttons). Both are `role="dialog"`/`"alertdialog"`, trap focus, close on Escape, lock body scroll, and restore focus to the opener. `OrderSlideOver` (a right-hand panel, not a centered modal) and `Sidebar`'s mobile drawer implement the same focus/Escape/scroll-lock behavior a third and fourth time, independently (see §3.5).
- **Dropdowns/selects**: plain native `<select>` styled with `inputBase`/`inputClass` everywhere a real `<select>` fits (toolbars, role pickers, status editors). Two bespoke non-native dropdowns exist for cases a `<select>` can't express: `DateFilter`'s calendar/range popover, and `OutletMultiSelect`'s always-open, searchable multi-select panel (explicitly *not* a popover, with a comment explaining why — a popover positioned off a small trigger kept overflowing its container).
- **Navigation**: `AppShell` → `Sidebar` → `NavLinks`, one definition per role in each surface's `layout.tsx`. Active-state logic correctly special-cases the three section roots (`/admin`, `/store`, `/agent` match only exactly, not by prefix, so the root nav item doesn't light up on every sub-route).
- **Buttons**: one `buttonClass()` factory behind `Button`/`ButtonLink`/`ButtonAnchor`, five variants, three sizes. `IconButton` is the separate square/icon-only shape, always requiring `aria-label`.
- **Icons**: one file, one visual language (24×24 viewBox, `strokeWidth="2"`, `strokeLinecap`/`strokeLinejoin="round"`), sized per call site via a `size` prop rather than fixed CSS. No mixed icon sets.
- **Colors**: token-only. A repo-wide grep confirms only Tailwind's `slate-` gray family is used for neutral colors — `gray-`/`zinc-`/`neutral-`/`stone-` never appear, which is a common failure mode in hand-styled Tailwind apps that simply hasn't happened here. Semantic colors (status, urgency, payment mode) are amber/red/emerald/sky/indigo/fuchsia used consistently for the same meaning (amber/red = needs attention, emerald = done/live, fuchsia = bulk-order flag).
- **Typography**: `text-xs`/`text-sm` carry almost the entire UI (menus, tables, labels); `text-2xl` is the "biggest number on the card" size (stats, countdowns); `h1`/`h2`/`h3` get negative letter-spacing at increasing size, documented in `globals.css`, specifically so large text doesn't just read as "big." `text-3xl` appears in exactly two places (login heading, `LeaveNowBanner`'s countdown) — both single-purpose, not a drifted scale.
- **Spacing**: table cells are `px-3 py-2.5` everywhere; card padding is `p-4`; the page gutter is `px-4 py-5` on phone, `px-8 py-6` on desktop, set once in `AppShell`. No page reimplements its own outer padding.
- **Responsive behavior**: mobile-first throughout — the sidebar collapses to a drawer under `lg:`, every data table sits in a horizontally-scrolling `TableFrame` with a `min-w` floor rather than letting the page itself scroll sideways, and the agent surface is deliberately larger-touch-target/higher-contrast than admin/store for one-handed platform use.
- **Loading states**: every route section (`admin/`, `store/`, `agent/`, plus `store/payments/`) has its own `loading.tsx` delegating to the shared `PageSkeleton`, which renders shape-matched bars (header, stat strip, filter row, table) rather than a spinner — this is structural, not just conventional, since Next.js requires the file to exist for the loading UI to show at all.
- **Empty states**: one `EmptyState` component (dashed border, centered) used everywhere a list can be empty, with page-specific title/note copy.
- **Error states**: every route section also has an `error.tsx` delegating to the shared `ErrorState` (logs to console, offers "Try again" + "Back to the board"). Uniform by construction, same as loading.
- **Toasts**: **there is no toast/snackbar system anywhere in the app** (confirmed by a repo-wide search). Feedback from a mutation is inline instead — `FormNote` next to the button that triggered it, or a `Notice` banner for a page-level condition. This looks deliberate and is consistent with the app's server-action-driven forms; noted here only because it's an explicit item on most UI audits and its absence should be read as "not used," not "missing."
- **Confirmation dialogs**: one `ConfirmDialog` component, four real call sites (`AdminOrderActions`, `AdminOrdersTable`, `StoreOrderActions`, `StoreRunActions`) — all "delete" or "print anyway, this train is late" decisions, all sized `max-w-sm`, all render the same two-button footer shape.
- **Accessibility**: broadly strong. Icon-only buttons require `aria-label` by the `IconButton` type signature itself (not just convention). Dialogs carry `role`/`aria-modal`/`aria-labelledby`. Status regions use `role="alert"` (errors) vs `role="status"` (success/info) correctly. `UrgencyRail`'s color choices are backed by measured WCAG contrast ratios in a comment, including a documented regression that was caught and fixed (white-on-amber-500 at 2.13:1). A handful of specific gaps are called out in §3.

## 3. Problems

### 3.1 A design-system migration is mid-flight, and it has split the app into two inline-edit dialects

The uncommitted diff to `ui.tsx` removes `EditPencil` and `InlineEditButtons` (hover-pencil affordance + explicit check/cross `IconButton` pair) in favor of a plain auto-commit-on-blur/Enter idiom. The comment added alongside the removal explains why: *"a control that competes with its neighbor for width is exactly what silently overflows into the next table column."* `AdminOrdersTable.tsx`'s `AmountEditor`/`StatusEditor` (lines 225–338) already reflect this — no confirm/cancel buttons, blur or Enter commits, Escape cancels.

`PaymentsTable.tsx`'s `RemarkEditor` (lines 96–165) was **not** migrated. It still:
- shows a hover/focus-revealed pencil icon (`IconPencil`, `opacity-0 group-hover:opacity-100`, lines 113–117) that the new idiom has no equivalent for,
- commits via an explicit `IconButton` pair (`IconCheck`/`IconClose`, lines 155–158) rather than blur/Enter,
- hand-declares its own `EDIT_INPUT` constant (lines 26–28) that is a near-duplicate of `editInputClass` that has already **drifted** — `px-2` here vs `editInputClass`'s `px-1.5`, plus an added `min-w-0 flex-1` — instead of importing and composing the shared class, and
- gives its trigger button (lines 101–105) a bespoke class list rather than `editTriggerClass`, so it has no hover background at all — the one editable-cell affordance in the app that's invisible until you already know to click it.

**Severity: notable.** The same interaction (edit a value in place, inside a table cell) now renders two different ways depending only on which table you're in — immediately after a refactor that specifically removed the pattern `PaymentsTable` still uses.

### 3.2 The setup page's modal migration is asymmetric

`src/app/admin/setup/*` was reworked (uncommitted) from inline forms into `Modal`-triggered forms (`OutletFormModal`, `StaffFormModal`). The staff side got a full create/edit flow: `StaffFormModal` accepts `editId`/`values`, the staff table has a row-level "Edit" link (`?edit=<id>`), and the modal opens pre-filled and deep-linkable.

The outlet side did not get the same treatment. `OutletFormModal` (`app/admin/setup/OutletFormModal.tsx`) takes **no props** and only ever renders `<OutletForm />` with empty defaults — it's create-only. The outlets table in `admin/setup/page.tsx` has no "Edit" column/link at all, even though `OutletForm` itself already accepts a `values` prop and could support editing with no new plumbing (it's the same component `StaffForm`'s edit path already proves out). Net effect: an admin can fix a typo in a staff member's outlet assignment but cannot fix a typo in the outlet's own name, station code, walk time, or aliases from the UI.

**Severity: notable** — a functional gap introduced by an in-progress refactor, not a hypothetical: the edit-capable form already exists, it's simply never wired up on this one path.

### 3.3 One formatting helper exists; the "how long" calculation is reimplemented at least ten times

`src/lib/format.ts` exports `formatTimeIST` (`"1:25 pm"`) but has **no** "minutes → `Xh Ym`" duration formatter. That exact calculation — `Math.floor(mins / 60)`, `mins % 60`, joined as `` `${h}h ${m}m` `` (sometimes with a `late`/`ago`/`overdue` suffix) — is written independently in:

| File | Symbol (lines) |
|---|---|
| `components/UrgencyRail.tsx` | `span()` (57–63) |
| `components/TrainTiming.tsx` | inline in `DelayPill` (16–18) |
| `components/ReadyByCountdown.tsx` | inline in `describe()` (8–11) |
| `components/TimeUntil.tsx` | `span()` (5–9) |
| `components/LeaveNowBanner.tsx` | inline (56–57) |
| `app/store/StoreOrderActions.tsx` | `formatDelay()` (25–29) |
| `app/store/StoreRunActions.tsx` | `formatDelay()` (14–17) |
| `app/admin/TrainGroups.tsx` | `lateLabel()` (67–69) |
| `app/admin/trains/TrainLookupForm.tsx` | inline in `ago()` (24–29), *and again* inline in the Delay `Row` (128–136) |

That's nine files, ten call sites. Each one independently chooses its own edge-case behavior, and they have already drifted: `UrgencyRail.span()` switches to a compact `"13h"` form above 10 hours and rounds to whole hours past that point, while every other implementation keeps printing minutes (`"13h 45m"`) no matter how large the value gets. `ReadyByCountdown.describe()` additionally takes `Math.abs()` of the input so the same function serves both "in" and "overdue" framing, a design choice the other nine sites don't share.

Separately, the **wall-clock IST formatter** — `toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true })`, exactly what `formatTimeIST` already does — is reimplemented inline instead of imported in:
- `app/store/StoreOrderActions.tsx:136–138`
- `app/store/StoreRunActions.tsx:191–193`
- `components/LeaveNowBanner.tsx:40–42`
- `app/admin/TrainGroups.tsx:58–65` (`hhmm()`)
- `app/admin/trains/TrainLookupForm.tsx:18–22` (`istTime()` — a `toLocaleString` variant that also carries day/month, so it's a sixth, distinct date-formatting convention on top of the five in `lib/format.ts`)

**Severity: notable.** This is the largest, most evidence-backed duplication in the app — not a style nit, a maintenance hazard: a bug fix or format change to "how we show elapsed/remaining time" today requires editing ten-plus call sites, several of which have already silently diverged from each other.

### 3.4 The "label / value" detail row is reimplemented at least four times, each slightly differently

Four separate files independently build the same concept — an uppercase-or-plain label on the left, a value on the right — for a vertical stack of order/train facts, and no two of them agree on markup:

- `app/admin/OrderSlideOver.tsx` — `Row()` (lines 302–309): `items-baseline`, no border (relies on the parent's own spacing), eyebrow-style label (`text-xs font-semibold uppercase tracking-wider text-muted`).
- `app/admin/orders/[id]/page.tsx` — `Row()` (lines 17–24): `justify-between` (not `items-baseline`), plain label (`text-sm text-muted`, no uppercase), no border of its own (parent wraps rows in `divide-y divide-line`).
- `app/admin/trains/TrainLookupForm.tsx` — `Row()` (lines 9–16): `items-baseline`, plain label, its own `border-b border-line py-2.5 last:border-0` (doesn't rely on a `divide-y` parent), plus a `tone` prop the other three don't have.
- `app/admin/enquiries/[id]/page.tsx` (lines 101–107): the same shape as the `admin/orders/[id]/page.tsx` version, inlined directly into a `.map()` rather than factored into even a local function.

All four render conceptually identical content (a fact label + its value) with different padding, different border strategy, and a label style that's uppercase in one file and plain in the next.

**Severity: notable** — strong candidate for a shared `ui.tsx` primitive (see §5).

### 3.5 Modal/dialog focus-trap logic is reimplemented four times

`Modal.tsx` and `ConfirmDialog.tsx` each independently implement the exact same `useEffect`: save `document.activeElement`, focus the panel, listen for `Escape`, lock `document.body.style.overflow`, and restore both on cleanup. `app/admin/OrderSlideOver.tsx` (lines 72–85) reimplements the identical effect a third time for its slide-over panel, and `components/Sidebar.tsx` (lines 47–59) reimplements a close cousin of it a fourth time for the mobile nav drawer (Escape + scroll-lock, though the drawer's own `inert` attribute stands in for the focus-trap part).

**Severity: moderate.** Low risk today because the four copies still agree, but there's no single place left to fix a bug in this behavior (e.g. the current implementations don't trap Tab within the panel, only Escape — if that's ever added, it needs adding four times).

### 3.6 Timing badges (delay, platform) are reimplemented, slightly smaller, outside `TrainTiming.tsx`

`components/TrainTiming.tsx` exports `DelayPill` and `PlatformBadge` specifically so every screen shows a train's live state identically. Two places don't call them:

- `app/admin/OrderSlideOver.tsx` (lines 142–151) draws its own delay badge (`rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800`, no `ring`) and platform badge (`rounded bg-ink px-1.5 py-0.5 text-[11px] font-bold text-white`) — close to `DelayPill`/`PlatformBadge` in concept and color, but smaller text (`text-[11px]` vs `text-xs`), tighter padding, and (for the delay badge) missing the `ring-1 ring-inset` and `rounded-full` shape the real `DelayPill` has.
- `app/admin/TrainGroups.tsx` (line 209, via `lateLabel()`) renders lateness as plain red text with no badge chrome at all — a third visual treatment of the same fact, on a screen one click away from the `OrderSlideOver` that renders it as a (slightly different) pill.

**Severity: moderate** — same information, three visual weights, on screens an admin moves between constantly.

### 3.7 `CoachChip` vs. two agent-page reimplementations — partly justified, partly drift

`ui.tsx`'s `CoachChip` already has an `lg` size (`rounded bg-ink px-2.5 py-1 text-lg`) for exactly the "coach code is the biggest thing on the card" case. Two agent pages build their own instead of using it:

- `app/agent/orders/[id]/page.tsx:40–42` — `rounded-lg bg-ink px-3 py-2 font-mono text-2xl font-bold …` (this is the order-detail hero, arguably justified as an even-bigger emphasis case than `CoachChip lg` covers — but if so, that should be a documented third size, not an unlabeled one-off).
- `app/agent/runs/[runKey]/page.tsx:97–99` — `rounded-lg bg-ink px-2 py-1.5 font-mono text-lg font-bold …` (this one is closer to `CoachChip lg` in weight, and doesn't have an obvious reason not to just be `CoachChip size="lg"`).

Neither uses `CoachChip`, and the two don't match each other either (`text-2xl` vs `text-lg`, `px-3 py-2` vs `px-2 py-1.5`, `rounded-lg` vs `CoachChip`'s plain `rounded`).

**Severity: cosmetic-to-moderate.**

### 3.8 The amber "remark" callout has three different structural treatments, not just a radius mismatch

`order.remark` (an admin-authored kitchen instruction) is displayed read-only on both the store and agent order-detail pages, and each surface wraps it differently:

- `app/store/orders/[id]/page.tsx:74–81` — wraps it in a `Card` + `CardHeader title="Remark from admin"`, with the amber block itself at `rounded-lg`.
- `app/agent/orders/[id]/page.tsx:58–63` — no `Card`/`CardHeader` at all; the amber block *is* the container, with its own inline eyebrow label ("Remark") at the top, and `rounded-xl`.
- `app/admin/orders/[id]/page.tsx` — a third shape again: a `Card` + `CardHeader title="Remark for the kitchen"` wrapping an editable `RemarkForm` (this one is legitimately different, since admin is the writer, not just a reader).

The store/agent cases are functionally identical (both read-only, both display the same field) but structurally different (`Card`+header vs. bare box) as well as differing in radius (`rounded-lg` vs `rounded-xl`) — and neither one is built from `ui.tsx`'s existing `Notice` component, which `tone="warn"` already renders as `bg-amber-50 text-amber-900 ring-amber-200` — visually the same tint, just not the same component. (`DeliveryProof.tsx` elsewhere in the app does use `Notice` correctly for its own analogous states.)

**Severity: cosmetic-to-moderate**, and a low-risk fix for the store/agent read-only pair specifically.

### 3.9 Three independent, disagreeing urgency-color scales

"How urgent is this" is colored three different ways, with two different minute thresholds, none sharing code:

- `UrgencyRail.band()` (`components/UrgencyRail.tsx:50–54`): ≤20 min → red fill, ≤45 → amber fill, else green fill (each paired with a specific text color chosen for contrast, per the file's own WCAG comment).
- `TimeUntil` (`components/TimeUntil.tsx:29`): `mins <= 20 ? 'text-red-600' : mins <= 45 ? 'text-amber-700' : 'text-muted'` — same 20/45 thresholds as `UrgencyRail`, but as plain text color rather than a filled badge — a second visual language for the identical signal.
- `ReadyByCountdown.describe()` (`components/ReadyByCountdown.tsx:13–15`): overdue → red badge, `mins <= 30` → amber badge, else neutral badge. The amber cutoff here (**30**) doesn't match the other two (**45**).

**Severity: moderate.** `UrgencyRail`'s own comment states its thresholds were tuned for WCAG contrast and kitchen legibility — sound reasoning that isn't shared with the other two places making the same kind of decision. It's plausible the 30-vs-45 split is intentional (a bulk order's "ready by" promise and a train's arrival are different kinds of deadlines), but nothing in the code says so either way.

### 3.10 Connection-status pill: three independent, near-identical components

`AutoRefresh.tsx`, `PaymentsLive.tsx`, and `OrderFeed.tsx` each render "is this screen's live feed connected" as the same `inline-flex h-7 items-center gap-1.5 px-1 text-xs font-medium text-muted` wrapper around a `size-1.5 rounded-full` dot — emerald + `motion-safe:animate-pulse` when live, amber when not — with only the label text and the connection-tracking logic (poll interval vs. SSE) differing. All three are clearly grown from a shared ancestor and still match closely, which is itself the argument for merging them: there is currently no reason for three copies to exist, and no way to fix one without checking whether the other two need the same fix.

**Severity: moderate.**

### 3.11 Icon-prefixed search input: two paddings, not three

The "magnifying glass inside the input" pattern (`absolute`-positioned `IconSearch`, padded input) is implemented with matching values in `app/admin/OrdersToolbar.tsx:110` and `components/PaymentsScreen.tsx:97` — both `size={15}`, `left-3`, input `pl-9`. The one outlier is `app/admin/setup/OutletMultiSelect.tsx:156` (inside `StaffFormModal`'s outlet picker), which uses `size={16}`, `left-2.5`, `pl-8` — 2px tighter on both axes.

**Severity: cosmetic.**

### 3.12 Input height has one undocumented outlier

The shared `inputBase`/`inputClass` fixes input height at `h-9` (36px) and it's used almost everywhere. Two surfaces deviate, one with a stated reason and one without:

- `app/agent/AgentActions.tsx:14` — a documented, reasoned local constant (`bigInput = ${inputClass} h-12 text-base`, *"every field here is filled in one-handed on a platform"*), consistently applied to every agent-form input, and matching `Button`'s own `lg` size (`h-12`). This is a legitimate, well-justified exception.
- `app/login/LoginForm.tsx:28,39` — `h-11` (44px) on both fields, with no comment. `h-11` matches neither the default (`h-9`) nor the `lg` token (`h-12`) — it's a third, unexplained value.

**Severity: cosmetic.**

### 3.13 Three different idioms for "toggle a boolean," one missing `aria-pressed`

- `components/GroupByTrainToggle.tsx` — an animated iOS-style switch (`role="switch"`, sliding thumb).
- `app/admin/setup/page.tsx:17–43` (`ActiveToggle`) — a colored status-pill button (green "Active" / grey "Inactive") that submits a form on click.
- `components/OrderComposer.tsx:81–94` (Retail/Bulk order-type picker) — a bespoke two-button toggle (`flex-1 rounded-lg border px-3 py-2 …`) that neither reuses `segmentedClass`/`segmentClass` (the component that exists for exactly this "choose one of two" shape, and which `DateFilter`'s own plain-mode buttons do use) nor sets `aria-pressed` on either button — unlike `DateFilter`'s buttons, which do (`DateFilter.tsx:153`).

**Severity: moderate** for the missing `aria-pressed` on `OrderComposer`'s toggle (a real, if minor, accessibility gap relative to the pattern's other instance in the same codebase); **cosmetic** for the three-idiom split otherwise, since a switch, a status-pill, and a segmented choice arguably are different *semantic* controls that happen to all "toggle" something.

### 3.14 `not-found.tsx` hand-rolls both `EmptyState` and a primary button, and drops the focus ring on the button

`src/app/not-found.tsx` (21 lines total) builds a card by hand:

```
<div className="w-full max-w-sm rounded-xl border border-dashed border-line-strong bg-surface p-8 text-center">
```

— nearly identical to `ui.tsx`'s `EmptyState` (`rounded-xl border border-dashed border-line-strong bg-surface p-10 text-center`), differing only in padding (`p-8` vs `p-10`) and the fact that it isn't `EmptyState` (this page renders outside any `AppShell`/layout, so pulling in the shared component is a matter of importing it, not a hard blocker).

Below that, its "Go to your board" link is styled by hand:

```
className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
```

— which is `buttonClass('primary', 'md', '')` reproduced by hand (same height, radius, color, padding) but **without** the `focusRing` classes `Button`/`ButtonLink` always include. It's the one primary-looking button in the app with no visible keyboard-focus state.

**Severity: notable** (the missing focus ring is a real accessibility regression; the fix for both issues is swapping in `EmptyState` + `ButtonLink`, which is close to a pure deletion of custom CSS).

### 3.15 A one-off filled-red button, achieved by overriding `Button`'s color via `className`

`app/agent/AgentActions.tsx:98` (`FailForm`'s "Mark failed" submit):

```
<Button type="submit" size="lg" pending={pending} className="flex-1 bg-red-600 hover:bg-red-700">
```

No `variant` is passed, so this starts from `variant="primary"` (`bg-accent text-white hover:bg-accent-hover`) and overrides the color via `className`. Neither existing variant is actually "filled solid red" — `danger` is an *outlined* red (`border-red-300 bg-surface text-red-700`), which reads as far lower-emphasis than what this screen needs for a rider confirming a failed delivery. The override happens to render correctly today, but it's relying on Tailwind's utility-class output order to make `bg-red-600`/`hover:bg-red-700` win over `bg-accent`/`hover:bg-accent-hover` rather than on the variant system, which is exactly the kind of class-string collision that's fragile to reorder.

**Severity: cosmetic-to-moderate.** The real gap this points at is that the button system has no filled-destructive variant, and this is the one place that need actually shows up.

### 3.16 Fetch-with-pending-and-error is duplicated three times

`app/store/orders/[id]/kot/PrintButton.tsx`, the inline `reprint()` in `app/store/StoreOrderActions.tsx:65–77`, and `ReprintRunKotButton.reprint()` in `app/store/StoreRunActions.tsx:25–37` all implement the same shape: local `pending`/`error` state, `try { fetch → parse json → throw on !ok } catch { setError } finally { setPending(false) }`, with near-identical fallback error strings (`` `Print failed (${res.status})` `` vs `` `Reprint failed (${res.status})` ``).

**Severity: cosmetic-to-moderate** — a `usePendingFetch`/`useFetchAction` hook would collapse this to one implementation and one tested error path.

### 3.17 Minor, isolated scale outliers

- `app/admin/analytics/page.tsx` — the SVG chart's legend swatch is `rounded-sm`, the only `rounded-sm` in the codebase (everything else is `rounded`, `rounded-lg`, `rounded-xl`, or `rounded-full`). Reasonable given the swatch is a 10px square; worth a deliberate note rather than a silent one-off, but not worth a new token.
- `components/TimeUntil.tsx:21` renders `&nbsp;` with no visible text during the pre-hydration "clock not mounted" window, while the structurally identical `components/ReadyByCountdown.tsx:27–33` renders a visible `"ready by …"` placeholder for the same window. Two components solving the same "clock not mounted yet" problem, one shows nothing and one shows a label.
- `admin/inbox/page.tsx:89` sets `rounded-t-xl` on its own status-tint card header — correct today (it matches the parent `Card`'s `rounded-xl`), but it's a hardcoded assumption about a corner radius that actually belongs to the `Card`/`CardHeader` components, not to the page using them.

**Severity: cosmetic**, all three.

## 4. Duplicated patterns — summary index

| Pattern | Occurrences | Files | Detail | Severity |
|---|---|---|---|---|
| Duration formatting (`Xh Ym`) | 10 | 9 files (§3.3) | §3.3 | Notable |
| IST wall-clock formatting | 5 inline reimplementations of `formatTimeIST` | §3.3 | §3.3 | Notable |
| Inline-edit cell (two competing idioms) | 1 file stuck on the old idiom | `PaymentsTable.tsx` vs. `AdminOrdersTable.tsx`/`ui.tsx` | §3.1 | Notable |
| "Label / value" detail row | 4 independent implementations | `OrderSlideOver`, `admin/orders/[id]`, `TrainLookupForm`, `admin/enquiries/[id]` | §3.4 | Notable |
| Dialog focus-trap/Escape/scroll-lock | 4 independent implementations | `Modal`, `ConfirmDialog`, `OrderSlideOver`, `Sidebar` | §3.5 | Moderate |
| Delay/platform badge | 3 visual treatments of one fact | `TrainTiming`, `OrderSlideOver`, `TrainGroups` | §3.6 | Moderate |
| Large coach chip | 3 sizes outside `CoachChip`'s own `lg` | `CoachChip`, 2 agent pages | §3.7 | Cosmetic–moderate |
| Amber remark callout | 3 structural treatments | `store/orders/[id]`, `agent/orders/[id]`, `Notice` (unused here) | §3.8 | Cosmetic–moderate |
| Urgency color scale | 3 independent scales, 2 disagreeing thresholds | `UrgencyRail`, `TimeUntil`, `ReadyByCountdown` | §3.9 | Moderate |
| Connection-status pill | 3 near-identical components | `AutoRefresh`, `PaymentsLive`, `OrderFeed` | §3.10 | Moderate |
| Icon-prefixed search input | 2 vs. 1 padding | `OrdersToolbar`+`PaymentsScreen` vs. `OutletMultiSelect` | §3.11 | Cosmetic |
| "Toggle a boolean" idiom | 3 idioms, 1 missing `aria-pressed` | `GroupByTrainToggle`, `ActiveToggle`, `OrderComposer` | §3.13 | Moderate/Cosmetic |
| Fetch-with-pending-and-error | 3 implementations | `PrintButton`, `StoreOrderActions`, `StoreRunActions` | §3.16 | Cosmetic–moderate |
| `EditOrderItem`/`AddOrderItem` forms | 2 near-identical forms, not shared | `AdminOrderActions.tsx:177–284` | — | Cosmetic |
| `EmptyState` reimplemented | 1 hand-rolled copy | `not-found.tsx` | §3.14 | Notable (a11y) |

## 5. What is *not* a problem (deliberate exceptions, correctly scoped)

- **`KotTicket.tsx`** is monospace, pure black/white, print-sized, and ignores every app color/spacing token. Correct and documented — it renders on 80mm thermal paper, which reproduces neither color nor the app's fonts.
- **`/internal/print/*`** has no `AppShell`/nav — correct, these are headless screenshot targets for the print pipeline, not screens anyone navigates to.
- **`admin/analytics/page.tsx`'s hand-drawn SVG bar chart** deliberately avoids a charting library, with documented reasoning (fixed bar width needed for cross-day comparability in a two-series, thirty-bar chart). It's the only chart in the app; not a candidate for a shared primitive.
- **Single light theme, no dark mode** — documented and deliberate (daylight kitchen/platform legibility, thermal-print legibility). Not an inconsistency; there's nothing to reconcile it against.
- **`AgentActions.tsx`'s `h-12` inputs** — a reasoned, consistently-applied exception to the standard input height (§3.12), not drift.
- **No toast system** — feedback is inline (`FormNote`/`Notice`) everywhere, consistently. Absence, not a gap.

## 6. Recommended component architecture

Ranked by how much duplication each removes (§ references included):

1. **`formatDuration(minutes, { suffix? })` in `lib/format.ts`** — replaces the ten independent "`Xh Ym`" formatters (§3.3). Highest-value, lowest-risk fix in this audit: a pure function, no visual change, ten call sites collapse to one.
2. **Fold the stray inline `toLocaleTimeString`/`toLocaleString` calls onto `formatTimeIST`/a new `formatDateTimeIST`** (§3.3) — five call sites, same shape as #1.
3. **`DetailRow` (or `DefinitionRow`) in `ui.tsx`** — label left, value right, optional `mono`/`tone` props — replacing the four independent `Row()` implementations in §3.4.
4. **`useDialogBehavior()` hook** (focus-save/restore, Escape, scroll-lock) — consumed by `Modal`, `ConfirmDialog`, `OrderSlideOver`, and `Sidebar`'s drawer (§3.5), collapsing four copies of the same `useEffect` to one.
5. **`LiveIndicator` component** — absorbs `AutoRefresh`, `PaymentsLive`, and `OrderFeed`'s identical status-dot markup (§3.10); each keeps its own polling/SSE logic and passes in `status`/`label`.
6. **`urgencyTone(minutes, thresholds?)` helper** — one function backing `UrgencyRail.band()`, `TimeUntil`'s tone logic, and `ReadyByCountdown.describe()` (§3.9), with thresholds as an explicit, named source of truth (or explicitly parameterized per call site, if 30-vs-45 turns out to be intentional).
7. **`usePendingFetch()` hook** — collapses the three reprint/print client components (§3.16) into one implementation.
8. **`SearchInput` component** wrapping `IconSearch` + `inputClass` with one canonical padding (§3.11).
9. **Add a filled-destructive `Button` variant** (e.g. `variant="solid-danger"` or repurpose `danger` to be filled and give the current outlined style a new name) so `AgentActions.tsx`'s "Mark failed" (§3.15) doesn't need a class-string override.
10. Wire `Notice tone="warn"` into the store/agent read-only remark displays (§3.8) — no new component, just use the one that exists.
11. Extend `CoachChip` with whatever size the agent order-detail page actually needs, or confirm `lg` already covers it, instead of a third bespoke size (§3.7).
12. Route `OrderSlideOver` and `TrainGroups` through the existing `DelayPill`/`PlatformBadge` (§3.6) rather than reimplementing them at a slightly different scale.

None of these require a new dependency or a new visual language — every one is "stop duplicating something `ui.tsx`/`lib/format.ts` already has, or almost has."

## 7. Recommended design tokens

The token set itself (`globals.css`'s `@theme` block) is not the problem — it's small, well-named, and consistently consumed. The gaps are in **duration/urgency semantics** and one missing **button variant**, not color/spacing/radius:

- Add a single duration-formatting convention (a function, not a token) — see §6.1.
- Either document the 20/45-minute vs. 30-minute urgency split (§3.9) as intentional — a bulk order's "ready by" promise and a train's arrival are arguably different kinds of deadlines and *should* have different thresholds — or unify them. Nothing currently states which is true.
- Pick one input height for "thumb/high-emphasis" forms: either adopt `h-12` (matching `Button`'s `lg` and `AgentActions`' already-reasoned choice) for any future full-width, one-handed-entry form, or drop `LoginForm`'s unexplained `h-11` back to the standard `h-9` (§3.12).
- Add a filled-destructive button variant (§3.15) — the one real gap in the `VARIANT` map surfaced by this audit.
- No new color, radius, or shadow tokens are needed. §3.17's `rounded-sm` legend swatch is the only radius outlier, and it reads as a reasonable exception for a 10px chip rather than a token gap. The shadow scale (`shadow-sm` cards → `shadow-lg` popovers → `shadow-xl` modals → `shadow-2xl` full-height drawers) is already a coherent, if implicit, elevation hierarchy — worth naming explicitly as a comment in `ui.tsx` so it stays intentional, but not worth new tokens.

## 8. What's already working well (preserve these when refactoring)

- **`ui.tsx` is a real style guide, not just a components file** — every export explains *why*, not just *what*. Any new primitive added per §6 should hold that same bar.
- **Loading/error states are structurally uniform**, not just visually similar — every route section has its own `loading.tsx`/`error.tsx` delegating to `PageSkeleton`/`ErrorState`, so no page can silently ship without one.
- **Contrast is measured, not assumed** — both `globals.css`'s ink/muted/faint triad and `UrgencyRail`'s color bands cite actual WCAG ratios against actual surface colors, including a documented regression (white-on-amber-500 at 2.13:1) that was caught and fixed before shipping.
- **`PaymentsScreen` is the right pattern for a screen two roles share** — one component, a `privileged` prop, instead of two near-duplicate pages. It's the template for any future admin/store shared screen, and a useful reference when consolidating the duplicates in §3–4.
- **The inline-edit idiom, once `PaymentsTable` catches up (§3.1), is genuinely well thought through** — dropping separate save/cancel controls is justified by a real constraint (table-cell width), not simplification for its own sake.
- **Color tokens have had zero drift** — a full-codebase grep found only Tailwind's `slate-` gray family in use, never `gray-`/`zinc-`/`neutral-`/`stone-` mixed in.
- **The store isolation and status-transition rules are enforced by tooling, not convention** — a custom ESLint rule fails the build on direct `Order` model access outside the scoped repository, which is the kind of discipline a UI audit doesn't usually get to point at approvingly.

## 9. Recommended refactoring order

Ordered for maximum risk-adjusted value — cheap, safe, high-duplication fixes first; anything touching interaction behavior or adding new UI last.

1. **`formatDuration` extraction (§3.3, §6.1–2).** Pure function, zero visual risk, removes the single largest duplication in the app. Do this first.
2. **Wire `Notice tone="warn"` into the store/agent remark displays (§3.8)** and **route `not-found.tsx` through `EmptyState`/`ButtonLink` (§3.14)** — both are drop-in, near-zero-risk, and the second is an accessibility fix.
3. **Finish the two in-flight migrations already half-done**, since leaving them half-done is worse than either endpoint:
   - Bring `PaymentsTable`'s `RemarkEditor` onto the auto-commit idiom (§3.1) now, while the rest of the app's inline-edit pattern is already fresh.
   - Decide whether outlets get an edit flow (§3.2) — either wire `OutletFormModal` up to `values`/`editId` the same way `StaffFormModal` already is, or explicitly confirm outlets are meant to be create-only-plus-deactivate for now, and say so in a comment the way the rest of this codebase does.
4. **`LiveIndicator` and `SearchInput` extractions (§3.10–11)** — mechanical, low-risk, three- and two-call-site respectively.
5. **`DetailRow` extraction (§3.4)** — four call sites, no behavior to preserve, just markup consolidation; a good next step once the "cheap and safe" fixes are done.
6. **`usePendingFetch` hook (§3.16)** — touches three client components' control flow, but is behavior-preserving.
7. **Add the filled-destructive `Button` variant and swap it into `AgentActions.tsx` (§3.15)** — small, but touches a production action button on the agent surface, so worth a quick check on a phone-sized viewport.
8. **Route `OrderSlideOver`/`TrainGroups` through `DelayPill`/`PlatformBadge`, and reconcile the two agent-page `CoachChip` reimplementations (§3.6–7)** — visual changes, however small, so worth a screenshot diff on the admin board and both agent pages before merging.
9. **`useDialogBehavior()` extraction (§3.5)** — behavior-sensitive (focus trap, scroll lock) across four components including the primary nav drawer; do this once the smaller wins are banked and there's room to test each surface individually.
10. **`urgencyTone` unification (§3.9, §7)** — last among the extractions, because it requires an actual product decision (are the 30- and 45-minute thresholds intentionally different?) before it can be safely collapsed into one function.
11. **Cosmetic cleanup pass (§3.11 padding, §3.12 input height, §3.13 toggle idioms/`aria-pressed`, §3.17 scale outliers)** — low individual value; batch into one pass rather than context-switching for each.
