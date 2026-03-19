import * as fs from "fs";
import * as path from "path";
import { LoadTestReport, ScenarioStats, TimelineBucket } from "../types";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function buildSummaryTable(stats: ScenarioStats[]): string {
  if (stats.length === 0) return "<p>No scenario data available.</p>";

  let rows = "";
  for (const s of stats) {
    rows += `
      <tr>
        <td>${s.scenario}</td>
        <td>${s.nodeName}</td>
        <td>${s.totalTxCount}</td>
        <td>${s.successCount}</td>
        <td>${s.failureCount}</td>
        <td>${s.timeoutCount}</td>
        <td>${formatPercent(s.errorRate)}</td>
        <td>${formatDuration(s.submitLatency.p50)} / ${formatDuration(s.submitLatency.p95)} / ${formatDuration(s.submitLatency.p99)}</td>
        <td>${formatDuration(s.confirmLatency.p50)} / ${formatDuration(s.confirmLatency.p95)} / ${formatDuration(s.confirmLatency.p99)}</td>
        <td>${formatDuration(s.totalLatency.p50)} / ${formatDuration(s.totalLatency.p95)} / ${formatDuration(s.totalLatency.p99)}</td>
        <td>${s.submitTps}</td>
        <td>${s.confirmedTps}</td>
        <td>${formatDuration(s.wallClockDuration)}</td>
      </tr>`;
  }

  return `
    <table>
      <thead>
        <tr>
          <th>Scenario</th>
          <th>Node</th>
          <th>Total</th>
          <th>Success</th>
          <th>Failed</th>
          <th>Timeout</th>
          <th>Error Rate</th>
          <th>Submit p50/p95/p99</th>
          <th>Confirm p50/p95/p99</th>
          <th>Total p50/p95/p99</th>
          <th>Submit TPS</th>
          <th>Confirmed TPS</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildErrorTable(errors: LoadTestReport["errors"]): string {
  if (errors.length === 0) return "<p>No errors recorded.</p>";

  let rows = "";
  for (const e of errors.slice(0, 100)) {
    rows += `
      <tr>
        <td title="${e.txHash}">${e.txHash.substring(0, 16)}...</td>
        <td>${e.nodeName}</td>
        <td>${e.scenario}</td>
        <td>${e.error}</td>
      </tr>`;
  }

  return `
    <table>
      <thead>
        <tr><th>Tx Hash</th><th>Node</th><th>Scenario</th><th>Error</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${errors.length > 100 ? `<p>...and ${errors.length - 100} more errors</p>` : ""}`;
}

function buildTimelineData(timeline: TimelineBucket[]): string {
  return JSON.stringify({
    labels: timeline.map((b) => new Date(b.timestamp).toISOString().substring(11, 23)),
    submitted: timeline.map((b) => b.submitted),
    confirmed: timeline.map((b) => b.confirmed),
    failed: timeline.map((b) => b.failed),
  });
}

function buildLatencyData(stats: ScenarioStats[]): string {
  return JSON.stringify({
    labels: stats.map((s) => `${s.scenario} (${s.nodeName})`),
    submitP50: stats.map((s) => s.submitLatency.p50),
    submitP95: stats.map((s) => s.submitLatency.p95),
    confirmP50: stats.map((s) => s.confirmLatency.p50),
    confirmP95: stats.map((s) => s.confirmLatency.p95),
    totalP50: stats.map((s) => s.totalLatency.p50),
    totalP95: stats.map((s) => s.totalLatency.p95),
  });
}

export function writeHtmlReport(report: LoadTestReport, outputDir: string): string {
  fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `report-${timestamp}.html`;
  const filepath = path.join(outputDir, filename);

  const timelineData = buildTimelineData(report.timeline);
  const latencyData = buildLatencyData(report.scenarioStats);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>STRATO Load Test Report - ${report.timestamp}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; padding: 20px; }
    h1 { margin-bottom: 8px; color: #1a1a2e; }
    h2 { margin: 24px 0 12px; color: #16213e; border-bottom: 2px solid #0f3460; padding-bottom: 4px; }
    .meta { color: #666; margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    .card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .card.full { grid-column: 1 / -1; }
    canvas { max-height: 400px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #e0e0e0; }
    th { background: #f8f9fa; font-weight: 600; position: sticky; top: 0; }
    tr:hover { background: #f0f4ff; }
    .overflow { overflow-x: auto; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>STRATO Load Test Report</h1>
  <p class="meta">Generated: ${report.timestamp} | Nodes: ${report.config.nodes.join(", ")} | Polling: ${report.config.polling.interval}ms interval, ${report.config.polling.timeout / 1000}s timeout</p>

  <h2>Summary</h2>
  <div class="overflow">
    ${buildSummaryTable(report.scenarioStats)}
  </div>

  <div class="grid">
    <div class="card">
      <h2>Transaction Timeline</h2>
      <canvas id="timelineChart"></canvas>
    </div>
    <div class="card">
      <h2>Latency Comparison (ms)</h2>
      <canvas id="latencyChart"></canvas>
    </div>
  </div>

  <h2>Errors</h2>
  <div class="overflow">
    ${buildErrorTable(report.errors)}
  </div>

  <script>
    const timelineData = ${timelineData};
    const latencyData = ${latencyData};

    new Chart(document.getElementById('timelineChart'), {
      type: 'line',
      data: {
        labels: timelineData.labels,
        datasets: [
          { label: 'Submitted', data: timelineData.submitted, borderColor: '#3498db', fill: false, tension: 0.2 },
          { label: 'Confirmed', data: timelineData.confirmed, borderColor: '#2ecc71', fill: false, tension: 0.2 },
          { label: 'Failed', data: timelineData.failed, borderColor: '#e74c3c', fill: false, tension: 0.2 },
        ],
      },
      options: {
        responsive: true,
        scales: {
          x: { title: { display: true, text: 'Time' }, ticks: { maxTicksLimit: 20 } },
          y: { title: { display: true, text: 'Transaction Count' }, beginAtZero: true },
        },
      },
    });

    new Chart(document.getElementById('latencyChart'), {
      type: 'bar',
      data: {
        labels: latencyData.labels,
        datasets: [
          { label: 'Submit p50', data: latencyData.submitP50, backgroundColor: '#3498db88' },
          { label: 'Submit p95', data: latencyData.submitP95, backgroundColor: '#3498db' },
          { label: 'Confirm p50', data: latencyData.confirmP50, backgroundColor: '#2ecc7188' },
          { label: 'Confirm p95', data: latencyData.confirmP95, backgroundColor: '#2ecc71' },
          { label: 'Total p50', data: latencyData.totalP50, backgroundColor: '#9b59b688' },
          { label: 'Total p95', data: latencyData.totalP95, backgroundColor: '#9b59b6' },
        ],
      },
      options: {
        responsive: true,
        scales: {
          y: { title: { display: true, text: 'Latency (ms)' }, beginAtZero: true },
        },
      },
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(filepath, html, "utf8");
  console.log(`HTML report written to: ${filepath}`);
  return filepath;
}
