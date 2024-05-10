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

      // Schedule token refresh for 5 minutes before expiration
      this._scheduleTokenRefresh(tokenExpiration - 5 * 60 * 1000); 
    } else {
      throw new Error(`Admin was not created/does not exist. Please check your credential setup.`);
    }
  }

  getUser() {
    return { token: this.token, address: this.address };
  }

  async _refreshToken() {
    try {
      const { token, expiration } = await oauthHelper.getServiceToken();
      this.token = token;
      this.expiration = expiration;
      
      // Schedule new token refresh for 5 minutes before expiration
      this._scheduleTokenRefresh(expiration - 5 * 60 * 1000);
    } catch(e) {
      console.error("ERROR: Unable to update the token, check your OAuth settings in config", e);
      throw e;
    }
  }

  _scheduleTokenRefresh(t) {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(async () => {
      await this._refreshToken().catch(e => {
          console.log("Error updating token before expiration", e);
      });
      this.timer = null;
    }, t);
  }
}

const ADMIN = new Admin();

await ADMIN.bootstrap();

export default ADMIN;