# Lovable build prompt — Orbit Ledger (financial payment tracker)

Paste everything between the rulers into Lovable as the first message. Then paste
`docs/FINANCIAL_API.md` as a **second** message so it has the exact endpoint
contract.

Before you send it, replace `https://YOUR-ORBIT-HOST` with your real Railway URL.

---

Build a financial receivables tracker called **Orbit Ledger**. It is a companion
app to an existing media-buying system called **Ogilvy Orbit**, and it must look
like it was built by the same team on the same day — same design language, same
component vocabulary — while having its own clear identity as a finance tool.

React + Vite + Tailwind + Recharts. No component library defaults left visible:
override shadcn/Tailwind styling with the exact tokens below.

## 1. Design tokens — use these exact values, do not invent alternatives

```css
:root {
  /* Navy — sidebar, headings, dark surfaces */
  --navy-950:#0A1729; --navy-900:#0F1F3D; --navy-850:#14274A; --navy-800:#1B3257;
  --navy-700:#274069; --navy-600:#38527E; --navy-400:#6B82A6; --navy-300:#9FB0C9;

  /* Coral — the single accent. Primary buttons, active nav, focus rings */
  --coral-700:#C44A18; --coral-600:#D9521C; --coral-500:#E85D24;
  --coral-400:#F07A47; --coral-100:#FCE7DD; --coral-50:#FDF1EB;

  /* Surfaces */
  --bg:#F5F6F8; --bg-sunken:#EEF0F3; --card:#FFFFFF;
  --border:#E5E8ED; --border-strong:#D5DAE2;

  /* Text */
  --ink:#16243C; --ink-soft:#3B4A63; --muted:#6B7790; --muted-2:#93A0B5;

  /* Status */
  --green-600:#15814B; --green-100:#DCF3E5; --green-50:#ECF8F1;
  --amber-700:#9A5B00; --amber-100:#FBEBCB; --amber-50:#FCF4E2;
  --blue-700:#1F5BB5;  --blue-100:#DCE8FB;  --blue-50:#EDF3FD;
  --purple-700:#6B3FB5; --purple-100:#E8DEF8;
  --red-600:#C5391F;   --red-100:#FBE0DA;

  --r-sm:6px; --r-md:9px; --r-lg:14px; --r-xl:20px;

  --sh-xs:0 1px 2px rgba(15,31,61,.06);
  --sh-sm:0 1px 3px rgba(15,31,61,.08), 0 1px 2px rgba(15,31,61,.04);
  --sh-md:0 4px 16px rgba(15,31,61,.10), 0 1px 4px rgba(15,31,61,.06);
  --sh-lg:0 16px 44px rgba(15,31,61,.18), 0 4px 14px rgba(15,31,61,.10);

  --sidebar-w:244px; --topbar-h:64px;

  --font:"Hanken Grotesk", -apple-system, BlinkMacSystemFont, sans-serif;
  --mono:"Spline Sans Mono", ui-monospace, "SF Mono", Menlo, monospace;
}
```

Load **Hanken Grotesk** (400/500/600/700/800) and **Spline Sans Mono** (400/600)
from Google Fonts. Every number — money, counts, dates, percentages, day counts —
renders in the mono font with `font-variant-numeric: tabular-nums` so columns
line up. Body text is Hanken Grotesk. Never use the default system font.

Page background `--bg`, cards `--card` with `1px solid --border`, radius
`--r-lg`, shadow `--sh-xs`. Light theme only.

## 2. What makes this app its own thing

Same skeleton as Orbit, but the finance identity comes from **one idea: money
ageing**. Carry it everywhere.

* Brand mark: a 34×34 rounded square, radius 9px, `--coral-500` background,
  white bold glyph, `box-shadow: 0 4px 12px rgba(232,93,36,.4)`. Wordmark
  **"Orbit Ledger"** with the sub-label "Receivables" beneath it in
  `--navy-300`, 11px.
