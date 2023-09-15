import * as R from 'ramda';
import { rest, util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';

import RestStatus from 'http-status-codes';

import membershipServiceJs from '../membershipService';
import factory from './membershipService.factory.js';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of MembershipService
 */
describe('MembershipService', function() {
    this.timeout(config.timeout);

    let globalAdmin;
    let contract;

    const factoryArgs = () => ({ ...(factory.getMembershipServiceArgs(util.uid()))});

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


    });

    it('Create MembershipService - 201', async () => {
        // Create MembershipService via upload
        const args = factoryArgs(globalAdmin)
        contract = await membershipServiceJs.uploadContract(globalAdmin, args, options);
        const state = await contract.getState();

        assert.notStrictEqual(
            { ...state, constructor: '' },  // Ignore constructor
            { ...args, owner: globalAdmin.address, constructor: '' });
    });

    //     // Create App Permission Manager
    //     const appPermissionManagerContract = await appPermissionManagerJs.uploadContract(globalAdmin, {
    //         admin: globalAdmin.address,
    //         master: globalAdmin.address,
    //     }, options);
      
    //     // assign role
    //     await appPermissionManagerContract.grantGlobalAdminRole({ user: globalAdmin });
  
    //     // Create Organization Manager
    //     const organizationManager = await organizationManagerJs.uploadContract(globalAdmin,
    //         { permissionManager: appPermissionManagerContract.address }, options);
  
    //     assert.notEqual(organizationManager.address, constants.zeroAddress, 'Contract address must be not zero');
  
    //     const { permissionManager, owner } = await organizationManager.getState();
    //     assert.equal(owner, globalAdmin.address, 'owner');
    //     assert.equal(permissionManager, appPermissionManagerContract.address, 'permissionManager');
    // });

    // it('Create and transfer ownership of a MembershipService', async () => {
    //     // Create our MembershipService
    //     const args = factoryArgs(globalAdmin);
    //     const membershipService = await membershipServiceChainJs.createMembershipService(globalAdmin, args, options);
  
    //     // Check if MembershipService was created
    //     const membershipServiceData = await membershipService.get();
    //     assert.deepInclude(R.map(v => '' + v, membershipServiceData), R.map(v => '' + v, args));
  
    //     // Create App Permission Manager
    //     const appPermissionManagerContract = await appPermissionManagerJs.uploadContract(globalAdmin, {
    //         admin: globalAdmin.address,
    //         master: globalAdmin.address,
    //     }, options);
      
    //     // assign role
    //     await appPermissionManagerContract.grantGlobalAdminRole({ user: globalAdmin });

    //     let addrToBeTransferedTo = 0x0 // TODO FILL THIS IN


    //     const membershipServiceResponse = await membershipService.transferOwnership(addrToBeTransferedTo);
    //     assert.equal(membershipServiceResponse, RestStatus.OK)
    // });

    it('Create and update a MembershipService', async () => {
        // Create our MembershipService
        const args = factoryArgs(globalAdmin);
        const membershipService = await membershipServiceJs.uploadContract(globalAdmin, args, options);
        
        const args2 = factoryArgs(globalAdmin);
        const update = await membershipService.update(args2)
        const state = await membershipService.getState();

        assert.equal(update[0], RestStatus.OK)
        assert.equal(state.membershipId, args2.membershipId)
        assert.equal(state.serviceId, args2.serviceId)
        assert.equal(state.membershipPrice, args2.membershipPrice)
        assert.equal(state.discountPrice, args2.discountPrice)
        assert.equal(state.maxQuantity, args2.maxQuantity)
        assert.equal(state.createdDate, args2.createdDate)
        assert.equal(state.isActive, args2.isActive)
    });
});