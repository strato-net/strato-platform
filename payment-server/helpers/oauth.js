import oauthHelper from "./oauthHelper.js";

class Admin {
  constructor() {
    this.address = null;
  }

  async bootstrap() {
    let serviceUserToken;
    try {
      const { token } = await oauthHelper.getServiceToken();
      serviceUserToken = token;
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
      this.address = adminResponse.user.address;
    } else {
      throw new Error(`Admin was not created/does not exist. Please check your credential setup.`);
    }
  }

  async getUser() {
    return { token: await oauthHelper.getServiceToken(), address: this.address };
  }
}

const ADMIN = process.env.TEST_MODE !== 'true' ? new Admin() : undefined;

if (process.env.TEST_MODE !== 'true')
  await ADMIN.bootstrap();

export default ADMIN;
