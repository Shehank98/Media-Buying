# Dashboards & Charts Guide

A quick reference for every analytics page, what each card/chart shows, and where the
data comes from — so you can add more charts the same way.

## How a chart works here (the pattern)

Every chart follows the same flow:

1. **Page calls an API endpoint** with `api.get('/analytics/...')` (axios, auto-attaches the token).
2. The response is saved into React state with `setX(...)`.
3. The state array is passed straight into a **Recharts** component as its `data` prop.
4. Numbers are formatted with small helpers (`fmtLKR`, `fmtShort`, `fmtMonth`).

```jsx
const [trend, setTrend] = useState([]);
useEffect(() => {
  api.get('/analytics/dashboard/monthly-trend', { params: { year } })
     .then(({ data }) => setTrend(data.combined));
}, [year]);

<ResponsiveContainer width="100%" height={240}>
  <LineChart data={trend}>
    <XAxis dataKey="month" /><YAxis tickFormatter={fmtShort} />
    <Tooltip /><Line dataKey="scheduleValue" stroke="#E85D24" />
  </LineChart>
</ResponsiveContainer>
```

To add a new chart you only need: (a) an endpoint that returns an array, and
(b) a Recharts block that reads it. Most spend data comes from **`ScheduleLog`**
rows (agency, client, channelMaster, scheduleMonth, scheduleValue, medium, mediaGroup).

Backend analytics live in `api/src/controllers/analytics.controller.js` and
`api/src/controllers/database.controller.js`. Charts use the `recharts` library.

> **Date anchoring:** dashboard "this month / YTD / YoY" auto-anchors to the **latest
> month that has data** (so historical-only imports still populate), unless a `?year=`
> is passed. Helper: `refPeriod(where, year)`.

---

## 1. Home Dashboard — `/` (`DashboardPage.jsx`)

Landing page. Exec roles (SUPER_ADMIN / MANAGER) see the full version; others see a compact quick-links view.

