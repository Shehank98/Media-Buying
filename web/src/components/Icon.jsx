const PATHS = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  building: "M3 21h18M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M9 8h.01M12 8h.01M9 11h.01M12 11h.01M9 14h.01M12 14h.01M19 21V11a1 1 0 0 0-1-1h-3",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  tv: "M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2ZM17 2l-5 5-5-5",
  radio: "M4.93 19.07a10 10 0 0 1 0-14.14M7.76 16.24a6 6 0 0 1 0-8.49M16.24 7.76a6 6 0 0 1 0 8.49M19.07 4.93a10 10 0 0 1 0 14.14M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2",
  print: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
  digital: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20",
  chart: "M3 3v18h18M18 17V9M13 17V5M8 17v-3",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
  plus: "M12 5v14M5 12h14",
  chevR: "M9 18l6-6-6-6",
  chevD: "M6 9l6 6 6-6",
  edit: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  history: "M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8M12 7v5l4 2",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  x: "M18 6L6 18M6 6l12 12",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  filter: "M22 3H2l8 9.46V19l4 2v-8.54L22 3z",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6",
  lock: "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  check: "M20 6L9 17l-5-5",
  alert: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01",
  arrowUp: "M12 19V5M5 12l7-7 7 7",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  folder: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  sparkle: "M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2L12 3z",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  money: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  'bar-chart': "M12 20V10M18 20V4M6 20v-4",
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  'trending-up': "M22 7l-8.5 8.5-5-5L2 17M22 7h-6M22 7v6",
  'trending-down': "M22 17l-8.5-8.5-5 5L2 7M22 17h-6M22 17v-6",
  dollar: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  chevL: "M15 18l-6-6 6-6",
  chevDown: "M6 9l6 6 6-6",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  database: "M12 2C6.48 2 2 4.02 2 6.5v11C2 19.98 6.48 22 12 22s10-2.02 10-4.5v-11C22 4.02 17.52 2 12 2M2 6.5C2 8.98 6.48 11 12 11s10-2.02 10-4.5M2 12c0 2.48 4.48 4.5 10 4.5s10-2.02 10-4.5",
  trash: "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
};

export default function Icon({ name, size = 24, stroke = 2, className, style }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {d.split("M").filter(Boolean).map((seg, i) => (
        <path key={i} d={"M" + seg} />
      ))}
    </svg>
  );
}

const AVATAR_COLORS = ["#E85D24","#1F5BB5","#15814B","#6B3FB5","#C5391F","#9A5B00","#38527E"];

export function Avatar({ name, size = 32 }) {
  const colorIdx = ((name?.charCodeAt(0) || 0) + (name?.charCodeAt(1) || 0)) % AVATAR_COLORS.length;
  const initials = (name || '').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, background: AVATAR_COLORS[colorIdx], fontSize: size * 0.4 }}
    >
      {initials}
    </div>
  );
}

const TYPE_STYLES = {
  BOUGHT_AIRTIME:   { label: "Bought Airtime", cls: "b-airtime" },
  SPONSORSHIP:      { label: "Sponsorship",    cls: "b-sponsor" },
  BONUS_COMMERCIAL: { label: "Bonus",          cls: "b-bonus" },
  OTHER:            { label: "Other",          cls: "b-other" },
};

export function TypeBadge({ type }) {
  if (!type) return <span style={{ color: 'var(--muted-2)' }}>-</span>;
  // Known legacy enum values keep their styled badge; free-text types render neutrally.
  const t = TYPE_STYLES[type];
  return (
    <span className={`badge ${t ? t.cls : 'b-other'}`}>
      <span className="bdot" />
      {t ? t.label : type}
    </span>
  );
}

const ROLE_STYLES = {
  SUPER_ADMIN: { label: "Super Admin", bg: "var(--purple-100)", fg: "var(--purple-700)" },
  MANAGER:     { label: "Manager",     bg: "var(--blue-100)",   fg: "var(--blue-700)" },
  GROUP_HEAD:  { label: "Group Head",  bg: "var(--coral-100)",  fg: "var(--coral-700)" },
  PLANNER:     { label: "Planner",     bg: "var(--green-100)",  fg: "var(--green-600)" },
};

export function RoleBadge({ role, small }) {
  const r = ROLE_STYLES[role] || ROLE_STYLES.PLANNER;
  return (
    <span
      className="role-badge"
      style={{
        background: r.bg,
        color: r.fg,
        fontSize: small ? '10px' : undefined,
        padding: small ? '3px 8px' : undefined,
      }}
    >
      {r.label}
    </span>
  );
}

export function fmtLKR(v) {
  if (v == null || v === '') return '-';
  const n = Number(v); const a = Math.abs(n);
  if (a >= 1e9) return 'LKR ' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return 'LKR ' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return 'LKR ' + (n / 1e3).toFixed(1) + 'K';
  return 'LKR ' + Math.round(n).toLocaleString('en-US');
}
