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
    
        let adminUserToken
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
        globalAdmin = {...adminResponse.user, ...adminCredentials}

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

    // it('Create and transfer ownership of a Membership', async () => {
    //     // Create our Membership
    //     const args = factoryArgs(globalAdmin);
    //     const membership = await membershipChainJs.createMembership(globalAdmin, args, options);
  
    //     // Check if Membership was created
    //     const membershipData = await membership.get();
    //     assert.deepInclude(R.map(v => '' + v, membershipData), R.map(v => '' + v, args));
  
    //     // Create App Permission Manager
    //     const appPermissionManagerContract = await appPermissionManagerJs.uploadContract(globalAdmin, {
    //         admin: globalAdmin.address,
    //         master: globalAdmin.address,
    //     }, options);
      
    //     // assign role
    //     await appPermissionManagerContract.grantGlobalAdminRole({ user: globalAdmin });

    //     let addrToBeTransferedTo = 0x0 // TODO FILL THIS IN


    //     const membershipResponse = await membership.transferOwnership(addrToBeTransferedTo);
    //     assert.equal(membershipResponse, RestStatus.OK)
    // });

    it('Update a Membership', async () => {
        // Create our Membership
        const args = await contract.getState();
          
        console.log("args", args)
        const args2 = factoryArgs(globalAdmin);
        const update = await contract.update(args2)
        assert.equal(update[0], RestStatus.OK)
        assert.notStrictEqual(args.additionalInfo, args2.additionalInfo)
        assert.notStrictEqual(args.createdDate, args2.createdDate)
        assert.notStrictEqual(args.timePeriodInMonths, args2.timePeriodInMonths)

    });
});