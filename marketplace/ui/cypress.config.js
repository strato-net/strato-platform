const { defineConfig } = require("cypress");

module.exports = defineConfig({
  viewportHeight: 768,
  viewportWidth: 1460,
  env: {
    login_url: "https://keycloak.blockapps.net",
    email: "shubham.d@rejolut.com",
    password: "Shubh@m1979",
    sellerEmail: "vijay_rajasekaran@blockapps.net",
    sellerPassword: "Software101",
    certifierEmail: "achin_kumar@blockapps.net",
    certifierPassword: "admin123",
    buyerOrg: "Rejolut Technology Solutions Pvt Limited",
    sellerOrg: "BlockApps",
    singleRoleEmail: "pooja_kamble@blockapps.net",
    singleRolePassword: "pooja",
    dualRoleEmail: "achin_kumar@blockapps.net",
    dualRolePassword: "admin123",
    teEmail: "nitin_gupta@blockapps.net",
    tePassword: "Rubikcube@786",

  },
  retries: {
    runMode: 5,
  },
  pageLoadTimeout: 60000,
  e2e: {
    baseUrl: "http://localhost",
    experimentalSessionAndOrigin: true,
  },
  chromeWebSecurity: false,
});
