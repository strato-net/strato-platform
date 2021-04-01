module.exports = {
  apps: {
      directory: 'apps'
  },
  jwtConfig: {
    jwtSecret: 'JWT_SECRET_PLACEHOLDER', // random string
    jwtAlgorithm: 'HS512',
    jwtValidity: 14, //in days
    authCookieName: 'STRATO',
    authCookieSecure: false,
    authCookieDomain: process.env['HOST_NAME'] || '', //if backend hosted on a domain different from the frontend,
    // Development use only
    domainWhiteList: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost',
    ]
  },
  mixpanel: {
      token: 'd78b8eeb10b9fdb8fb0abca5cdb73639'
  },
  oAuthEnabledTrueValue: "true",
  passwordSaltRounds: 10,
  s3: {
    bucket: {
      Bucket: process.env.EXT_STORAGE_S3_BUCKET
    },
    accessKeyId: process.env.EXT_STORAGE_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.EXT_STORAGE_S3_SECRET_ACCESS_KEY
  },
  SMD_MODE: process.env['SMD_MODE'] || 'enterprise',
  webSockets: {
    dbPollFrequency: 1 * 1000
  },
  healthCheck: {
    requestTimeout: 3 * 1000,
    pollFrequency: 15 * 1000,
    pollTimeoutsForUnhealthy: 3, // number of timed out polls in a row to consider node unhealthy
    cleanFrequency: 5 * 60 * 1000, //clean db every 5 mins
    retentionHours: 1 * 24,
    stallCheckProgressWindow: 10 * 60 * 1000,
    memoryUsageBound: 20, // Alert when available space / total space < 20%
    diskUsageBound: 20,
  },
  statistics: {
    apiCallCounterDbSaveTimer: 60 * 1000,
    apiCallCounterRetentionHours: 7 * 24,
    blockappsStatServerUrl:
        process.env.STATS_DEBUG_CUSTOM_SERVER_URL 
            ? process.env.STATS_DEBUG_CUSTOM_SERVER_URL
            : (process.env.NODE_ENV === 'production' ? 'https://statserver.blockapps.net' : 'https://mocked.blockapps.stat.server'),
    blockappsStatServerApiPath: '/api/6.0.3',
    collectSubmitUTCTimeOfDay: {hours: 4, minutes: 0} // UTC time; there is an additional random delay of up to 4 minutes being added in code
  },
};
