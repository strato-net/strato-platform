module.exports = {
  passwordSaltRounds: 10,
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
  apps: {
    directory: 'apps'
  },
  webSockets: {
    dbPollFrequency: 1 * 1000
  },
  mixpanel: {
    token: 'd78b8eeb10b9fdb8fb0abca5cdb73639'
  },
  signup: 'https://signup.blockapps.net',
  SMD_MODE: process.env['SMD_MODE'] || 'public',
  s3: {
    bucket: {
      Bucket: "strato-external-storage"
    },
    accessKeyId: "AKIAJWOO7U4OR4YY6ZOA",
    secretAccessKey: "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"
  }
};
