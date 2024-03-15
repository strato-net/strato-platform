module.exports = {
  domainWhiteList: [
    "http://localhost:3000",
    "http://localhost:3009",
    "http://localhost",
  ],
  passwordSaltRounds: 10,
  webSockets: {
    dbPollFrequency: 1 * 1000,
  },
  healthCheck: {
    requestTimeout: 3 * 1000,
    pollFrequency: 15 * 1000,
    pollTimeoutsForUnhealthy: 3, // number of timed out polls in a row to consider node unhealthy
    cleanFrequency: 5 * 60 * 1000, //clean db every 5 mins
    retentionHours: 1 * 24,
    stallCheckFrequency: 5 * 60 * 1000,
    memoryUsedAlertLevel: 80, // Alert when used memory (RAM) >= N%
    diskspaceUsedAlertLevel: 80, // Alert when used diskspace >= N%
    cpuAvgLoadAlertLevel: 97, // Alert when cpu avg load > N%
    cpuCurrentLoadAlertLevel: 99, // Alert when cpu current load > N%,
    maxStalledIntervals: 80, //max number of failed stall checks before reporting stalled: 1200 seconds / poll freq (15) = 80, set to 20 minutess
  },
  networkHealthCheck: {
    requestTimeout: 3 * 1000,
    pollFrequency: 15 * 1000,
  },
  // Unused code notice. Node stats disabled, to be deprecated  #node-stats-deprecation
  // statistics: {
  //   apiCallCounterDbSaveTimer: 60 * 1000,
  //   apiCallCounterRetentionHours: 7 * 24,
  //   blockappsStatServerUrl:
  //       process.env.STATS_DEBUG_CUSTOM_SERVER_URL
  //           ? process.env.STATS_DEBUG_CUSTOM_SERVER_URL
  //           : (process.env.NODE_ENV === 'production' ? 'https://statserver.blockapps.net' : 'https://mocked.blockapps.stat.server'),
  //   blockappsStatServerApiPath: '/api/6.0.3',
  //   collectSubmitUTCTimeOfDay: {hours: 4, minutes: 0} // UTC time; there is an additional random delay of up to 4 minutes being added in code
  // },
};
