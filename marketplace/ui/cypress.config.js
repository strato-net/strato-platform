const { defineConfig } = require("cypress");

module.exports = defineConfig({
  video: false,
  viewportHeight: 768,
  viewportWidth: 1460,
  retries: {
    runMode: 5,
  },
  pageLoadTimeout: 60000,
  defaultCommandTimeout: 60000,
  e2e: {
    baseUrl: "http://localhost",
    experimentalSessionAndOrigin: true,
  },
  chromeWebSecurity: false,
});
