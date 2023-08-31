import * as R from 'ramda';
import { util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import dappJs from '/dapp/dapp/dapp'

import RestStatus from 'http-status-codes';
import certificateJs from '/dapp/certificates/certificate'
import factory from '../factory/review.factory';
import review from '../review';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of Properties
 */
describe('Review', function () {
  this.timeout(config.timeout);

  let globalAdmin;
  let contract;
  let dapp;
  let newOptions;
  let adminOrganization;
  let args;

  const factoryArgs = () => ({ ...(factory.getReviewArgs(util.uid())) });

  before(async () => {
    assert.isDefined(
      config.configDirPath,
      "configDirPath is  missing. Set in config"
    )
    assert.isDefined(
      config.deployFilename,
      "deployFilename is missing. Set in config"
    )
    assert.isDefined(
      process.env.GLOBAL_ADMIN_NAME,
      "GLOBAL_ADMIN_NAME is missing. Add it to .env file"
    )
    assert.isDefined(
      process.env.GLOBAL_ADMIN_PASSWORD,
      "GLOBAL_ADMIN_PASSWORD is missing. Add it to .env file"
    )

    let adminUserName = process.env.GLOBAL_ADMIN_NAME
    let adminUserPassword = process.env.GLOBAL_ADMIN_PASSWORD

    let adminUserToken
    try {
      adminUserToken = await oauthHelper.getUserToken(adminUserName, adminUserPassword)
    } catch (e) {
      console.error("ERROR: Unable to fetch the user token, check your username and password in your .env", e)
      throw e
    }
    let adminCredentials = { token: adminUserToken }
    console.log("getting admin user's address:", adminUserName)
    const adminResponse = await oauthHelper.getStratoUserFromToken(adminCredentials.token)


    assert.strictEqual(
      adminResponse.status,
      RestStatus.OK,
      adminResponse.message
    )
    globalAdmin = { ...adminResponse.user, ...adminCredentials }

    const adminCert = await certificateJs.getCertificateMe(globalAdmin)
    adminOrganization = adminCert.organization;

    newOptions = {
      org: adminOrganization,
      ...options
    }

    args = factoryArgs(globalAdmin)

  });

  it('Add Review - 201', async () => {
    contract = await review.uploadContract(globalAdmin, args, newOptions);
    assert.hasAnyKeys(contract, ["address"], "upload Review contract has address")
  });

  it('Get All Reviews - 201', async () => {
    const reviews = await review.getAll(globalAdmin, {}, newOptions);
    assert(Array.isArray(reviews), 'should be array');
    assert.isAtLeast(reviews.length, 1, 'reviews has length of 1');
  });

});