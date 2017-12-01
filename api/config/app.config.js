module.exports = {
  passwordSaltRounds : 10,
  jwtConfig: {
    jwtSecret: 'JWT_SECRET_PLACEHOLDER', // random string
    jwtAlgorithm: 'HS512',
    jwtValidity: 14, //in days
    authCookieName: 'APEX',
    authCookieSecure: false,
    authCookieDomain: process.env['HOST_NAME'] || '', //if backend hosted on a domain different from the frontend,
    // Development use only
    domainWhiteList: [
      'http://localhost:3000',
      'http://localhost:3001'
    ]
  },
  apps: {
    directory: 'apps'
  },
  webSockets: {
    dbPollFrequency: 1 * 1000
  }
};
