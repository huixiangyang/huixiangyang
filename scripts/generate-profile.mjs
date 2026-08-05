import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROFILE_USER = process.env.PROFILE_USER || "huixiangyang";
const API_TOKEN = process.env.GITHUB_TOKEN || "";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATHS = {
  fieldNote: {
    light: resolve(SCRIPT_DIR, "../assets/profile-signal-light.svg"),
    dark: resolve(SCRIPT_DIR, "../assets/profile-signal-dark.svg"),
  },
  terrain: {
    light: resolve(SCRIPT_DIR, "../assets/contribution-terrain-light.svg"),
    dark: resolve(SCRIPT_DIR, "../assets/contribution-terrain-dark.svg"),
  },
  blackBox: {
    light: resolve(SCRIPT_DIR, "../assets/black-box-light.svg"),
    dark: resolve(SCRIPT_DIR, "../assets/black-box-dark.svg"),
  },
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

async function fetchContributionCalendar(now) {
  if (!API_TOKEN) {
    throw new Error("GITHUB_TOKEN is required to generate the contribution terrain.");
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const from = new Date(now.getTime() - 365 * dayMs).toISOString();
  const to = now.toISOString();
  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            weeks {
              firstDay
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { login: PROFILE_USER, from, to },
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(`GitHub GraphQL error: ${payload.errors[0].message}`);
  }

  const weeks =
    payload.data?.user?.contributionsCollection?.contributionCalendar?.weeks || [];
  const days = weeks.flatMap((week) => week.contributionDays).slice(-365);
  const includedDates = new Set(days.map((day) => day.date));
  const selectedWeeks = weeks
    .map((week) => {
      const contributionDays = week.contributionDays.filter((day) =>
        includedDates.has(day.date),
      );
      return {
        firstDay: contributionDays[0]?.date || week.firstDay,
        count: contributionDays.reduce(
          (total, day) => total + day.contributionCount,
          0,
        ),
        included: contributionDays.length > 0,
      };
    })
    .filter((week) => week.included)
    .map(({ firstDay, count }) => ({ firstDay, count }));

  return {
    days,
    weeks: selectedWeeks,
    total: days.reduce((total, day) => total + day.contributionCount, 0),
    activeDays: days.filter((day) => day.contributionCount > 0).length,
    maxDay: Math.max(0, ...days.map((day) => day.contributionCount)),
  };
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
  const latestPushEvent = events.find(
    (event) => event.type === "PushEvent" && event.payload?.head,
  );

  return {
    pushes,
    pullRequests,
    activeDays: activeDays.size,
    repositories: repositories.size,
    signal,
    mode: recentSignalCount > 0 ? "ACTIVE SIGNAL" : "DEEP WORK",
    latestPush: latestPushEvent
      ? {
          head: latestPushEvent.payload.head,
          repository: latestPushEvent.repo?.name || "unknown",
          createdAt: latestPushEvent.created_at,
        }
      : {
          head: "0000000000000000000000000000000000000000",
          repository: `${PROFILE_USER}/${PROFILE_USER}`,
          createdAt: now.toISOString(),
        },
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

function renderFieldNote(summary, now, themeName) {
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

function createTerrainGeometry(calendar) {
  const weeks = calendar.weeks.slice(-53);
  const startX = 56;
  const endX = 852;
  const baseline = 282;
  const maxHeight = 132;
  const maxCount = Math.max(1, ...weeks.map((week) => week.count));
  const step = (endX - startX) / Math.max(1, weeks.length - 1);
  const points = weeks.map((week, index) => {
    const x = startX + index * step;
    const normalized = Math.sqrt(week.count / maxCount);
    const y = baseline - normalized * maxHeight;
    return { ...week, x, y };
  });

  const ridgePath = points
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const areaPath = [
    `M${startX} ${baseline}`,
    ...points.map(({ x, y }) => `L${x.toFixed(1)} ${y.toFixed(1)}`),
    `L${endX} ${baseline}`,
    "Z",
  ].join(" ");
  const contourLayers = Array.from({ length: 5 }, (_, index) => 4 - index)
    .map((layer) => {
      const offset = layer * 8;
      const path = points
        .map(
          ({ x, y }, index) =>
            `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${(y + offset).toFixed(1)}`,
        )
        .join(" ");
      return `<path class="terrain-contour contour-${layer}" d="${path}" opacity="${(0.16 + layer * 0.08).toFixed(2)}" />`;
    })
    .join("");
  const activeColumns = points
    .filter((point) => point.count > 0)
    .map(
      ({ x, y, count }) =>
        `<line class="terrain-column" x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${baseline}" opacity="${Math.min(0.76, 0.24 + count * 0.08).toFixed(2)}" />`,
    )
    .join("");

  const monthLabels = [];
  let previousMonth = "";
  for (const point of points) {
    const date = new Date(`${point.firstDay}T00:00:00Z`);
    const month = new Intl.DateTimeFormat("en", {
      month: "short",
      timeZone: "UTC",
    })
      .format(date)
      .toUpperCase();
    if (month !== previousMonth) {
      monthLabels.push({ x: point.x, month });
      previousMonth = month;
    }
  }

  return {
    ridgePath,
    areaPath,
    contourLayers,
    activeColumns,
    monthMarkup: monthLabels
      .map(
        ({ x, month }) =>
          `<text class="micro" x="${x.toFixed(1)}" y="315">${month}</text>`,
      )
      .join(""),
  };
}

function createSealGeometry(commitSha) {
  const sha = commitSha.padEnd(40, "0").slice(0, 40).toLowerCase();
  const centerX = 1022;
  const centerY = 194;
  const outerPoints = Array.from({ length: 20 }, (_, index) => {
    const value = Number.parseInt(sha[index], 16) || 0;
    const angle = -Math.PI / 2 + (index / 20) * Math.PI * 2;
    const radius = 50 + (value / 15) * 27;
    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      angle,
      value,
    };
  });
  const innerPoints = Array.from({ length: 20 }, (_, index) => {
    const value = Number.parseInt(sha[index + 20], 16) || 0;
    const angle = -Math.PI / 2 + (index / 20) * Math.PI * 2;
    const radius = 27 + (value / 15) * 17;
    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    };
  });
  const toPath = (points) =>
    `${points
      .map(
        ({ x, y }, index) =>
          `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`,
      )
      .join(" ")} Z`;
  const ticks = outerPoints
    .map(({ angle, value }) => {
      const innerRadius = 84;
      const outerRadius = 88 + (value % 3) * 2;
      const x1 = centerX + Math.cos(angle) * innerRadius;
      const y1 = centerY + Math.sin(angle) * innerRadius;
      const x2 = centerX + Math.cos(angle) * outerRadius;
      const y2 = centerY + Math.sin(angle) * outerRadius;
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" />`;
    })
    .join("");
  const connectors = outerPoints
    .map(
      ({ x, y }, index) =>
        `<line x1="${innerPoints[index].x.toFixed(1)}" y1="${innerPoints[index].y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" />`,
    )
    .join("");

  return {
    outerPath: toPath(outerPoints),
    innerPath: toPath(innerPoints),
    ticks,
    connectors,
    shortSha: sha.slice(0, 7),
    sha,
  };
}

function renderTerrain(calendar, summary, now, themeName) {
  const palette = THEMES[themeName];
  const terrain = createTerrainGeometry(calendar);
  const seal = createSealGeometry(summary.latestPush.head);
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "short",
    day: "2-digit",
  })
    .format(now)
    .toUpperCase();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="350" viewBox="0 0 1200 350" role="img" aria-labelledby="title description">
  <title id="title">Annual contribution terrain and source fingerprint</title>
  <desc id="description">A generative architectural landscape made from 365 days of public contributions, paired with a seal derived from the latest public commit.</desc>
  <defs>
    <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.background}" />
      <stop offset="0.7" stop-color="${palette.background}" />
      <stop offset="1" stop-color="${palette.backgroundAlt}" />
    </linearGradient>
    <linearGradient id="terrainFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.3" />
      <stop offset="0.66" stop-color="${palette.accentSoft}" stop-opacity="0.08" />
      <stop offset="1" stop-color="${palette.accent}" stop-opacity="0" />
    </linearGradient>
    <pattern id="paper" width="28" height="28" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="0.6" fill="${palette.text}" opacity="0.04" />
    </pattern>
    <clipPath id="panelClip"><rect width="1200" height="350" rx="18" /></clipPath>
  </defs>
  <style>
    .label { fill: ${palette.textSoft}; font-family: "SFMono-Regular", "Cascadia Code", monospace; font-size: 9px; letter-spacing: 0.17em; }
    .micro { fill: ${palette.textFaint}; font-family: "SFMono-Regular", "Cascadia Code", monospace; font-size: 8px; letter-spacing: 0.12em; }
    .headline { fill: ${palette.text}; font-family: Georgia, "Times New Roman", serif; font-size: 34px; letter-spacing: -0.025em; }
    .count { fill: ${palette.text}; font-family: Georgia, "Times New Roman", serif; font-size: 26px; }
    .terrain-contour { fill: none; stroke: ${palette.accentSoft}; stroke-width: 1; }
    .terrain-column { stroke: ${palette.accent}; stroke-width: 1; }
    .terrain-ridge { fill: none; stroke: ${palette.warm}; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .seal-orbit { transform-origin: 1022px 194px; animation: seal-orbit 48s linear infinite; }
    .seal-pulse { transform-origin: 1022px 194px; animation: seal-pulse 5s ease-in-out infinite; }
    @keyframes seal-orbit { to { transform: rotate(360deg); } }
    @keyframes seal-pulse { 0%, 100% { opacity: 0.4; transform: scale(0.98); } 50% { opacity: 0.8; transform: scale(1.03); } }
    @media (prefers-reduced-motion: reduce) { .seal-orbit, .seal-pulse { animation: none; } }
  </style>

  <g clip-path="url(#panelClip)">
    <rect width="1200" height="350" rx="18" fill="url(#surface)" />
    <rect width="1200" height="350" fill="url(#paper)" />
    <path d="M900 28V322M32 130H1168" fill="none" stroke="${palette.line}" />
  </g>
  <rect x="0.75" y="0.75" width="1198.5" height="348.5" rx="17.25" fill="none" stroke="${palette.lineStrong}" stroke-opacity="0.72" stroke-width="1.5" />

  <text class="label" x="56" y="42">365-DAY CONTRIBUTION TERRAIN</text>
  <text class="headline" x="56" y="88">A year, shaped by work.</text>
  <text class="micro" x="56" y="112">${calendar.total} VISIBLE CONTRIBUTIONS / ${calendar.activeDays} ACTIVE DAYS / PEAK ${calendar.maxDay}</text>
  <text class="micro" x="852" y="42" text-anchor="end">THROUGH ${escapeXml(dateLabel)}</text>

  <path d="${terrain.areaPath}" fill="url(#terrainFill)" />
  ${terrain.contourLayers}
  ${terrain.activeColumns}
  <path class="terrain-ridge" d="${terrain.ridgePath}" />
  <line x1="56" y1="282" x2="852" y2="282" stroke="${palette.lineStrong}" stroke-width="1" />
  ${terrain.monthMarkup}

  <text class="label" x="936" y="42">SOURCE FINGERPRINT</text>
  <text class="micro" x="1144" y="42" text-anchor="end">LATEST PUBLIC HEAD</text>
  <g class="seal-pulse" fill="none" stroke="${palette.lineStrong}" stroke-width="1">
    <circle cx="1022" cy="194" r="100" />
    <circle cx="1022" cy="194" r="92" stroke-dasharray="1 8" />
  </g>
  <g class="seal-orbit" fill="none" stroke="${palette.accent}" stroke-width="1">
    ${seal.ticks}
  </g>
  <g fill="none" stroke="${palette.line}" stroke-width="0.8" opacity="0.68">${seal.connectors}</g>
  <path d="${seal.outerPath}" fill="${palette.accent}" fill-opacity="0.08" stroke="${palette.accent}" stroke-width="1.3" />
  <path d="${seal.innerPath}" fill="${palette.background}" fill-opacity="0.84" stroke="${palette.warm}" stroke-width="1.2" />
  <text x="1022" y="199" text-anchor="middle" fill="${palette.text}" font-family="Georgia, 'Times New Roman', serif" font-size="24">YH</text>
  <text class="micro" x="1022" y="302" text-anchor="middle">${seal.shortSha.toUpperCase()} / ${escapeXml(summary.latestPush.repository.toUpperCase())}</text>
</svg>
`;
}

function createCommitBarcode(commitSha) {
  const sha = commitSha.padEnd(40, "0").slice(0, 40).toLowerCase();
  return Array.from(sha)
    .map((character, index) => {
      const value = Number.parseInt(character, 16) || 0;
      const height = 12 + value * 2.8;
      const x = 704 + index * 10.5;
      return `<rect x="${x.toFixed(1)}" y="${(214 - height).toFixed(1)}" width="4.5" height="${height.toFixed(1)}" />`;
    })
    .join("");
}

function renderBlackBox(calendar, summary, now, themeName) {
  const palette = THEMES[themeName];
  const thought = THOUGHTS[
    Math.floor(now.getTime() / (24 * 60 * 60 * 1000)) % THOUGHTS.length
  ];
  const seal = createSealGeometry(summary.latestPush.head);
  const barcode = createCommitBarcode(summary.latestPush.head);
  const transmittedAt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(summary.latestPush.createdAt))
    .replace(",", "")
    .toUpperCase();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="250" viewBox="0 0 1200 250" role="img" aria-labelledby="title description">
  <title id="title">Profile black box readout</title>
  <desc id="description">A hidden readout containing the latest public source signal and contribution summary.</desc>
  <defs>
    <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.background}" />
      <stop offset="1" stop-color="${palette.backgroundAlt}" />
    </linearGradient>
    <pattern id="paper" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="0.55" fill="${palette.text}" opacity="0.04" />
    </pattern>
  </defs>
  <style>
    .label { fill: ${palette.textSoft}; font-family: "SFMono-Regular", "Cascadia Code", monospace; font-size: 9px; letter-spacing: 0.17em; }
    .micro { fill: ${palette.textFaint}; font-family: "SFMono-Regular", "Cascadia Code", monospace; font-size: 8px; letter-spacing: 0.11em; }
    .value { fill: ${palette.text}; font-family: "SFMono-Regular", "Cascadia Code", monospace; font-size: 11px; letter-spacing: 0.08em; }
    .headline { fill: ${palette.text}; font-family: Georgia, "Times New Roman", serif; font-size: 42px; letter-spacing: -0.03em; }
    .cursor { animation: cursor 1.6s steps(2, end) infinite; }
    @keyframes cursor { 50% { opacity: 0.18; } }
    @media (prefers-reduced-motion: reduce) { .cursor { animation: none; } }
  </style>
  <rect width="1200" height="250" rx="16" fill="url(#surface)" />
  <rect width="1200" height="250" rx="16" fill="url(#paper)" />
  <rect x="0.75" y="0.75" width="1198.5" height="248.5" rx="15.25" fill="none" stroke="${palette.lineStrong}" stroke-opacity="0.72" stroke-width="1.5" />
  <path d="M548 28V222M32 222H1168" fill="none" stroke="${palette.line}" />

  <text class="label" x="48" y="42">INTERNAL READOUT / ${escapeXml(summary.mode)}</text>
  <text class="headline" x="48" y="101">Black <tspan fill="${palette.warm}" font-style="italic">/</tspan> box</text>
  <text class="label" x="50" y="135">CURRENT TRANSMISSION</text>
  <text x="50" y="168" fill="${palette.text}" font-family="Georgia, 'Times New Roman', serif" font-size="23" font-style="italic">${escapeXml(thought)}</text>
  <rect class="cursor" x="50" y="190" width="34" height="2" fill="${palette.accent}" />

  <text class="label" x="588" y="42">LATEST PUBLIC HEAD</text>
  <text class="value" x="588" y="68">${seal.sha}</text>
  <text class="label" x="588" y="101">REPOSITORY</text>
  <text class="value" x="588" y="127">${escapeXml(summary.latestPush.repository)}</text>
  <text class="label" x="936" y="101">TRANSMITTED</text>
  <text class="value" x="936" y="127">${escapeXml(transmittedAt)} CST</text>
  <g fill="${palette.accent}" opacity="0.74">${barcode}</g>

  <text class="micro" x="48" y="240">${summary.pushes} PUSH EVENTS / ${summary.repositories} REPOS TOUCHED / ${calendar.total} YEARLY CONTRIBUTIONS</text>
  <text class="micro" x="1152" y="240" text-anchor="end">END OF READOUT</text>
</svg>
`;
}

function validateSvg(svg, outputPath) {
  const invalidTokens = ["NaN", "undefined", "Infinity"];
  const invalidToken = invalidTokens.find((token) => svg.includes(token));

  if (!svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) {
    throw new Error(`Generated SVG is missing its XML declaration: ${outputPath}`);
  }

  if (invalidToken) {
    throw new Error(`Generated SVG contains ${invalidToken}: ${outputPath}`);
  }

  if (!svg.includes("<title") || !svg.includes("<desc")) {
    throw new Error(`Generated SVG is missing accessibility metadata: ${outputPath}`);
  }
}

async function main() {
  const now = new Date();
  const [events, calendar] = await Promise.all([
    fetchPublicEvents(),
    fetchContributionCalendar(now),
  ]);
  const summary = summarize(events, now);

  for (const themeName of Object.keys(THEMES)) {
    const artifacts = [
      {
        path: OUTPUT_PATHS.fieldNote[themeName],
        svg: renderFieldNote(summary, now, themeName),
      },
      {
        path: OUTPUT_PATHS.terrain[themeName],
        svg: renderTerrain(calendar, summary, now, themeName),
      },
      {
        path: OUTPUT_PATHS.blackBox[themeName],
        svg: renderBlackBox(calendar, summary, now, themeName),
      },
    ];

    for (const artifact of artifacts) {
      validateSvg(artifact.svg, artifact.path);
      await mkdir(dirname(artifact.path), { recursive: true });
      await writeFile(artifact.path, artifact.svg, "utf8");
      console.log(`Generated ${artifact.path}.`);
    }
  }

  console.log(
    `Source data: ${events.length} public events, ${calendar.total} contributions, ${calendar.activeDays} active days.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
