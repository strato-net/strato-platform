import * as R from 'ramda';
import { util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import dappJs from '/dapp/dapp/dapp';
import certificateJs from '/dapp/certificates/certificate';
import RestStatus from 'http-status-codes';
import inventoryJs from '../inventory';
import factory from '../factory/inventory.factory';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of Inventory
 */
describe('Inventory', function () {
  this.timeout(config.timeout);

  let globalAdmin;
  let contract;
  let dapp;
  let newOptions;
  let adminOrganization;
  const factoryArgs = (userAddress) => ({
    ...factory.getInventoryArgs(util.uid(), userAddress),
  });

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

    let adminUserName = process.env.GLOBAL_ADMIN_NAME;
    let adminUserPassword = process.env.GLOBAL_ADMIN_PASSWORD;

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
    let adminCredentials = { token: adminUserToken };
    console.log("getting admin user's address:", adminUserName);
    const adminResponse = await oauthHelper.getStratoUserFromToken(
      adminCredentials.token
    );

    const dapp = await dappJs.loadFromDeployment(
      adminCredentials,
      `${config.configDirPath}/${config.deployFilename}`,
      options
    );

    assert.strictEqual(
      adminResponse.status,
      RestStatus.OK,
      adminResponse.message
    );
    globalAdmin = { ...adminResponse.user, ...adminCredentials };

    const adminCert = await certificateJs.getCertificateMe(globalAdmin);
    adminOrganization = adminCert.organization;

    newOptions = {
      org: adminOrganization,
      ...options,
    };
  });

  it('Create Inventory - 201', async () => {
    // Create Inventory via upload
    const args = factoryArgs(globalAdmin.address);
    contract = await inventoryJs.uploadContract(globalAdmin, args, newOptions);
    const state = await contract.get();

    assert.deepInclude(
      // Convert the Inventory data into strings as the args are in strings
      R.map((v) => '' + v, state),
      R.map((v) => '' + v, args)
    );
  });
});