| Element | What it shows | Source endpoint | Field used |
|---|---|---|---|
| **Year buttons** (All / 2024 / 2023…) | Filters the whole page by year | list from `…/summary` | `availableYears`; selecting passes `?year=` |
| **Total Media Spend** card | Sum of schedule value for the period | `/analytics/dashboard/summary` | `billingsYTD` (+ `yoyGrowthPct` chip) |
| **Active Clients** card | Distinct clients billing in period | same | `activeClients` |
| **Channels Tracked** card | Distinct channels in latest month | same | `activeChannelsThisMonth` |
| **Schedule Logs** card | Log count in latest month | same | `logsThisMonth`, `uploadsThisMonth` |
| **Monthly Spend Trend** (Area chart) | Last 12 months of spend | `/analytics/dashboard/monthly-trend` | `combined[].scheduleValue` |
| **Medium Split** (donut) | TV/Radio/Print share | `/analytics/dashboard/medium-split` | `ytd[]` (`medium`, `value`, `pct`) |
| **Top Clients by Spend** (table) | Top 6 clients + MoM trend | `/analytics/dashboard/top-clients` | `ytdBilling`, `momTrend` |
| **Recent Activity** (feed) | Latest upload batches | `/analytics/dashboard/recent-uploads` | `uploadedBy`, `fileName`, rows |
| **Spend by Agency** (horizontal bars) | YTD spend per agency | `/analytics/dashboard/agency-comparison` | `ytdBillings` |
| **Top Channels** (ranked bars) | Top 6 channels by spend | `/analytics/dashboard/top-channels` | `ytdSpend` (bar = share of #1) |
| **Loading** | Animated orbit | — | `OrbitLoader` component |

---

## 2. Executive Dashboard — `/executive-dashboard` (`ExecutiveDashboardPage.jsx`)

Deeper exec overview. Agency filter in the hero. "Export summary" builds a branded PDF (jsPDF + autoTable).

| Chart / block | What it shows | Source | Notes |
|---|---|---|---|
| **KPI cards** | Billings this month, YTD, YoY, active clients, logs, channels, uploads, manual entries | `/analytics/dashboard/summary` | built from the `kpis` array |
| **Monthly Billing Trend** | 24-month trend, toggle **Combined** (AreaChart) vs **By Agency** (multi-line) | `/analytics/dashboard/monthly-trend` | `combined[]` / `byAgency[]` |
| **Top 10 Clients** (ranked bars) | YTD + this-month (MO) value + MoM chip | `/analytics/dashboard/top-clients` | `ytdBilling`, `currentMonthBilling`, `momTrend` |
| **Top 10 Channels** (ranked bars) | YTD + MO value + YoY chip, colored by medium | `/analytics/dashboard/top-channels` | `ytdSpend`, `currentMonthSpend`, `yoyChange` |
| **Agency Comparison** (grouped bars + cards) | Monthly billings per agency (12 mo) + YTD summary | `/analytics/dashboard/agency-comparison` | `monthly[]`, `ytdBillings`, `ytdGrowthPct` |
| **Medium Split** (two donuts) | This month + YTD, with per-medium YoY chip | `/analytics/dashboard/medium-split` | `currentMonth[]`, `ytd[]`, `lastYearYtd[]` |
| **Activity Log** (table) | Recent schedule-log activity (paginated) | `/analytics/dashboard/activity-log` | SUPER_ADMIN only |
| **Recent Uploads** (list) | Batch file, status, rows | `/analytics/dashboard/recent-uploads` | — |

---

## 3. Deep Dashboard — `/deep-dashboard` (`DeepDashboardPage.jsx`)

Sponsorship/property investment analysis. **All data from one call:** `/analytics/deep-dashboard?agencyId&clientId&channelMasterId`.
Spend comes from schedule logs; property terms from the `Property` table.

| Chart / block | What it shows | Field in response |
|---|---|---|
| **KPI cards** | Total spend, latest-year spend, previous-year spend, YoY growth | `kpis` |
| **Multi-Year Monthly Spend Trend** (LineChart, one line/year + zoom Brush) | Monthly spend compared across years | `monthlyTrend[]`, `trendYears[]` (PNG/PDF export via html2canvas) |
| **Client Investment Contribution** (horizontal bars) | Spend distribution across clients | `clientDistribution[]` |
| **Channel Performance Insights** (tiles) | Total properties, bonus value, avg value, top category, highest property | `channelInsights` |
| **Client Investment History** (tiles) | First/latest sponsorship, years active, lifetime spend/bonus | `clientHistory` |
| **Property Performance** (sortable table) | Every property: year, channel, client, category, type, value, bonus, duration | `properties[]` (Excel + PDF export) |

---

## 4. Spend Analytics — `/spend-analytics` (`SpendAnalyticsPage.jsx`)

Budget allocation. **One endpoint** does all aggregation: `/database/analytics?agencyId&clientId&monthFrom&monthTo`.
It returns `totalValue`, `totalWithVat`, and arrays `byMonth`, `byMedium`, `byMediaGroup`, `byChannel`, `byClient`, `byBrand`, `byAgency` (each `{ name, value, count }`).

| Chart | Type | Array used |
|---|---|---|
| **Summary tiles** | total value, with-VAT, avg/month, channels, top channel | `totalValue`, `totalWithVat`, `byMonth`, `byChannel` |
| **Monthly Spend Trend** | Composed: bars (value) + area (VAT) + Brush | `byMonth` |
| **Cumulative Spend** | Line (running total) | `byMonth` (computed) |
| **Spend by Agency** | Horizontal bars | `byAgency` |
| **Spend by Medium** | Donut + legend | `byMedium` |
| **Spend by Media Group** | Donut + legend | `byMediaGroup` |
| **Spend by Channel (Top 15)** | Horizontal bars, colored by medium | `byChannel` |
| **Top Clients by Spend** | Horizontal bars | `byClient` |
| **Breakdown table** | Media Group → Channels, expandable | `byMediaGroup` + `byChannel` |
| **By Client / By Brand tables** | Full lists with % share | `byClient`, `byBrand` |

Exports: **Excel** (SheetJS, one sheet per group) and **PDF** (jsPDF, charts captured with html2canvas).

---

## 5. Channel Intelligence — `/channel-masters/:id` (`ChannelIntelligencePage.jsx`)

Per-channel deep dive. Four endpoints, all keyed by the channel master id.

| Block | What it shows | Source |
|---|---|---|
| **Stat cards** | YTD spend, last year, YoY, active clients, total log entries, avg monthly, peak month, media group | `/analytics/channel/:id/summary` (+ monthly-derived) |
| **Monthly Spend Trend** (LineChart) | Schedule value vs. value with VAT, all months | `/analytics/channel/:id/monthly-spend` (`scheduleValue`, `scheduleValueWithVat`) |
| **Clients on this Channel** (table) | Per-client spend, entries, months active, last active | `/analytics/channel/:id/clients` |
| **Property History Timeline** (vertical timeline) | Each property's terms (type, category, duration, bonus, sponsorship) + audit trail of rate/term changes | `/analytics/channel/:id/property-history` |

---

## 6. Database — `/database` (`DatabasePage.jsx`)

Spreadsheet for entering/uploading schedule logs. When a client is selected it also shows
an overview strip from `/database/analytics?agencyId&clientId`:

| Block | Shows | Field |
|---|---|---|
| Overview tiles | Records, schedule value, with VAT, months/channels | `totalEntries`, `totalValue`, `totalWithVat`, `byMonth`, `byChannel` |
| Monthly mini bar chart | That client's monthly schedule value | `byMonth[]` |
| **Bulk import (all clients)** | Upload one file for every client (Year, RO, Sch:Month, Client, Brand, Medium, Media Group, Channel, Schedule Value) | `POST /database/import-all` |

---

## Shared helpers & tokens (reuse these)

- **Formatters:** `fmtLKR(v)` → "LKR 1,234,567", `fmtShort(v)` → "1.2M", `fmtMonth('2024-03')` → "Mar 2024".
- **Colors:** navy `#0A1729`/`#16243C`, coral `#E85D24`, blue `#1F5BB5`, green `#15814B`; medium colors `{ TV, RADIO, PRINT }`.
- **Loader:** `<OrbitLoader label="…" />` (animated orbit) — use instead of "Loading…".
- **Card chrome:** white `#fff`, border `#E5E8ED`, radius 14, mono font `'Spline Sans Mono'` for figures.

## Recipe: add a new chart

1. **Backend** — add (or reuse) an endpoint in `analytics.controller.js` that returns an array, e.g.
   `[{ label, value }]`. Register the route in `api/src/routes/analytics.routes.js`.
2. **Frontend** — `const [rows, setRows] = useState([])`, fetch it in a `useEffect`, then drop a
   Recharts block (`BarChart` / `LineChart` / `PieChart`) with `data={rows}`.
3. Wrap in `<ResponsiveContainer width="100%" height={…}>` and format axes with `fmtShort`/`fmtLKR`.
