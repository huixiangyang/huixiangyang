import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROFILE_USER = process.env.PROFILE_USER || "huixiangyang";
const API_TOKEN = process.env.GITHUB_TOKEN || "";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(SCRIPT_DIR, "../assets/profile-signal.svg");

const THOUGHTS = [
  "TRACE THE REAL PATH",
  "MAKE STATE VISIBLE",
  "SMALL SURFACES, STRONG CONTRACTS",
  "SHIP THE WHOLE LOOP",
  "CALM INTERFACE, RIGOROUS SYSTEM",
  "MEASURE BEFORE YOU GUESS",
  "BUILD FOR THE NEXT HANDOFF",
];

const ENGINEERING_EVENT_TYPES = new Set([
  "CreateEvent",
  "DeleteEvent",
  "IssuesEvent",
  "IssueCommentEvent",
  "PullRequestEvent",
  "PullRequestReviewEvent",
  "PushEvent",
  "ReleaseEvent",
]);

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": `${PROFILE_USER}-profile-signal`,
};

if (API_TOKEN) {
  headers.Authorization = `Bearer ${API_TOKEN}`;
}

/** 转义所有写入 SVG 文本节点的外部内容。 */
function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function fetchPublicEvents() {
  const events = [];

  // GitHub Events API 最多保留约 90 天；三页足够覆盖公开接口上限。
  for (let page = 1; page <= 3; page += 1) {
    const url = `https://api.github.com/users/${PROFILE_USER}/events/public?per_page=100&page=${page}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
    }

    const pageEvents = await response.json();
    events.push(...pageEvents);

    if (pageEvents.length < 100) {
      break;
    }
  }

  return events;
}

function summarize(events, now) {
  const dayMs = 24 * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - 90 * dayMs);
  const recentEvents = events.filter(
    (event) =>
      new Date(event.created_at) >= cutoff && ENGINEERING_EVENT_TYPES.has(event.type),
  );
  const activeDays = new Set();
  const repositories = new Set();
  const dailyCounts = new Map();
  let pushes = 0;
  let pullRequests = 0;

  for (const event of recentEvents) {
    const day = event.created_at.slice(0, 10);
    activeDays.add(day);
    dailyCounts.set(day, (dailyCounts.get(day) || 0) + 1);

    if (event.repo?.name) {
      repositories.add(event.repo.name);
    }

    if (event.type === "PushEvent") {
      pushes += 1;
    }

    if (event.type === "PullRequestEvent") {
      pullRequests += 1;
    }
  }

  const signal = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date(now.getTime() - offset * dayMs);
    const key = date.toISOString().slice(0, 10);
    signal.push({ key, count: dailyCounts.get(key) || 0 });
  }

  const sevenDayCutoff = new Date(now.getTime() - 7 * dayMs);
  const recentSignalCount = recentEvents.filter(
    (event) => new Date(event.created_at) >= sevenDayCutoff,
  ).length;

  return {
    pushes,
    pullRequests,
    activeDays: activeDays.size,
    repositories: repositories.size,
    signal,
    mode: recentSignalCount > 0 ? "ACTIVE SIGNAL" : "DEEP WORK",
  };
}

function createSignalGeometry(signal) {
  const startX = 437;
  const endX = 872;
  const baseline = 254;
  const maxHeight = 88;
  const maxCount = Math.max(1, ...signal.map((day) => day.count));
  const step = (endX - startX) / (signal.length - 1);
  const points = signal.map((day, index) => {
    const x = startX + index * step;
    const y = baseline - (day.count / maxCount) * maxHeight;
    return { x, y, count: day.count };
  });

  return {
    polyline: points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
    bars: points
      .map(
        ({ x, y, count }, index) => `
          <line class="signal-bar" x1="${x.toFixed(1)}" y1="${baseline}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" opacity="${count ? 0.34 : 0.1}" />
          <circle class="signal-point point-${index}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${count ? 3.4 : 2}" />`,
      )
      .join("")
      .trim(),
  };
}

function renderSvg(summary, now) {
  const dayIndex = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
  const thought = THOUGHTS[dayIndex % THOUGHTS.length];
  const syncLabel = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(now)
    .replace(",", "");
  const { polyline, bars } = createSignalGeometry(summary.signal);

  const metrics = [
    ["PUSH EVENTS", summary.pushes],
    ["ACTIVE DAYS", summary.activeDays],
    ["REPOS TOUCHED", summary.repositories],
    ["PULL REQUESTS", summary.pullRequests],
  ];

  const metricMarkup = metrics
    .map(([label, value], index) => {
      const x = 52 + (index % 2) * 170;
      const y = 158 + Math.floor(index / 2) * 88;
      return `
        <g transform="translate(${x} ${y})">
          <text class="metric-value" x="0" y="0">${escapeXml(value)}</text>
          <text class="metric-label" x="0" y="24">${escapeXml(label)} / 90D</text>
        </g>`;
    })
    .join("")
    .trim();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360" role="img" aria-labelledby="title description">
  <title id="title">Yang Huixiang engineering signal observatory</title>
  <desc id="description">A live visual summary of recent public GitHub activity, generated daily.</desc>

  <defs>
    <linearGradient id="panelGlow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d171a" />
      <stop offset="0.54" stop-color="#081113" />
      <stop offset="1" stop-color="#071013" />
    </linearGradient>
    <linearGradient id="signalGradient" x1="437" y1="0" x2="872" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#65f6d2" />
      <stop offset="0.52" stop-color="#b7f976" />
      <stop offset="1" stop-color="#ffb45b" />
    </linearGradient>
    <radialGradient id="coreGlow">
      <stop offset="0" stop-color="#b7f976" stop-opacity="0.24" />
      <stop offset="0.45" stop-color="#65f6d2" stop-opacity="0.08" />
      <stop offset="1" stop-color="#65f6d2" stop-opacity="0" />
    </radialGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#9fd8ca" stroke-opacity="0.045" stroke-width="1" />
    </pattern>
    <filter id="softGlow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="5" result="blur" />
      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter>
    <clipPath id="panelClip"><rect width="1200" height="360" rx="22" /></clipPath>
  </defs>

  <style>
    .display { font-family: "Arial Narrow", "Roboto Condensed", sans-serif; font-weight: 700; letter-spacing: 0.14em; }
    .mono { font-family: "SFMono-Regular", "Cascadia Code", "Liberation Mono", monospace; }
    .eyebrow { fill: #84a49c; font-family: "SFMono-Regular", "Cascadia Code", monospace; font-size: 10px; letter-spacing: 0.21em; }
    .title { fill: #e7f4ef; font-family: "Arial Narrow", "Roboto Condensed", sans-serif; font-size: 27px; font-weight: 700; letter-spacing: 0.12em; }
    .metric-value { fill: #e7f4ef; font-family: "SFMono-Regular", "Cascadia Code", monospace; font-size: 26px; font-weight: 700; }
    .metric-label { fill: #77958e; font-family: "SFMono-Regular", "Cascadia Code", monospace; font-size: 8px; letter-spacing: 0.14em; }
    .section-label { fill: #8ba9a1; font-family: "SFMono-Regular", "Cascadia Code", monospace; font-size: 9px; letter-spacing: 0.19em; }
    .thought { fill: #d6e8e2; font-family: "SFMono-Regular", "Cascadia Code", monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.11em; }
    .status { fill: #b7f976; font-family: "SFMono-Regular", "Cascadia Code", monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.14em; }
    .micro { fill: #66847d; font-family: "SFMono-Regular", "Cascadia Code", monospace; font-size: 8px; letter-spacing: 0.12em; }
    .signal-bar { stroke: #65f6d2; stroke-width: 1; }
    .signal-point { fill: #0a1416; stroke: #83e8ce; stroke-width: 1.4; }
    .signal-line { fill: none; stroke: url(#signalGradient); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; filter: url(#softGlow); stroke-dasharray: 8 8; animation: flow 7s linear infinite; }
    .scan-line { fill: url(#signalGradient); opacity: 0.12; animation: scan 7s ease-in-out infinite; }
    .core-pulse { transform-origin: 1037px 184px; animation: breathe 3.8s ease-in-out infinite; }
    .status-dot { animation: blink 2.2s steps(2, end) infinite; }
    @keyframes flow { to { stroke-dashoffset: -64; } }
    @keyframes scan { 0%, 12% { transform: translateY(-24px); } 82%, 100% { transform: translateY(410px); } }
    @keyframes breathe { 0%, 100% { transform: scale(0.92); opacity: 0.62; } 50% { transform: scale(1.06); opacity: 1; } }
    @keyframes blink { 0%, 58% { opacity: 1; } 59%, 100% { opacity: 0.3; } }
    @media (prefers-reduced-motion: reduce) {
      .signal-line, .scan-line, .core-pulse, .status-dot { animation: none; }
    }
  </style>

  <g clip-path="url(#panelClip)">
    <rect width="1200" height="360" rx="22" fill="url(#panelGlow)" />
    <rect width="1200" height="360" fill="url(#grid)" />
    <rect class="scan-line" x="0" y="-20" width="1200" height="2" />
    <circle cx="1037" cy="184" r="190" fill="url(#coreGlow)" />
    <path d="M0 82H1200M397 82V360M918 82V360" stroke="#9fd8ca" stroke-opacity="0.12" />
  </g>

  <rect x="0.75" y="0.75" width="1198.5" height="358.5" rx="21.25" fill="none" stroke="#98c7bb" stroke-opacity="0.22" stroke-width="1.5" />

  <g transform="translate(34 28)">
    <!-- Lucide Activity 图标 -->
    <g transform="translate(0 0) scale(0.72)" fill="none" stroke="#65f6d2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </g>
    <text class="eyebrow" x="29" y="11">YHX / SIGNAL OBSERVATORY</text>
  </g>
  <text class="title" x="34" y="62">ENGINEERING TELEMETRY</text>
  <text class="micro" x="1162" y="43" text-anchor="end">SYNC ${escapeXml(syncLabel)} CST</text>

  <g>
    <text class="section-label" x="34" y="112">PUBLIC ACTIVITY ARRAY</text>
    ${metricMarkup}
  </g>

  <g>
    <text class="section-label" x="429" y="112">FOURTEEN DAY SIGNAL</text>
    <line x1="437" y1="254" x2="872" y2="254" stroke="#9fd8ca" stroke-opacity="0.17" />
    <line x1="437" y1="210" x2="872" y2="210" stroke="#9fd8ca" stroke-opacity="0.08" stroke-dasharray="3 7" />
    ${bars}
    <polyline class="signal-line" points="${polyline}" />
    <text class="micro" x="437" y="281">T−13D</text>
    <text class="micro" x="872" y="281" text-anchor="end">NOW</text>
    <text class="section-label" x="429" y="316">TODAY&apos;S OPERATING PRINCIPLE</text>
    <text class="thought" x="872" y="318" text-anchor="end">${escapeXml(thought)}</text>
  </g>

  <g>
    <circle class="core-pulse" cx="1037" cy="184" r="112" fill="none" stroke="#65f6d2" stroke-opacity="0.08" />
    <circle cx="1037" cy="184" r="78" fill="#0a1517" fill-opacity="0.58" stroke="#8bc8b8" stroke-opacity="0.2" />
    <circle cx="1037" cy="184" r="59" fill="none" stroke="#b7f976" stroke-opacity="0.18" stroke-dasharray="2 7" />
    <circle class="status-dot" cx="1037" cy="153" r="5" fill="#b7f976" filter="url(#softGlow)" />
    <text class="status" x="1037" y="188" text-anchor="middle">${escapeXml(summary.mode)}</text>
    <text class="micro" x="1037" y="208" text-anchor="middle">OBSERVE / TRACE / SHIP</text>
    <path d="M1037 77v20M1037 271v20M930 184h20M1124 184h20" stroke="#7eb7a9" stroke-opacity="0.22" />
    <text class="micro" x="1037" y="325" text-anchor="middle">AUTO-GENERATED FROM PUBLIC EVENTS</text>
  </g>
</svg>
`;
}

async function main() {
  const now = new Date();
  const events = await fetchPublicEvents();
  const summary = summarize(events, now);
  const svg = renderSvg(summary, now);

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, svg, "utf8");
  console.log(`Generated ${OUTPUT_PATH} from ${events.length} public events.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
