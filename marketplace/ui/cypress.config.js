const { defineConfig } = require('cypress');

module.exports = defineConfig({
  video: false,
  viewportHeight: 768,
  viewportWidth: 1460,
  retries: {
    runMode: 5,
  },
  pageLoadTimeout: 90000,
  defaultCommandTimeout: 90000,
  e2e: {
    baseUrl: 'http://localhost',
    experimentalSessionAndOrigin: true,
  },
  chromeWebSecurity: false,
  experimentalModifyObstructiveThirdPartyCode: true,
});
