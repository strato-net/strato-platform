import * as R from 'ramda';
import { rest, util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import constants from '/helpers/constants';

import RestStatus from 'http-status-codes';

import appPermissionManagerJs from '/dapp/permissions/app/appPermissionManager';
import membershipServiceJs from '../membershipService';
import membershipServiceChainJs from '../membershipServiceChain';
import factory from './membershipService.factory.js';
import user from '/dapp/users/user.js';
import { args } from 'commander';

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

    const member = () => `${util.uid() + 1}`.padStart(40, '0'); // Generate address
    const enode = () => 'enode://' + `${util.uid() + 1}`.padStart(130, '0') + '@1.2.3.4:30303';
    const factoryArgs = (user) => ({ ...(factory.getMembershipServiceArgs(util.uid())), assetOwner: user.address});

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

    it('addMember - 200', async () => {
        const res = await contract.addMember(member(), enode());
        assert.equal(res[0], RestStatus.OK);
    });

    it('removeMember - 200', async () => {
        const res = await contract.removeMember(member());
        assert.equal(res[0], RestStatus.OK);
    });

    it('addMembers - 200', async () => {
        const res = await contract.addMembers([member(), member(), member()], [enode(), enode(), enode()]);
        assert.equal(res[0], RestStatus.OK);
    });

    it('removeMembers - 200', async () => {
        const res = await contract.removeMembers([member(), member(), member()]);
        assert.equal(res[0], RestStatus.OK);
    });

    it('createMembershipService (Private chain)', async () => {
        const args = factoryArgs(globalAdmin);
        const membershipService = await membershipServiceChainJs.createMembershipService(globalAdmin, args, options);
        const membershipServiceData = await membershipService.get();
        // Sorting is needed in order to allow for chainIds to be in any order
        // Convert all fields into a string to allow for equality checking
        assert.deepInclude(
            // Convert the MembershipService data into strings as the args are in strings
            R.map(v => '' + v, membershipServiceData),
            R.map(v => '' + v, args));
    });

    it('createMembershipService (Private chain, multiple)', async () => {
        const args1 = factoryArgs(globalAdmin);
        const args2 = factoryArgs(globalAdmin);
        const args3 = factoryArgs(globalAdmin);
        const args4 = factoryArgs(globalAdmin);
        const membershipService1 = await membershipServiceChainJs.createMembershipService(globalAdmin, args1, options);
        const membershipService2 = await membershipServiceChainJs.createMembershipService(globalAdmin, args2, options);
        const membershipService3 = await membershipServiceChainJs.createMembershipService(globalAdmin, args3, options);
        const membershipService4 = await membershipServiceChainJs.createMembershipService(globalAdmin, args4, options);
        const membershipServiceData1 = await membershipService1.get();
        const membershipServiceData2 = await membershipService2.get();
        const membershipServiceData3 = await membershipService3.get();
        const membershipServiceData4 = await membershipService4.get();
        // Our logic shouldn't mix up membershipServices
        assert.deepInclude(R.map(v => '' + v, membershipServiceData1), R.map(v => '' + v, args1));
        assert.deepInclude(R.map(v => '' + v, membershipServiceData2), R.map(v => '' + v, args2));
        assert.deepInclude(R.map(v => '' + v, membershipServiceData3), R.map(v => '' + v, args3));
        assert.deepInclude(R.map(v => '' + v, membershipServiceData4), R.map(v => '' + v, args4));    
    });

    // it('Create an organization manager', async () => {
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

    it('Create and transfer ownership of a MembershipService', async () => {
        // Create our MembershipService
        const args = factoryArgs(globalAdmin);
        const membershipService = await membershipServiceChainJs.createMembershipService(globalAdmin, args, options);
  
        // Check if MembershipService was created
        const membershipServiceData = await membershipService.get();
        assert.deepInclude(R.map(v => '' + v, membershipServiceData), R.map(v => '' + v, args));
  
        // Create App Permission Manager
        const appPermissionManagerContract = await appPermissionManagerJs.uploadContract(globalAdmin, {
            admin: globalAdmin.address,
            master: globalAdmin.address,
        }, options);
      
        // assign role
        await appPermissionManagerContract.grantGlobalAdminRole({ user: globalAdmin });

        let addrToBeTransferedTo = 0x0 // TODO FILL THIS IN


        const membershipServiceResponse = await membershipService.transferOwnership(addrToBeTransferedTo);
        assert.equal(membershipServiceResponse, RestStatus.OK)
    });

    it('Create and update a MembershipService', async () => {
        // Create our MembershipService
        const args = factoryArgs(globalAdmin);
        const membershipService = await membershipServiceChainJs.createMembershipService(globalAdmin, args, options);
  
        // Check if MembershipService was created
        const membershipServiceData = await membershipService.get();
        assert.deepInclude(R.map(v => '' + v, membershipServiceData), R.map(v => '' + v, args));
        
        
        const args2 = factoryArgs(globalAdmin);
        const update = await membershipService.update(args2)
        assert.equal(update[0], RestStatus.OK)
    });
});