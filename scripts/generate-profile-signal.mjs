import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROFILE_USER = process.env.PROFILE_USER || "huixiangyang";
const API_TOKEN = process.env.GITHUB_TOKEN || "";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATHS = {
  light: resolve(SCRIPT_DIR, "../assets/profile-signal-light.svg"),
  dark: resolve(SCRIPT_DIR, "../assets/profile-signal-dark.svg"),
};

const THOUGHTS = [
  "Trace the real path.",
  "Make state visible.",
  "Small surfaces. Strong contracts.",
  "Ship the whole loop.",
  "Calm interface. Rigorous system.",
  "Measure before you guess.",
  "Build for the next handoff.",
];

const THEMES = {
  light: {
    background: "#efede6",
    backgroundAlt: "#e7e3da",
    text: "#171b1c",
    textSoft: "#566261",
    textFaint: "#7c8683",
    line: "#bbc1bc",
    lineStrong: "#909b98",
    accent: "#155367",
    accentSoft: "#76a5af",
    warm: "#c45f43",
    pointFill: "#efede6",
  },
  dark: {
    background: "#0d1011",
    backgroundAlt: "#13191a",
    text: "#e9ebe5",
    textSoft: "#9ba6a2",
    textFaint: "#687371",
    line: "#2b3435",
    lineStrong: "#465354",
    accent: "#6ba9b5",
    accentSoft: "#356979",
    warm: "#d27b60",
    pointFill: "#0d1011",
  },
};

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
  const startX = 624;
  const endX = 1144;
  const baseline = 292;
  const maxHeight = 116;
  const maxCount = Math.max(1, ...signal.map((day) => day.count));
  const step = (endX - startX) / (signal.length - 1);
  const points = signal.map((day, index) => {
    const x = startX + index * step;
    const y = baseline - (day.count / maxCount) * maxHeight;
    return { x, y, count: day.count };
  });

  return {
    linePath: points
      .map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(" "),
    areaPath: [
      `M${startX} ${baseline}`,
      ...points.map(({ x, y }) => `L${x.toFixed(1)} ${y.toFixed(1)}`),
      `L${endX} ${baseline}`,
      "Z",
    ].join(" "),
    guides: points
      .map(
        ({ x, y, count }, index) => `
          <line class="day-rule" x1="${x.toFixed(1)}" y1="158" x2="${x.toFixed(1)}" y2="${baseline}" opacity="${count ? 0.44 : 0.2}" />
          <circle class="signal-point point-${index}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${count ? 4.4 : 2.2}" />`,
      )
      .join("")
      .trim(),
    endpoint: points.at(-1),
  };
}

function wrapThought(text, limit = 27) {
  const words = text.split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > limit && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, 2);
}

