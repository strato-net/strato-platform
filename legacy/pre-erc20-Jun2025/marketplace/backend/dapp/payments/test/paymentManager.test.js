import * as R from 'ramda';
import { rest, util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import dappJs from '/dapp/dapp/dapp';
import RestStatus from 'http-status-codes';
import paymentManagerJs from '../paymentManager';
import factory from '../factory/paymentManager.factory';
import { args } from 'commander';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of Category
 */
describe('Payment Manager', function () {
  this.timeout(config.timeout);

  let globalAdmin;
  let contract;
  let dapp;
  let newOptions;

  const factoryArgs = (user) => ({ ...factory.getPaymentArgs(util.uid()) });
  const updateFactoryArgs = (user, address) => ({
    ...factory.getUpdatePaymentArgs(util.uid(), address),
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
    console.log('adminResponse', adminResponse);

    assert.strictEqual(
      adminResponse.status,
      RestStatus.OK,
      adminResponse.message
    );
    globalAdmin = { ...adminResponse.user, ...adminCredentials };

    dapp = await dappJs.loadFromDeployment(
      { token: adminUserToken },
      `${config.configDirPath}/${config.deployFilename}`,
      options
    );
    newOptions = {
      app: 'PaymentManager',
      org: dapp.managers.cirrusOrg,
      ...options,
    };

    contract = await paymentManagerJs.uploadContract(
      globalAdmin,
      args,
      newOptions
    );
  });

  it('create payment ', async () => {
    const args = factoryArgs(globalAdmin);

    const [status, paymentAddress] = await contract.createPayment(args);
    assert.equal(status, RestStatus.CREATED);

    let paymentData = await contract.get({ address: paymentAddress });

    assert.deepInclude(
      // Convert the Category data into strings as the args are in strings
      R.map((v) => '' + v, paymentData),
      R.map((v) => '' + v, args)
    );
  });

  it('create and update Payment', async () => {
    // create a Category
    const args = factoryArgs(globalAdmin);
    const [status, paymentAddress] = await contract.createPayment(args);
    assert.equal(status, RestStatus.CREATED);

    let paymentData = await contract.get({ address: paymentAddress });
    assert.deepInclude(
      // Convert the Category data into strings as the args are in strings
      R.map((v) => '' + v, paymentData),
      R.map((v) => '' + v, args)
    );

    // update the created Category
    const updateArgs = updateFactoryArgs(globalAdmin, paymentAddress);
    const res = await contract.updatePayment(updateArgs);
    assert.equal(res[0], RestStatus.OK);

    const updatedData = await contract.get({ address: paymentAddress });

    assert.equal(updatedData['status'], updateArgs['status']);
  });
});
