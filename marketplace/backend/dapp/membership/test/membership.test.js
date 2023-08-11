import * as R from 'ramda';
import { rest, util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';

import RestStatus from 'http-status-codes';

import membershipJs from '../membership';
import factory from './membership.factory.js';
import certificateJs from '/dapp/certificates/certificate'

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of Membership
 */
describe('Membership', function() {
    this.timeout(config.timeout);

    let globalAdmin;
    let contract;
    let newOptions;
    let orgAdmin

    const factoryArgs = () => ({ ...(factory.getMembershipArgs(util.uid()))});

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
        let orgAdminName = process.env.TRADINGENTITY_NAME
        let orgAdminPassword = process.env.TRADINGENTITY_PASSWORD
    
        let adminUserToken
        let orgAdminToken
        try {
          adminUserToken = await oauthHelper.getUserToken(adminUserName, adminUserPassword)
        } catch(e) {
          console.error("ERROR: Unable to fetch the user token, check your username and password in your .env", e)
          throw e
        }
        let adminCredentials = { token: adminUserToken }
        console.log("getting admin user's address:", adminUserName)
        const adminResponse = await oauthHelper.getStratoUserFromToken(adminCredentials.token)
        console.log("adminResponse", adminResponse)
    
    
        assert.strictEqual(
          adminResponse.status,
          RestStatus.OK,
          adminResponse.message
        )

        try {
            orgAdminToken = await oauthHelper.getUserToken(orgAdminName, orgAdminPassword)
          } catch(e) {
            console.error("ERROR: Unable to fetch the user token, check your username and password in your .env", e)
            throw e
          }
          let orgAdminCredentials = { token: orgAdminToken }
          console.log("getting admin user's address:", orgAdminName)
          const orgAdminResponse = await oauthHelper.getStratoUserFromToken(orgAdminCredentials.token)
          console.log("orgAdminResponse", orgAdminResponse)
      
      
          assert.strictEqual(
            orgAdminResponse.status,
            RestStatus.OK,
            orgAdminResponse.message
          )
        globalAdmin = {...adminResponse.user, ...adminCredentials}
        orgAdmin = {...orgAdminResponse.user, ...orgAdminCredentials}

        const cert = await certificateJs.getCertificateMe(globalAdmin)
        const userOrganization = cert.organization;

        newOptions = {
            org: userOrganization,
            ...options
        }


    });

    it('Create Membership - 201', async () => {
        // Create Membership via upload
        const args = factoryArgs(globalAdmin)
        console.log("args", args)
        contract = await membershipJs.uploadContract(globalAdmin, args, options);
        console.log("contract upload", contract)
        const state = await contract.getState();

        assert.notStrictEqual(
            { ...state, constructor: '' },  // Ignore constructor
            { ...args, owner: globalAdmin.address, constructor: '' });
    });


    it('Update a Membership', async () => {
        // Create our Membership
        const args = factoryArgs(globalAdmin)
        const membership = await membershipJs.uploadContract(globalAdmin, args, options)
        const response = await membership.getState();
          
        console.log("args", response)
        const args2 = factoryArgs(globalAdmin);
        const update = await contract.update(args2)
        assert.equal(update[0], RestStatus.OK)
        assert.notStrictEqual(response.additionalInfo, args2.additionalInfo)
        assert.notStrictEqual(response.createdDate, args2.createdDate)
        assert.notStrictEqual(response.timePeriodInMonths, args2.timePeriodInMonths)

    });

    
    it('Create and transfer ownership of a Membership', async () => {
        // Create our Membership
        const args = factoryArgs(globalAdmin);
        contract = await membershipJs.uploadContract(globalAdmin, args, options);
  
        // // Check if Membership was created
        // const membershipData = await contract.getState();
        // assert.deepInclude(R.map(v => '' + v, membershipData), R.map(v => '' + v, args));
  



        const membershipResponse = await contract.transferOwnership(orgAdmin.address);
        assert.equal(membershipResponse, RestStatus.OK)
    });


});