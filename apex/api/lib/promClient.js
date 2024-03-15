const {
  getContentType,
  getSummary,
  Prometheus,
  createMiddleware,
} = require("@promster/express");
const winston = require("winston-color");
const models = require("../models");
const moment = require("moment");

//Register the custom metrics for system info
const sysMemoryUsageGauge = new Prometheus.Gauge({
  name: "system_memory_usage_percent",
  help: "System Memory Usage Percentage",
});
const sysFreeMemoryGauge = new Prometheus.Gauge({
  name: "system_memory_free",
  help: "Free System Memory",
});
const sysCpuAvgLoadGauge = new Prometheus.Gauge({
  name: "system_cpu_avg_load",
  help: "System CPU Average Load",
});
const sysCpuCurrentLoadGauge = new Prometheus.Gauge({
  name: "system_cpu_current_load",
  help: "System CPU Current Load",
});
const sysDiskSpaceUsageGauge = new Prometheus.Gauge({
  name: "system_disk_space_usage_percent",
  help: "System Disk Space Usage Percentage",
  labelNames: ["name"],
});
const sysNetworkRxBytesGauge = new Prometheus.Gauge({
  name: "system_network_rx_bytes",
  help: "System Network RX Bytes",
  labelNames: ["name"],
});
const sysNetworkTxBytesGauge = new Prometheus.Gauge({
  name: "system_network_tx_bytes",
  help: "System Network TX Bytes",
  labelNames: ["name"],
});

function attachMetricsEndpoint({ app }) {
  app.use(createMiddleware({ app }));

  app.use("/metrics", async (req, res) => {
    try {
      let result = await models.CurrentHealth.findOne({
        where: { processName: "SystemInfoStat" },
      });
      let sysInfo = JSON.parse(result.additionalInfo);
      updatePrometheusSystemMetrics(sysInfo);
    } catch (err) {
      winston.warn(
        `Error ${
          err.message ? err.message : ""
        } occurred while querying system information metrics`
      );
    }

    req.statusCode = 200;
    res.setHeader("Content-Type", getContentType());
    res.end(await getSummary());
  });
}

function updatePrometheusSystemMetrics(sysInfoCollected) {
  winston.info("Updating Prometheus Systems Metrics at " + moment().format());
  try {
    sysMemoryUsageGauge.set(sysInfoCollected.memory.use.value);
    sysFreeMemoryGauge.set(sysInfoCollected.memory.free);
    sysCpuAvgLoadGauge.set(sysInfoCollected.cpu.avgLoad.value);
    sysCpuCurrentLoadGauge.set(sysInfoCollected.cpu.currentLoad.value);

    sysInfoCollected.filesystem.forEach((fs) => {
      sysDiskSpaceUsageGauge.labels(fs.name).set(fs.use.value);
    });

    sysInfoCollected.networkStats.forEach((nwStat) => {
      sysNetworkRxBytesGauge
        .labels(nwStat.interface)
        .set(nwStat.networkStats_rx_bytes);
      sysNetworkTxBytesGauge
        .labels(nwStat.interface)
        .set(nwStat.networkStats_tx_bytes);
    });

    winston.info(
      "Finished updating Prometheus Systems Metrics at " + moment().format()
    );
  } catch (err) {
    winston.warn(
      `Error ${
        err.message ? err.message : ""
      } occurred while updating System Information Prometheus metrics`
    );
  }
}

module.exports = {
  attachMetricsEndpoint,
  Prometheus,
  metrics: {
    sysMemoryUsageGauge,
    sysFreeMemoryGauge,
    sysCpuAvgLoadGauge,
    sysCpuCurrentLoadGauge,
    sysDiskSpaceUsageGauge,
    sysNetworkRxBytesGauge,
    sysNetworkTxBytesGauge,
  },
};
