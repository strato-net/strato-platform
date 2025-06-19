import { assert } from 'blockapps-rest';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';
import oauthHelper from '../../../helpers/oauthHelper';
import dappJs from '../dapp';

const testName = 'deploy.test';
const options = { config, name: testName, logger: console };

describe('E2E tests', function () {
  this.timeout(config.timeout);
  let admin;
  let adminCredentials;
  let dapp;
  let mainChainContract;
  const members = [];
  before(async () => {
    assert.isDefined(
      config.configDirPath,
      'configDirPath is  missing. Set in config'
    );
    assert.isDefined(
      config.deployFilename,
      'deployFilename is missing. Set in config'
    );
    assert.isDefined(
      process.env.GLOBAL_ADMIN_NAME,
      'GLOBAL_ADMIN_NAME is missing. Add it to .env file'
    );
    assert.isDefined(
      process.env.GLOBAL_ADMIN_PASSWORD,
      'GLOBAL_ADMIN_PASSWORD is missing. Add it to .env file'
    );

    const adminUserName = process.env.GLOBAL_ADMIN_NAME;
    const adminUserPassword = process.env.GLOBAL_ADMIN_PASSWORD;

    let adminUserToken;
    try {
      adminUserToken = await oauthHelper.getUserToken(
        adminUserName,
        adminUserPassword
      );
    } catch (e) {
      console.error(
        'ERROR: Unable to fetch the user token, check your username and password in your .env',
        e
      );
      throw e;
    }
    adminCredentials = { token: adminUserToken };
    console.log("getting admin user's address:", adminUserName);
    const adminResponse = await oauthHelper.getStratoUserFromToken(
      adminCredentials.token
    );
    console.log('adminResponse', adminResponse);

    assert.strictEqual(
      adminResponse.status,
      RestStatus.OK,
      adminResponse.message
    );
    admin = { ...adminResponse.user, ...adminCredentials };

    members.push({});
    mainChainContract = await dappJs.uploadDappContract(admin, options);
    dapp = await dappJs.uploadDappContract(admin, options);
  });
});
