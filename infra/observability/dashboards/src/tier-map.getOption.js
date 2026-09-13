// Tier map for the STRATO infrastructure dashboard (Business Charts panel,
// "getOption" code). Five columns: frontends, app tier, API tier, shared data
// plane, core cells. Every running thing gets a box: each frontend wherever
// it is served (the app UI and SMD from S3 behind CloudFront, or as a
// container on a cell), each load balancer, each ECS task (state, health,
// uptime, cpu, memory, network, and a row per container), each Aurora
// instance, each core cell (a row per process and per container). Arrows
// follow the request path. Drawn with absolutely positioned graphic elements
// (a graph series rescales coordinates to its own bounding box, which breaks
// the column alignment). Embedded into infrastructure-map.json by
// scripts/embed-tier-map.py; edit this file, not the JSON.
//
// Data sources: the panel is "-- Mixed --" (with a single panel data source
// Grafana sends every query to it). The Logs Insights query uses its own
// CloudWatch data source: sharing one with the metric queries gives both
// requests the same request id, and the frontend cancels the in-flight
// Logs StartQuery when the metrics request goes out.
//
// CloudWatch knows a CloudFront distribution only by its id. The hidden
// dashboard variable frontend_labels names them ("E123ABC=SMD,E456DEF=App
// UI"); an unnamed distribution is shown as the app UI.
//
// Queries (refIds):
//   tasks      Logs Insights over the Container Insights performance groups:
//              latest task and container figures, health and status, and the
//              last-seen time per Type, ClusterName, TaskId, ContainerName
//   cdn        AWS/CloudFront Requests (Sum), DistributionId = *, Region = Global
//   cdnBytes   AWS/CloudFront BytesDownloaded (Sum), same dimensions
//   cdn4xx     AWS/CloudFront 4xxErrorRate (Average), same dimensions
//   cdn5xx     AWS/CloudFront 5xxErrorRate (Average), same dimensions
//   alb        AWS/ApplicationELB RequestCount (Sum), LoadBalancer = *
//   healthy    AWS/ApplicationELB HealthyHostCount, TargetGroup = *, LoadBalancer = *
//   unhealthy  AWS/ApplicationELB UnHealthyHostCount, same dimensions
//   rds        AWS/RDS CPUUtilization, DBInstanceIdentifier = *
//   lag        AWS/RDS AuroraReplicaLag (only readers publish it)
//   procs      Prometheus up{job=~<cell processes>}
//   lease      Prometheus strato_writer_lease_held
//   height     Prometheus strato_best_block_number
//   containers STRATO/Cell ContainerUp, Cell = *, Container = * (published
//              each minute by strato-cell-containers on the cell)

const ctx = typeof context !== "undefined" ? context : null;
const panelData = ctx ? ctx.panel.data : data;
const chart = ctx ? ctx.panel.chart : echartsInstance;
const frames = (panelData && panelData.series) || [];
const NOW = Date.now();