* The **ageing spectrum** is the signature visual. Every status appears in the
  same fixed order and the same colour, everywhere in the app — chips, chart
  series, table rows, legends, the funnel. Learn it once, read it anywhere:

| Status (API value) | Label | Text/dot | Background |
|---|---|---|---|
| `not_yet_invoiced` | Not invoiced | `--muted` `#6B7790` | `--bg-sunken` |
| `pending_0_30` | 0–30 days | `--blue-700` | `--blue-50` |
| `pending_31_60` | 31–60 days | `--amber-700` | `--amber-50` |
| `pending_61_90` | 61–90 days | `#B45309` | `#FEF3C7` |
| `overdue_90_plus` | 90+ overdue | `--red-600` | `--red-100` |
| `paid` | Paid | `--green-600` | `--green-50` |

* An **"ageing rail"** component: a thin 6px full-width stacked bar, segments in
  the order above, no gaps, rounded ends only. Put it under the KPI row on the
  dashboard and at the top of every client and agency drill-down. It is the
  app's fingerprint — one glance tells you the health of a book.
* Overdue rows get a 3px left border in `--red-600` on the table row. Nothing
  blinks, nothing is red-on-red. Restraint is the point.

## 3. App shell

* CSS grid `244px 1fr`, `height:100vh; overflow:hidden` — only the content area
  scrolls, never the window.
* **Sidebar**: `linear-gradient(178deg, #0F1F3D 0%, #0A1729 100%)`, brand block
  at top (20px 20px 18px padding). Nav items: 13.5px, weight 500, colour
  `--navy-300`, padding 8.5px 10px, radius 8px, 11px gap to a 18px stroke icon.
  Hover `rgba(255,255,255,.055)`. **Active: white text on `--coral-500`**, plus a
  3px white bar on the left edge. Section labels above groups: 10.5px, weight
  700, uppercase, letter-spacing .9px, `--navy-400`.
* Nav: **Dashboard · Receivables · Ageing · Collections · Clients · Agencies ·
  Reports**.
* **Topbar**: 64px, `rgba(255,255,255,.86)` + `backdrop-filter: blur(10px)`,
  1px bottom border, `position:relative; z-index:30`. Left: page breadcrumb.
  Right: a global date-range picker, a refresh button, then the user block —
  avatar circle (coral, white initials), name at 13px weight 650, and the role
  underneath as a small pill: Control Room = purple, Boardroom = blue,
  Hub = green. Show the label, never the raw role string.
* Page header inside content: title 23px weight 750 letter-spacing -.5px, a
  13.5px `--muted` subtitle under it, actions right-aligned on the same row,
  22px margin below.
* Below 860px the sidebar becomes an off-canvas drawer behind a hamburger, with
  a scrim that closes it; below 560px the KPI grid drops to 2-up.

## 4. Component specs

**Buttons** — inline-flex, radius 9px, 13px, weight 600, padding 9px 15px, 7px
icon gap.
`primary`: `--coral-500` bg, white, `0 1px 2px rgba(232,93,36,.4)`; hover
`--coral-600`; active `--coral-700`.
`ghost`: white bg, `--ink-soft`, `--border-strong` border, `--sh-xs`.
`navy`: `--navy-900` bg, white. `subtle`: transparent, `--muted`.
`sm` = padding 6px 11px / 12.5px / radius 8px.

**KPI stat card** — white, radius 14px, padding 20px 22px. Top row: a 38×38
radius-11 tinted icon tile + a 12.5px weight-600 `--muted` label. Value at 33px,
weight 760, letter-spacing -1px, tabular nums. Under it a 12px meta line with a
trend chip: ▲ green / ▼ red / → muted, weight 700.