function renderSvg(summary, now, themeName) {
  const palette = THEMES[themeName];
  const dayIndex = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
  const thought = THOUGHTS[dayIndex % THOUGHTS.length];
  const thoughtLines = wrapThought(thought);
  const syncLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(now)
    .replace(",", "")
    .toUpperCase();
  const { linePath, areaPath, guides, endpoint } = createSignalGeometry(summary.signal);

  const metrics = [
    ["01", "PUSH EVENTS", summary.pushes],
    ["02", "ACTIVE DAYS", summary.activeDays],
    ["03", "REPOS TOUCHED", summary.repositories],
    ["04", "PULL REQUESTS", summary.pullRequests],
  ];
  const metricMarkup = metrics
    .map(([indexLabel, label, value], index) => {
      const x = 56 + index * 284;
      return `
        <g transform="translate(${x} 359)">
          <text class="metric-index" x="0" y="0">${indexLabel}</text>
          <text class="metric-value" x="38" y="0">${escapeXml(value)}</text>
          <text class="metric-label" x="38" y="22">${escapeXml(label)} / 90D</text>
        </g>`;
    })
    .join("")
    .trim();
  const thoughtMarkup = thoughtLines
    .map(
      (line, index) =>
        `<tspan x="56" dy="${index === 0 ? 0 : 35}">${escapeXml(line)}</tspan>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="410" viewBox="0 0 1200 410" role="img" aria-labelledby="title description">
  <title id="title">Yang Huixiang live engineering field note</title>
  <desc id="description">An editorial visualization of recent public GitHub activity, generated daily.</desc>

  <defs>
    <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.background}" />
      <stop offset="0.64" stop-color="${palette.background}" />
      <stop offset="1" stop-color="${palette.backgroundAlt}" />
    </linearGradient>
    <linearGradient id="signalStroke" x1="624" y1="0" x2="1144" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${palette.accentSoft}" />
      <stop offset="0.68" stop-color="${palette.accent}" />
      <stop offset="1" stop-color="${palette.warm}" />
    </linearGradient>
    <linearGradient id="signalArea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.18" />
      <stop offset="1" stop-color="${palette.accent}" stop-opacity="0" />
    </linearGradient>
    <pattern id="paper" width="28" height="28" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="0.6" fill="${palette.text}" opacity="0.045" />
    </pattern>
    <clipPath id="panelClip"><rect width="1200" height="410" rx="18" /></clipPath>
  </defs>

  <style>
    .label { fill: ${palette.textSoft}; font-family: "SFMono-Regular", "Cascadia Code", monospace; font-size: 9px; letter-spacing: 0.18em; }
    .micro { fill: ${palette.textFaint}; font-family: "SFMono-Regular", "Cascadia Code", monospace; font-size: 8px; letter-spacing: 0.12em; }
    .headline { fill: ${palette.text}; font-family: Georgia, "Times New Roman", serif; font-size: 54px; font-weight: 400; letter-spacing: -0.035em; }
    .headline-accent { fill: ${palette.warm}; font-style: italic; }
    .principle { fill: ${palette.text}; font-family: Georgia, "Times New Roman", serif; font-size: 27px; font-style: italic; letter-spacing: -0.01em; }
    .mode { fill: ${palette.accent}; font-family: "SFMono-Regular", "Cascadia Code", monospace; font-size: 9px; font-weight: 700; letter-spacing: 0.16em; }
    .metric-index { fill: ${palette.warm}; font-family: Georgia, "Times New Roman", serif; font-size: 13px; font-style: italic; }
    .metric-value { fill: ${palette.text}; font-family: Georgia, "Times New Roman", serif; font-size: 25px; }
    .metric-label { fill: ${palette.textFaint}; font-family: "SFMono-Regular", "Cascadia Code", monospace; font-size: 8px; letter-spacing: 0.12em; }
    .day-rule { stroke: ${palette.line}; stroke-width: 1; }
    .signal-point { fill: ${palette.pointFill}; stroke: ${palette.accent}; stroke-width: 1.4; }
    .signal-line { fill: none; stroke: url(#signalStroke); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 3 7; animation: drift 18s linear infinite; }
    .orbit { transform-origin: 934px 208px; animation: orbit 36s linear infinite; }
    .endpoint-ring { transform-origin: ${endpoint.x.toFixed(1)}px ${endpoint.y.toFixed(1)}px; animation: pulse 3.4s ease-in-out infinite; }
    @keyframes drift { to { stroke-dashoffset: -80; } }
    @keyframes orbit { to { transform: rotate(360deg); } }
    @keyframes pulse { 0%, 100% { transform: scale(0.74); opacity: 0.15; } 50% { transform: scale(1.35); opacity: 0.5; } }
    @media (prefers-reduced-motion: reduce) {
      .signal-line, .orbit, .endpoint-ring { animation: none; }
    }
  </style>

  <g clip-path="url(#panelClip)">
    <rect width="1200" height="410" rx="18" fill="url(#surface)" />
    <rect width="1200" height="410" fill="url(#paper)" />
    <path d="M594 28V318M32 326H1168" fill="none" stroke="${palette.line}" />
    <path d="M16 82H42M16 124H28M1172 82H1184M1158 124H1184" fill="none" stroke="${palette.lineStrong}" stroke-width="1" />
    <g class="orbit" fill="none" stroke="${palette.line}" stroke-width="1">
      <ellipse cx="934" cy="208" rx="224" ry="108" />
      <ellipse cx="934" cy="208" rx="176" ry="78" stroke-dasharray="2 8" />
      <path d="M710 208H1158M934 100V316" stroke-opacity="0.54" />
    </g>
  </g>

  <rect x="0.75" y="0.75" width="1198.5" height="408.5" rx="17.25" fill="none" stroke="${palette.lineStrong}" stroke-opacity="0.72" stroke-width="1.5" />

  <g transform="translate(56 39)">
    <!-- Lucide Activity 图标 -->
    <g transform="translate(0 -4) scale(0.7)" fill="none" stroke="${palette.accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </g>
    <text class="label" x="30" y="8">YANG HUIXIANG / LIVE FIELD NOTE</text>
  </g>
  <text class="micro" x="1144" y="47" text-anchor="end">UPDATED ${escapeXml(syncLabel)} CST</text>

  <text class="headline" x="56" y="121">
    <tspan>Work</tspan><tspan class="headline-accent"> / </tspan><tspan>in motion</tspan>
  </text>
  <text class="label" x="58" y="151">PUBLIC ENGINEERING ACTIVITY, RENDERED AS A DAILY FIELD NOTE</text>

  <text class="label" x="56" y="211">TODAY&apos;S OPERATING PRINCIPLE</text>
  <text class="principle" x="56" y="252">${thoughtMarkup}</text>
  <line x1="56" y1="302" x2="168" y2="302" stroke="${palette.warm}" stroke-width="2" />
  <circle cx="181" cy="302" r="3" fill="${palette.accent}" />
  <text class="mode" x="197" y="306">${escapeXml(summary.mode)}</text>

  <g>
    <text class="label" x="624" y="126">FOURTEEN-DAY FIELD TRACE</text>
    <text class="micro" x="1144" y="126" text-anchor="end">EVENT DENSITY / UTC</text>
    <path d="${areaPath}" fill="url(#signalArea)" />
    ${guides}
    <path class="signal-line" d="${linePath}" />
    <circle class="endpoint-ring" cx="${endpoint.x.toFixed(1)}" cy="${endpoint.y.toFixed(1)}" r="12" fill="none" stroke="${palette.warm}" stroke-width="1" />
    <circle cx="${endpoint.x.toFixed(1)}" cy="${endpoint.y.toFixed(1)}" r="3.4" fill="${palette.warm}" />
    <text class="micro" x="624" y="311">T−13 DAYS</text>
    <text class="micro" x="1144" y="311" text-anchor="end">PRESENT</text>
  </g>

  ${metricMarkup}
  <text class="micro" x="1144" y="392" text-anchor="end">OBSERVE / TRACE / SHIP</text>
</svg>
`;
}

async function main() {
  const now = new Date();
  const events = await fetchPublicEvents();
  const summary = summarize(events, now);

  for (const [themeName, outputPath] of Object.entries(OUTPUT_PATHS)) {
    const svg = renderSvg(summary, now, themeName);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, svg, "utf8");
    console.log(`Generated ${outputPath} from ${events.length} public events.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