// --- Frame helpers ---
const values = (field) => {
  if (!field || !field.values) return [];
  const v = field.values;
  return typeof v.toArray === "function" ? v.toArray() : Array.from(v);
};
const numeric = (x) => x !== null && x !== undefined && x !== "" && !Number.isNaN(Number(x));
const label = (frame, key) => {
  const field = frame.fields.find((f) => f.labels && f.labels[key]);
  if (field) return field.labels[key];
  const num = frame.fields.find((f) => f.type === "number") || {};
  const display = num.config || {};
  const m = (display.displayName || display.displayNameFromDS || frame.name || "").match(new RegExp(key + "=\"?([^\",}]+)"));
  return m ? m[1] : "";
};
// Latest non-null point of a metric frame: { t (ms), v }.
const lastPoint = (frame) => {
  const tf = frame.fields.find((f) => f.type === "time");
  const nf = frame.fields.find((f) => f.type === "number");
  const tv = values(tf), nv = values(nf);
  for (let i = nv.length - 1; i >= 0; i--) if (numeric(nv[i])) return { t: tv.length ? Number(tv[i]) : NOW, v: Number(nv[i]) };
  return null;
};
const fresh = (point, minutes) => !!point && NOW - point.t <= minutes * 60000;
const numbersOf = (frame) => values(frame.fields.find((f) => f.type === "number")).filter(numeric).map(Number);
const total = (frame) => numbersOf(frame).reduce((a, b) => a + b, 0);
const average = (frame) => {
  const v = numbersOf(frame);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const toMs = (x) => (numeric(x) ? Number(x) : Date.parse(String(x)));
// Logs Insights "stats ... by" rows, whichever shape the data source returns:
// one table with a column per group key and value, or one frame per group
// with the group keys as labels on its fields.
const rowsFrom = (frame) => {
  const fields = frame.fields;
  if (fields.some((f) => f.name === "TaskId" || f.name === "ClusterName")) {
    const n = Math.max(0, ...fields.map((f) => values(f).length));
    return Array.from({ length: n }, (_, i) => Object.fromEntries(fields.map((f) => [f.name, values(f)[i]])));
  }
  const row = {};
  for (const f of fields) {
    if (f.labels) Object.assign(row, f.labels);
    if (f.type !== "time") {
      const v = values(f);
      row[f.name] = v[v.length - 1];
    }
  }
  return [row];
};
const byRef = (ref) => frames.filter((f) => f.refId === ref);
const pct = (x) => (numeric(x) ? `${Math.round(x)}%` : "");
// "strato-app-testnet" -> app, "strato-api-testnet" -> api. Matched as a
// whole dash-separated word: ALB dimension values start with "app/" (the
// load balancer type), which a plain substring test takes for the app tier.
const tierOf = (name) => (/(^|-)app(-|$)/i.test(name) ? "app" : /(^|-)api(-|$)/i.test(name) ? "api" : null);
const rate = (bytesPerSecond) => {
  if (!numeric(bytesPerSecond)) return "?";
  const b = Number(bytesPerSecond);
  return b < 1024 ? `${Math.round(b)} B/s` : b < 1048576 ? `${(b / 1024).toFixed(1)} kB/s` : `${(b / 1048576).toFixed(1)} MB/s`;
};
const size = (bytes) => (bytes < 1048576 ? `${Math.round(bytes / 1024)} kB` : `${(bytes / 1048576).toFixed(1)} MB`);
const duration = (ms) => {
  if (!numeric(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
};

// --- ECS tasks (app and API tiers) ---
const entries = new Map();
for (const frame of byRef("tasks")) {
  for (const r of rowsFrom(frame)) {
    if (!r.TaskId || !r.ClusterName) continue;
    const key = `${r.ClusterName}/${r.TaskId}`;
    if (!entries.has(key)) entries.set(key, { cluster: String(r.ClusterName), task: String(r.TaskId), seen: 0, taskRow: null, containers: [] });
    const e = entries.get(key);
    if (numeric(toMs(r.seen))) e.seen = Math.max(e.seen, toMs(r.seen));
    if (r.Type === "Task" || !r.ContainerName) e.taskRow = r;
    else e.containers.push(r);
  }
}
// A stopped task simply stops reporting, and Container Insights delivers
// each minute's batch two to three minutes late, so an absolute cutoff
// either keeps stopped tasks or drops live ones. Running tasks of a cluster
// report within about a minute of each other; a stopped one falls a batch
// further behind every minute. Keep a task whose latest report is within
// 100 s of the newest report in its cluster (and that cluster reported in
// the last fifteen minutes).
const clusterSeen = new Map();
for (const e of entries.values()) if (e.seen) clusterSeen.set(e.cluster, Math.max(clusterSeen.get(e.cluster) || 0, e.seen));
const current = (e) => {
  if (!e.seen) return true;
  const newest = clusterSeen.get(e.cluster);
  return NOW - newest <= 15 * 60000 && newest - e.seen <= 100000;
};
const containerOrder = ["nginx", "backend", "strato-api", "postgrest", "apex", "docs", "otel-collector"];
const tiers = { app: [], api: [] };
for (const e of entries.values()) {
  const tier = tierOf(e.cluster);
  if (!tier || !current(e)) continue;
  const t = e.taskRow || {};
  e.containers.sort((a, b) => containerOrder.indexOf(a.ContainerName) - containerOrder.indexOf(b.ContainerName));
  const healths = e.containers.map((c) => String(c.health || "UNKNOWN").toUpperCase());
  const unhealthy = healths.includes("UNHEALTHY");
  const checked = healths.includes("HEALTHY");
  // Container Insights keeps reporting a new task (and its containers) as
  // PENDING for about ten minutes after ECS has it running and healthy, so
  // pending reads as starting, not down; red is for failed health checks and
  // tasks on their way out.
  const rawStatus = String(t.taskStatus || (e.containers[0] || {}).containerStatus || "RUNNING").toLowerCase();
  const starting = ["pending", "provisioning", "activating"].includes(rawStatus);
  const status = starting ? "starting" : rawStatus;
  const running = rawStatus === "running" || starting;
  const cpuUsed = numeric(t.cpu) ? Number(t.cpu) : e.containers.reduce((s, c) => s + (numeric(c.cpu) ? Number(c.cpu) : 0), 0);
  const cpuReserved = numeric(t.cpuReserved) ? Number(t.cpuReserved) : numeric((e.containers[0] || {}).cpuReserved) ? Number(e.containers[0].cpuReserved) : null;
  const cpuPct = cpuReserved ? (100 * cpuUsed) / cpuReserved : null;
  const memUsed = numeric(t.mem) ? Number(t.mem) : e.containers.reduce((s, c) => s + (numeric(c.mem) ? Number(c.mem) : 0), 0);
  const memReserved = numeric(t.memReserved) ? Number(t.memReserved) : null;
  const up = numeric(toMs(t.created)) ? duration(NOW - toMs(t.created)) : "";
  const healthText = unhealthy ? "unhealthy" : checked ? "healthy" : "no health check";
  tiers[tier].push({
    kind: "task",
    ok: running && !unhealthy,
    title: `ECS task ${e.task.slice(0, 8)}`,
    subtitle: [status, healthText, up && `up ${up}`].filter(Boolean).join(" · "),
    sub: [
      { name: "cpu", detail: cpuPct === null ? "?" : `${cpuPct < 1 ? cpuPct.toFixed(1) : Math.round(cpuPct)}% of ${cpuReserved / 1024} vCPU`, ok: cpuPct === null || cpuPct < 85 },
      { name: "memory", detail: memReserved ? `${Math.round(memUsed)} / ${Math.round(memReserved)} MB` : `${Math.round(memUsed)} MB`, ok: !memReserved || memUsed / memReserved < 0.9 },
      { name: "network", detail: `${rate(t.rx)} in · ${rate(t.tx)} out`, ok: true },
      { header: true, name: `containers  ${healths.filter((h) => h !== "UNHEALTHY").length}/${e.containers.length} ok` },
      ...e.containers.map((c) => {
        const h = String(c.health || "UNKNOWN").toUpperCase();
        const rawC = String(c.containerStatus || "RUNNING").toLowerCase();
        const cStarting = ["pending", "provisioning", "activating"].includes(rawC);
        const cStatus = cStarting ? "starting" : rawC;
        const text = h === "HEALTHY" ? "healthy" : h === "UNHEALTHY" ? "unhealthy" : cStatus;
        return { name: String(c.ContainerName), detail: `${text} · ${numeric(c.mem) ? Math.round(Number(c.mem)) : "?"} MB`, ok: h !== "UNHEALTHY" && (rawC === "running" || cStarting) };
      }),
    ],
  });
}

// --- Load balancers ---
const edges = { app: [], api: [] };
const lbs = new Map();
for (const f of byRef("alb")) {
  const lb = label(f, "LoadBalancer");
  const lbName = lb.split("/")[1] || lb;
  const tier = tierOf(lbName);
  if (!lb || !tier) continue;
  lbs.set(lb, { kind: "lb", tier, title: `Load balancer ${lbName}`, subtitle: `${Math.round(total(f))} requests in range`, healthy: 0, unhealthy: 0, reported: false, sub: [] });
}
for (const [ref, keyName] of [["healthy", "healthy"], ["unhealthy", "unhealthy"]]) {
  for (const f of byRef(ref)) {
    const lb = lbs.get(label(f, "LoadBalancer"));
    const p = lastPoint(f);
    // Replaced target groups keep their old datapoints; only current ones count.
    if (!lb || !fresh(p, 15)) continue;
    lb[keyName] += p.v;
    lb.reported = true;
  }
}
for (const lb of lbs.values()) {
  lb.sub = lb.reported
    ? [{ name: "healthy targets", detail: String(Math.round(lb.healthy)), ok: lb.healthy > 0 }, { name: "unhealthy targets", detail: String(Math.round(lb.unhealthy)), ok: lb.unhealthy === 0 }]
    : [{ name: "target health", detail: "no data", ok: false }];
  edges[lb.tier].push(lb);
}

// --- Frontends: the app UI and SMD, wherever they are served ---
const frontends = [];
let labelSpec = "";
try {
  const replace = ctx && ctx.grafana && ctx.grafana.replaceVariables;
  labelSpec = typeof replace === "function" ? String(replace("${frontend_labels}")) : "";
} catch (e) {
  labelSpec = "";
}
if (labelSpec.includes("$")) labelSpec = "";
const cdnNames = new Map(
  labelSpec
    .split(",")
    .map((pair) => pair.split("=").map((s) => s.trim()))
    .filter((pair) => pair.length === 2 && pair[0] && pair[1]),
);
const appOf = (name) => (/smd/i.test(name) ? "smd" : "app-ui");
const cdns = new Map();
const cdnFor = (id) => {
  if (!cdns.has(id)) cdns.set(id, { id, requests: 0, bytes: 0, e4: null, e5: null });
  return cdns.get(id);
};
for (const f of byRef("cdn")) if (label(f, "DistributionId")) cdnFor(label(f, "DistributionId")).requests = total(f);
for (const f of byRef("cdnBytes")) if (label(f, "DistributionId")) cdnFor(label(f, "DistributionId")).bytes = total(f);
for (const f of byRef("cdn4xx")) if (label(f, "DistributionId")) cdnFor(label(f, "DistributionId")).e4 = average(f);
for (const f of byRef("cdn5xx")) if (label(f, "DistributionId")) cdnFor(label(f, "DistributionId")).e5 = average(f);
for (const c of cdns.values()) {
  const name = cdnNames.get(c.id) || "App UI";
  frontends.push({
    kind: "frontend",
    app: appOf(name),
    where: "cdn",
    title: name,
    subtitle: `S3 via CloudFront ${c.id}`,
    sub: [
      { name: "requests in range", detail: String(Math.round(c.requests)), ok: true },
      { name: "5xx errors", detail: c.e5 === null ? "?" : `${c.e5.toFixed(1)}%`, ok: c.e5 === null || c.e5 < 5 },
      { name: "4xx errors", detail: c.e4 === null ? "?" : `${c.e4.toFixed(1)}%`, ok: c.e4 === null || c.e4 < 25 },
      { name: "served in range", detail: size(c.bytes), ok: true },
    ],
  });
}

// --- Shared data plane: Aurora writer and readers ---
const readerIds = new Set(byRef("lag").map((f) => label(f, "DBInstanceIdentifier")).filter(Boolean));
const dataPlane = byRef("rds")
  .map((f) => {
    const id = label(f, "DBInstanceIdentifier");
    const role = readerIds.has(id) ? "reader" : "writer";
    const p = lastPoint(f);
    return { kind: "db", role, title: `Aurora ${role}`, subtitle: id, sub: [{ name: "cpu", detail: pct(p && p.v), ok: fresh(p, 15) }] };
  })
  .sort((a, b) => (a.role === "writer" ? 0 : 1) - (b.role === "writer" ? 0 : 1));

// --- Core cells: processes (Prometheus) and containers (STRATO/Cell) ---
const cells = new Map();
const hostOf = (instance) => String(instance || "").replace(/:\d+$/, "");
const shortHost = (host) => host.replace(/\..*$/, "");
const cellFor = (host) => {
  if (!cells.has(host)) cells.set(host, { kind: "cell", title: `Core cell ${shortHost(host)}`, host, writer: false, height: null, procs: [], containers: [] });
  return cells.get(host);
};
for (const f of byRef("procs")) {
  const host = hostOf(label(f, "instance"));
  // The node's Prometheus scrapes strato-api under the job name core-api.
  const job = label(f, "job") === "core-api" ? "strato-api" : label(f, "job");
  if (!host || !job) continue;
  const up = (lastPoint(f) || {}).v === 1;
  // strato-ingest and vm-query run only when a cell is configured for them,
  // but their ports are scraped regardless: down there means not deployed.
  if ((job === "strato-ingest" || job === "vm-query") && !up) continue;
  cellFor(host).procs.push({ name: job, detail: up ? "up" : "down", ok: up });
}
// The app UI and SMD containers of a full node are frontends: they go to
// the first column (served by the cell's nginx), not into the cell's box.
const frontendContainers = { "app-ui": "App UI", smd: "SMD" };
for (const f of byRef("containers")) {
  const host = label(f, "Cell");
  const name = label(f, "Container");
  const p = lastPoint(f);
  // A removed container stops publishing; only the last ten minutes count.
  if (!host || !name || !fresh(p, 10)) continue;
  const running = p.v === 1;
  if (frontendContainers[name]) {
    frontends.push({ kind: "frontend", app: name, where: "cell", host, title: frontendContainers[name], subtitle: `container on ${shortHost(host)}, served by its nginx`, sub: [{ name: "container", detail: running ? "running" : "stopped", ok: running }] });
    continue;
  }
  cellFor(host).containers.push({ name, detail: running ? "running" : "stopped", ok: running });
}
for (const f of byRef("lease")) {
  const host = hostOf(label(f, "instance"));
  if (cells.has(host) && (lastPoint(f) || {}).v === 1) cells.get(host).writer = true;
}
for (const f of byRef("height")) {
  const host = hostOf(label(f, "instance"));
  if (cells.has(host)) cells.get(host).height = (lastPoint(f) || {}).v;
}
const processOrder = ["ethereum-discover", "strato-p2p", "strato-sequencer", "vm-runner", "strato-indexer", "slipstream", "strato-api", "ethereum-jsonrpc", "vm-query", "strato-ingest"];
// A core cell (no nginx container) runs no strato-api or ethereum-jsonrpc,
// but the node Prometheus scrapes them regardless: down there means not
// deployed. A full node, which has nginx, still shows them red when down.
for (const c of cells.values()) {
  if (c.containers.length && !c.containers.some((k) => k.name === "nginx")) {
    c.procs = c.procs.filter((p) => p.ok || !["strato-api", "ethereum-jsonrpc"].includes(p.name));
  }
}
const cellItems = Array.from(cells.values()).map((c) => {
  c.procs.sort((a, b) => processOrder.indexOf(a.name) - processOrder.indexOf(b.name));
  c.containers.sort((a, b) => a.name.localeCompare(b.name));
  c.subtitle = [c.writer ? "writer" : "standby", c.height ? `block ${c.height}` : ""].filter(Boolean).join(", ");
  c.sub = [
    ...(c.procs.length ? [{ header: true, name: `processes  ${c.procs.filter((p) => p.ok).length}/${c.procs.length} up` }, ...c.procs] : []),
    ...(c.containers.length ? [{ header: true, name: `containers  ${c.containers.filter((p) => p.ok).length}/${c.containers.length} running` }, ...c.containers] : []),
  ];
  return c;
});

// A frontend with no CloudFront deployment (or no traffic in the range,
// which CloudWatch cannot tell apart) still gets a box, so the gap shows.
for (const [app, title] of [["app-ui", "App UI"], ["smd", "SMD"]]) {
  if (!frontends.some((f) => f.app === app && f.where === "cdn")) {
    frontends.push({ kind: "frontend", app, where: "none", missing: true, title, subtitle: "no CloudFront deployment with traffic in range", sub: [{ name: "S3 + CloudFront", detail: "not seen", ok: true, neutral: true }] });
  }
}
const whereOrder = { cdn: 0, cell: 1, none: 2 };
frontends.sort((a, b) => (a.app === b.app ? whereOrder[a.where] - whereOrder[b.where] : a.app === "app-ui" ? -1 : 1));

// --- Palette (Grafana dark theme) ---
const ink = "#d0d7de", dim = "#8b949e", green = "#3fb950", red = "#f85149", amber = "#d29922", blue = "#58a6ff", violet = "#a371f7", absent = "#6e7681";
const columnFill = "rgba(110,118,129,0.08)", columnStroke = "rgba(110,118,129,0.30)", boxFill = "rgba(22,27,34,0.92)";

// --- Layout (pixels) ---
const W = chart ? chart.getWidth() : 1200;
const H = chart ? chart.getHeight() : 600;
const columns = [
  { title: "Frontends", items: frontends, empty: "nothing reporting" },
  { title: "App tier", items: [...edges.app, ...tiers.app], empty: "nothing reporting" },
  { title: "API tier", items: [...edges.api, ...tiers.api], empty: "nothing reporting" },
  { title: "Shared data plane", items: dataPlane, empty: "no Aurora metrics" },
  { title: "Core cells", items: cellItems, empty: "no cell metrics" },
];
const gutter = 12, colGap = 10, headerH = 28, legendH = 26;
const colW = (W - 2 * gutter - (columns.length - 1) * colGap) / columns.length;
const boxW = Math.min(colW - 36, 300);
const heightOf = (it, k) => k * (34 + (it.subtitle ? 14 : 0) + it.sub.length * 20 + 8);
const avail = H - headerH - legendH - 20;
const scale = Math.min(1, ...columns.map((c) => (c.items.length ? avail / c.items.reduce((s, it) => s + heightOf(it, 1) + 16, 0) : 1)));
const headH = 34 * scale, subtitleH = 14 * scale, subH = 20 * scale, pad = 8 * scale, gap = 16 * scale;
const fontHead = Math.max(9, Math.round(13 * scale)), fontSub = Math.max(8, Math.round(11 * scale));

const graphic = [];
const anchors = columns.map(() => []);

columns.forEach((col, ci) => {
  const left = gutter + ci * (colW + colGap);
  const cx = left + colW / 2 + 8;
  graphic.push({ type: "rect", left, top: headerH, z: 0, shape: { width: colW, height: H - headerH - legendH, r: 6 }, style: { fill: columnFill, stroke: columnStroke, lineWidth: 1 } });
  graphic.push({ type: "text", left: left + 10, top: 6, z: 1, style: { text: `${col.title}  ·  ${col.items.length}`, fill: ink, font: "600 14px sans-serif" } });
  if (!col.items.length) {
    graphic.push({ type: "text", left: left + 14, top: headerH + 16, z: 1, style: { text: col.empty, fill: dim, font: "12px sans-serif" } });
    return;
  }
  let y = headerH + 14;
  col.items.forEach((item) => {
    const titleBlock = headH + (item.subtitle ? subtitleH : 0);
    const boxH = titleBlock + item.sub.length * subH + pad;
    const x = cx - boxW / 2;
    const rows = item.sub.filter((s) => !s.header);
    const allOk = item.ok !== undefined ? item.ok && rows.every((s) => s.ok) : rows.every((s) => s.ok);
    const edge = item.kind === "lb" || (item.kind === "frontend" && item.where === "cdn");
    const border = item.missing ? absent : item.role === "writer" || item.writer ? amber : item.role === "reader" ? blue : edge ? (allOk ? violet : red) : allOk ? green : red;
    graphic.push({ type: "rect", left: x, top: y, z: 2, shape: { width: boxW, height: boxH, r: 5 }, style: { fill: boxFill, stroke: border, lineWidth: 2, lineDash: item.missing ? [5, 4] : null } });
    graphic.push({ type: "text", left: x + 10, top: y + 8 * scale, z: 3, style: { text: item.title, fill: item.missing ? dim : ink, font: `600 ${fontHead}px sans-serif`, width: boxW - 20, overflow: "truncate" } });
    if (item.subtitle) graphic.push({ type: "text", left: x + 10, top: y + 8 * scale + fontHead + 3, z: 3, style: { text: item.subtitle, fill: border === green || border === violet || border === absent ? dim : border, font: `${fontSub}px sans-serif`, width: boxW - 20, overflow: "truncate" } });
    item.sub.forEach((s, si) => {
      const sy = y + titleBlock + si * subH;
      const textTop = sy + (subH - 3 - fontSub) / 2;
      if (s.header) {
        graphic.push({ type: "text", left: x + 10, top: textTop, z: 4, style: { text: s.name, fill: dim, font: `600 ${fontSub}px sans-serif` } });
        return;
      }
      const fill = s.neutral ? "rgba(110,118,129,0.10)" : s.ok ? "rgba(63,185,80,0.12)" : "rgba(248,81,73,0.22)";
      const stroke = s.neutral ? "rgba(110,118,129,0.45)" : s.ok ? "rgba(63,185,80,0.55)" : red;
      graphic.push({ type: "rect", left: x + 8, top: sy, z: 3, shape: { width: boxW - 16, height: subH - 3, r: 3 }, style: { fill, stroke, lineWidth: 1 } });
      // Split the row between name and value by the value's length, so a short
      // value ("up") leaves the name its full width.
      const detailW = Math.min(boxW - 110, Math.ceil(String(s.detail || "").length * fontSub * 0.58) + 8);
      const nameW = boxW - 32 - detailW;
      graphic.push({ type: "text", left: x + 16, top: textTop, z: 4, style: { text: s.name, fill: s.neutral ? dim : ink, font: `${fontSub}px sans-serif`, width: nameW, overflow: "truncate" } });
      if (s.detail) graphic.push({ type: "text", right: W - (x + boxW - 16), top: textTop, z: 4, style: { text: s.detail, fill: s.ok ? dim : red, font: `${fontSub}px sans-serif`, textAlign: "right", width: detailW, overflow: "truncate" } });
    });
    anchors[ci].push({ item, left: x, right: x + boxW, top: y, bottom: y + boxH, mid: y + Math.min(boxH, titleBlock + subH) / 2 + 4 });
    y += boxH + gap;
  });
});

// --- Arrows ---
const head = (x, y, dir, color) => graphic.push({ type: "polygon", z: 5, silent: true, shape: { points: [[x, y], [x - dir * 8, y - 4], [x - dir * 8, y + 4]] }, style: { fill: color } });
// Between columns: a horizontal S-curve.
const across = (x1, y1, x2, y2, color, dashed, lift) => {
  const dx = (x2 - x1) * 0.5;
  graphic.push({ type: "bezierCurve", z: 1, silent: true, shape: { x1, y1, x2, y2, cpx1: x1 + dx, cpy1: y1 + (lift || 0), cpx2: x2 - dx, cpy2: y2 + (lift || 0) }, style: { stroke: color, lineWidth: 1.4, lineDash: dashed ? [5, 4] : null, fill: null, opacity: 0.85 } });
  head(x2, y2, x2 >= x1 ? 1 : -1, color);
};
// Within a column: out of the left edge of one box and into the left edge of a lower one.
const down = (x, y1, y2, color) => {
  graphic.push({ type: "bezierCurve", z: 1, silent: true, shape: { x1: x, y1, x2: x, y2, cpx1: x - 26, cpy1: y1, cpx2: x - 26, cpy2: y2 }, style: { stroke: color, lineWidth: 1.4, fill: null, opacity: 0.85 } });
  head(x, y2, 1, color);
};
const [feCol, appCol, apiCol, dbCol, coreCol] = anchors;
const kind = (col, k) => col.filter((a) => a.item.kind === k);
const appLb = kind(appCol, "lb"), appTasks = kind(appCol, "task");
const apiLb = kind(apiCol, "lb"), apiTasks = kind(apiCol, "task");
// CloudFront serves each UI from S3 and sends its API, login and RPC paths to
// the tier behind it: the app UI's to the app load balancer, the SMD's to the
// API tier's.
for (const f of feCol.filter((a) => a.item.where === "cdn")) {
  for (const l of f.item.app === "smd" ? apiLb : appLb) across(f.right, f.mid, l.left, l.mid, violet);
}
// A frontend container on a cell is served by that cell's nginx, which also
// fronts the cell's own app backend and strato-api.
for (const f of feCol.filter((a) => a.item.where === "cell")) {
  const cell = coreCol.find((c) => c.item.host === f.item.host);
  if (cell) across(f.right, f.mid, cell.left, cell.mid - 8, dim);
}
for (const l of appLb) for (const t of appTasks) down(l.left, l.mid + 8, t.mid, violet);
// The app backend calls the API tier through its load balancer (or the tasks directly when none reports).
const apiEntry = apiLb.length ? apiLb : apiTasks;
for (const t of appTasks) for (const e of apiEntry) across(t.right, t.mid, e.left, e.mid, dim);
for (const l of apiLb) for (const t of apiTasks) down(l.left, l.mid + 8, t.mid, violet);
for (const t of apiTasks) for (const d of dbCol) across(t.right, t.mid, d.left, d.mid, d.item.role === "writer" ? amber : blue);
const writerCell = coreCol.find((c) => c.item.writer);
if (writerCell) for (const t of apiTasks) across(t.right, t.mid + 10, writerCell.left, writerCell.mid, dim, true, -60);
const writerDb = dbCol.find((d) => d.item.role === "writer");
if (writerDb) for (const c of coreCol) across(c.left, c.mid + 12, writerDb.right, writerDb.mid + 12, amber);

// --- Legend ---
const legend = [["writer", amber], ["reader", blue], ["edge (CloudFront, load balancer)", violet], ["up / healthy", green], ["down / unhealthy", red], ["not deployed", absent], ["transaction submit to the writer cell", dim]];
let lx = gutter + 10;
for (const [text, color] of legend) {
  graphic.push({ type: "rect", left: lx, top: H - 18, z: 6, shape: { width: 10, height: 10, r: 2 }, style: { fill: color } });
  graphic.push({ type: "text", left: lx + 14, top: H - 20, z: 6, style: { text, fill: dim, font: "11px sans-serif" } });
  lx += 34 + text.length * 6.1;
}

return { backgroundColor: "transparent", animation: false, graphic, series: [] };