**Table** — wrapper: white, radius 14px, `overflow:hidden`, `--sh-xs`, and
`overflow-x:auto` so wide tables scroll inside the card and the page never does.
`thead th`: 11px, weight 700, uppercase, letter-spacing .5px, `--muted`, bg
`--bg`, padding 12px 18px, sticky top, 1px bottom border.
`tbody td`: padding 14px 18px, 13px, `--ink-soft`, 1px bottom border; last row no
border; row hover `--bg`. Numbers right-aligned, mono, tabular. Footer/total row:
bg `--bg`, weight 700, `--ink`, 2px top border `--border-strong`.

**Status chip** — inline-flex, 11.5px, weight 650, padding 3px 9px, radius 7px,
with a 6px dot in the text colour, using the ageing table above.

**Inputs** — full width, 1px `--border-strong`, radius 9px, padding 10px 13px,
13.5px. Focus: border `--coral-400` + `0 0 0 3px --coral-50`. Labels above at
12.5px weight 650 `--ink-soft`. Multi-select filters are toggle **chips**:
unselected = light outline pill, selected = filled `--coral-500` pill with a
check.

**Loading** — a branded loader, never a spinner or the word "Loading": a small
coral dot orbiting a navy core, used for every loading state. Tables use grey
skeleton rows.

**Empty states** — a muted icon, one sentence of what's missing, and an action
where one exists. Never an empty card, never a zero pretending to be data.

## 5. Screens

### Dashboard
KPI row (4): **Total Outstanding**, **Overdue 90+**, **Collected (last 30 days)**,
**Not yet invoiced**. Each with a trend chip vs the previous period.
Then the **ageing rail**. Then:
* **Ageing profile** — horizontal stacked bar, one row per bucket, value + count
  + % of total, biggest first. Click a bucket → Receivables filtered to it.
* **Collections trend** — 12-month bar chart of `monthlyCollected`, coral bars,
  with a 3-month rolling-average line overlaid in `--navy-600`.
* **Outstanding by agency** — vertical bars, value labels on top.
* **Top 10 clients by outstanding** — ranked list rows: rank, client, agency
  underneath in 11.5px muted, value right-aligned mono, and a %-of-max mini bar
  behind the row. Click → client drill-down.
* **Worst offenders** — a compact table of the 5 oldest unpaid records: client,
  RO, days outstanding, value. Days in red mono, weight 700.

### Receivables (the main working screen)
Full-width table over `GET /schedules`, server-paginated.

Default columns: Status chip · Client · Agency · **Invoice No.** · Channel ·
Medium tag · Schedule Month · **Invoice Value (with VAT)** · Invoice Sent ·
Payment Received · Days Outstanding.

Additional columns available behind a **"Columns" menu** (checkbox list,
selection persisted to localStorage), off by default: RO Number, Station Invoice
No., Invoice Month, Schedule Value, Schedule Value with VAT, Invoice Value
(ex-VAT), Agency Invoice Date, Station Invoice Received Date, Media Group,
Group, Discipline, AOR %, CAG %, CAG Agency, CAG Amount, AOR Revenue. Each record
also carries a `sheet` object with every remaining spreadsheet column keyed by
its original header — offer those at the bottom of the Columns menu too.

Lead with **invoice number and invoice value including VAT**: chasing a payment
means quoting an invoice number and an amount owed, so those are the working
columns. Schedule value is what the API aggregates on, so show it in totals and
charts, but it is not what you read to a client on the phone.

* Filter bar above: agency, client, channel, medium, media group, schedule month
  range, **invoice number search**, and status as multi-select chips in ageing
  order. A "Clear all" link. Reflect every filter in the URL query string so a
  filtered view is shareable.
* Sort by clicking a header (map to `sortBy`/`sortDir`).
* A sticky totals footer showing filtered count + `totalValue` — the API returns
  these for the whole filter, not just the page, so never sum the page client-side.
* **Record payment**: a "Mark paid" button on each unpaid row opens a small
  modal — a date input defaulting to today, an optional note, Save. Optimistic
  update, revert with a toast on failure. On success the row's status chip
  re-renders from the record the API returns; do not recompute status locally.
