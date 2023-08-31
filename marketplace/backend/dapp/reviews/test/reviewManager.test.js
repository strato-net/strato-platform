import * as R from 'ramda';
import { util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import dappJs from '/dapp/dapp/dapp'

import RestStatus from 'http-status-codes';
import certificateJs from '/dapp/certificates/certificate'
import factory from '../factory/reviewManager.factory';
import reviewManager from '../reviewManager';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of Properties
 */
describe('ReviewManager', function () {
  this.timeout(config.timeout);

  let globalAdmin;
  let contract;
  let dapp;
  let newOptions;
  let adminOrganization;
  let args;

  const factoryArgs = () => ({ ...(factory.getReviewArgs(util.uid())) });
  const updateReviewArgs = () => ({ ...(factory.updateReviewArgs(util.uid())) }); 
  const deleteReviewArgs = () => ({ ...(factory.deleteReviewArgs(util.uid())) }); 

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

    contract = await reviewManager.uploadContract(globalAdmin, args, newOptions);
    assert.hasAnyKeys(contract, ["address"], "upload Review contract has address")

  });

  it('Add Review - 201', async () => {
   let [restStatus, reviewAddress] = await reviewManager.createReview(globalAdmin,contract, args, newOptions);
    assert.equal(restStatus, RestStatus.OK, 'should succeed')
  });


  // it('Update Review - 201', async () => {
  //   args = updateReviewArgs(globalAdmin)
  //   let udpdate = await reviewManager.updateReview(globalAdmin,contract, args, newOptions);
  //   //  assert.hasAnyKeys(contract, ["address"], "update Review contract has address")
  //   //  assert.equal(restStatus, RestStatus.OK, 'should succeed')
  //  });

  it('Get All Reviews - 201', async () => {
    const reviews = await reviewManager.getReviews(globalAdmin,{}, newOptions);
    assert(Array.isArray(reviews), 'should be array');
    assert.isAtLeast(reviews.length, 1, 'reviews has length of 1');
  });

  // testing......... 
  // it('Delete Review - 201', async () => {
  //   args = deleteReviewArgs(globalAdmin)
  //   const reviews = await reviewManager.deleteReview(globalAdmin, contract, args, newOptions);
  //   console.log("delete----reviews-------------------------------------------------------------------", reviews);
  //   // assert(Array.isArray(reviews), 'should be array');
  //   // assert.isAtLeast(reviews.length, 1, 'reviews has length of 1');
  // });


});