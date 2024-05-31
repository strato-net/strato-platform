import oauthHelper from "./oauthHelper.js";

class Admin {
  constructor() {
    this.token = null;
    this.address = null;
    this.expiration = null;
    this.timer = null;
  }

  async bootstrap() {
    let serviceUserToken;
    let tokenExpiration;
    try {
      const { token, expiration } = await oauthHelper.getServiceToken();
      serviceUserToken = token;
      tokenExpiration = expiration;
    } catch(e) {
      console.error("ERROR: Unable to fetch the service user token, check your OAuth settings in config", e);
      throw e;
    }

    const adminEmail = oauthHelper.getEmailIdFromToken(serviceUserToken);

    console.log("Creating Admin...", adminEmail);
    const adminCredentials = { token: serviceUserToken };
    const adminResponse = await oauthHelper.createStratoUser(
      adminCredentials,
      adminEmail
    );
    if (adminResponse.status === 200) {
      console.log("Admin successfully created!");
      this.token = adminResponse.user.token;
      this.address = adminResponse.user.address;
      this.expiration = tokenExpiration;

      // Schedule token refresh for 30 seconds before expiration
      this._scheduleTokenRefresh((tokenExpiration - 30) * 1000);
    } else {
      throw new Error(`Admin was not created/does not exist. Please check your credential setup.`);
    }
  }

  getUser() {
    return { token: this.token, address: this.address };
  }

  async _refreshToken() {
    console.log("Refreshing token...");
    try {
      const { token, expiration } = await oauthHelper.getServiceToken();
      this.token = token;
      this.expiration = expiration;
      
      // Schedule new token refresh for 30 seconds before expiration
      this._scheduleTokenRefresh((expiration - 30) * 1000);
    } catch(e) {
      console.error("ERROR: Unable to update the token, check your OAuth settings in config", e);
      throw e;
    }
  }

  _scheduleTokenRefresh(t) {
    setTimeout(async () => {
      await this._refreshToken().catch(e => {
          console.log("Error updating token before expiration", e);
      });
    }, t);
  }
}

const ADMIN = process.env.TEST_MODE !== 'true' ? new Admin() : undefined;

if (process.env.TEST_MODE !== 'true')
  await ADMIN.bootstrap();

export default ADMIN;