* Bulk select via checkboxes → "Mark N as paid on [date]", fired as sequential
  PATCH calls with a progress count.
* Medium renders as Orbit's tag: 11px, weight 700, padding 2px 6px, radius 3px —
  TV `#dbeafe`/`#1e3a5f`, RADIO `#fff5f0`/`#E85D24`, PRINT `#ecfdf5`/`#059669`,
  DIGITAL `#efe9fb`/`#6B3FB5`, CINEMA `#fce7f0`/`#C2185B`, OOH `#e0f4f8`/`#0E7490`.

### Ageing
A pivot table: rows = client (expandable to its records), columns = the five
unpaid buckets + total, cells = value with a heat tint that deepens with age.
Toggle rows between client / agency / channel. Column totals in the footer.

### Collections
Month-by-month collected vs outstanding-at-start, a cumulative area chart, and a
**DSO** card (see extras). Table of everything paid in the selected range with
"days taken to pay" per record and an average.

### Client / Agency drill-down
Header with the entity name, its ageing rail, and four KPIs. Then its records
table and a 12-month collection history chart.

### Reports
Build-your-own export: pick a dataset (receivables / ageing / collections),
apply filters, preview the first 20 rows, then export.

## 6. Charts — Recharts, matching Orbit exactly

Every chart lives in a card with a 15px weight-700 `--ink` title and an optional
12px `--muted` subtitle, and is wrapped in `<ResponsiveContainer width="100%"
height={300}>`.

```jsx
<CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
<XAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false}
       axisLine={{ stroke: 'var(--border)' }} />
<YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false}
       axisLine={false} tickFormatter={fmtShort} />
<Tooltip contentStyle={{ background:'var(--card)', border:'1px solid var(--border)',
         borderRadius:8, fontSize:12 }} labelStyle={{ fontWeight:700 }} />
```

Bars radius `[6,6,0,0]`. Value labels on bars at 10.5px weight 700 `--ink`, and
only when the value is non-zero. Donuts: `innerRadius="62%"`, total in the centre.
Lines: `strokeWidth={2}`, `dot={false}`, active dot r=4. No 3D, no gradients
under lines, no drop shadows on chart elements, no chartjunk. Series colours come
from the ageing table — never a random palette.

## 7. Formatting rules — non-negotiable

```js
// abbreviated, for chart axes, KPI cards and dense table cells
const fmtLKR = (v) => {
  if (v == null || v === '') return '—';
  const n = Number(v), a = Math.abs(n);
  if (a >= 1e9) return 'LKR ' + (n/1e9).toFixed(2) + 'B';
  if (a >= 1e6) return 'LKR ' + (n/1e6).toFixed(2) + 'M';
  if (a >= 1e3) return 'LKR ' + (n/1e3).toFixed(1) + 'K';
  return 'LKR ' + Math.round(n).toLocaleString('en-US');
};
// full precision, for exports and any editable/verifiable figure
const fmtFull = (v) => 'LKR ' + Number(v).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
```

* Dates display as `15 Jul 2026`; they go to and come from the API strictly as
  `YYYY-MM-DD`. Months display as `Jul 2026` from `2026-07`.
* Percentages: one decimal. Day counts: whole numbers, mono, with "d" suffix.
* Negatives in red with a leading minus, never parentheses on screen.
* `null` renders as `—`, never as `0`, `null` or blank.

## 8. Exports — every table and every report

Two buttons wherever data is shown: **Excel** and **PDF**. Client-side, no
backend call.

**Excel** — SheetJS (`xlsx`). One workbook, a sheet per logical grouping
(Summary / Records / By Client / By Agency / Ageing). Row 1 is the report title,
row 2 the applied filters as text, row 3 the generated timestamp, then a blank
row, then the header row, then data. **Money exports as a real number, not a
formatted string**, so it stays summable in Excel; format the column with
`z: '#,##0.00'`. Set sensible column widths. Include a totals row. Filename
`orbit-ledger-<dataset>-<YYYY-MM-DD>.xlsx`.

**PDF** — `jspdf` + `jspdf-autotable`, called as `autoTable(pdf, {...})` (the
function form, not `pdf.autoTable()`). A branded header band in `--navy-900`
with "Orbit Ledger" in white and the report name, the filter line and generated
date in `--muted` beneath it, then the table: head fill `#0F1F3D`, white bold
text, alternating row fill `#F5F6F8`, 8.5pt body, money right-aligned. Status
cells tinted with the ageing colours. Landscape for anything wider than 6
columns. Page numbers bottom-right, "Generated by Orbit Ledger" bottom-left.
Charts captured with `html2canvas` and placed preserving aspect ratio, centred,
capped at 65% page width for donuts.

## 9. Extra features worth building

1. **DSO (Days Sales Outstanding)** — average days from invoice sent to payment
   received over the selected range, as a KPI with a sparkline of the last 12
   months. The single number a finance lead will look at first.
2. **Collection forecast** — for each unpaid record, project a likely payment
   date from that client's historical average days-to-pay, and roll it into a
   "expected collections next 30/60/90 days" card. Label it clearly as a
   projection.
3. **Client payment behaviour score** — per client: average days to pay, on-time
   rate, current exposure. Sort the client list by it. A/B/C badge.
4. **Saved views** — persist a named filter set to localStorage and list them in
   the sidebar under Receivables.
5. **Ageing snapshot comparison** — compare the current ageing profile against
   the same view 30 days ago, showing which buckets grew.
6. **Follow-up tracker** — a local note + "last chased" date per record (store in
   the `note` field the PATCH endpoint accepts), with a "needs chasing" filter
   for anything 30+ days unpaid and not chased in 14 days.
7. **Keyboard-first table** — `/` focuses filters, `j`/`k` move rows, `p` opens
   mark-paid on the focused row, `Esc` closes. Show a `?` shortcut sheet.
8. **Concentration warning** — if one client is more than 25% of total
   outstanding, surface an amber callout on the dashboard.

Build 1–4 first; 5–8 only after the core screens are solid.

## 10. API

Base URL `https://YOUR-ORBIT-HOST/api/financial`. I will paste the full endpoint
contract as my next message — build against that document, and do not invent
endpoints, query params or response fields that aren't in it.

Auth flow:
* `POST /auth/login` with `{ username, password }` → `{ token, role, name }`.
  Store the token in localStorage.
* Send `Authorization: Bearer <token>` on every other request.
* On any `401`, clear the token and return to the login screen with "Your
  session expired, please sign in again."
* `403` on login means the account has no access to this app — show that message
  plainly, don't retry.
* Roles are `control_room`, `boardroom`, `hub`. Display them as **Control Room**,
  **Boardroom**, **Hub**. `hub` and `boardroom` may see a narrower set of records
  than `control_room`; that is expected and needs no special UI beyond showing
  the role in the topbar.

Login screen: centred glass card on a deep navy `#0A1729` background with a
subtle static starfield, the Orbit Ledger mark above the form, email + password,
one primary button. No "sign up", no social login, no password reset link — the
accounts are managed in Orbit.

## 11. Rules

* Never fabricate, stub, or placeholder data. If an endpoint returns nothing,
  render the empty state.
* Status is computed by the API. Display `record.status` as given; never derive
  it in the browser.
* Several per-record fields come from the uploaded spreadsheet and may be `null`
  on any given row (`invoiceNumber`, `invoiceValue`, `group`, ...). Render `—`.
  Never hide a row, show `0`, or fall back to a different column because one of
  them is missing.
* All money is LKR. No currency selector, no conversion.
* Totals come from the API's filtered totals, not from summing the visible page.
* Every table scrolls inside its own card; the page body never scrolls
  horizontally.
* Accessible: every colour pairing above meets 4.5:1, status is never signalled
  by colour alone (always colour + label), all controls reachable by keyboard.

---
