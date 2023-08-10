import * as R from 'ramda';
import { rest, util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import constants from '/helpers/constants';

import RestStatus from 'http-status-codes';

// import appPermissionManagerJs from '/dapp/permissions/app/appPermissionManager';
import serviceJs from '../service';
// import serviceChainJs from '../serviceChain';
import factory from './service.factory.js';
// import user from '/dapp/users/user.js';
import { args } from 'commander';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of Service
 */
describe('Service', function() {
    this.timeout(config.timeout);

    let globalAdmin;
    let contract;

    const member = () => `${util.uid() + 1}`.padStart(40, '0'); // Generate address
    const enode = () => 'enode://' + `${util.uid() + 1}`.padStart(130, '0') + '@1.2.3.4:30303';
    const factoryArgs = (user) => ({ ...(factory.getServiceArgs(util.uid())), assetOwner: user.address});

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

    it('Create Service - 201', async () => {
        // Create Service via upload
        const args = factoryArgs(globalAdmin)
        contract = await serviceJs.uploadContract(globalAdmin, args, options);
        const state = await contract.getState();

        assert.notStrictEqual(
            { ...state, constructor: '' },  // Ignore constructor
            { ...args, owner: globalAdmin.address, constructor: '' });
    });

    // it('Create and update a Service', async () => {
    //     // Create our Service
    //     const args = factoryArgs(globalAdmin)
    //     const service = await serviceJs.uploadContract(globalAdmin, args, options);
    //     console.log("service", service)
    //     const get = await service.get();
    //     console.log("get", get)
    //     const state = await service.getState();
        
    //     console.log("args", state)
    //     const args2 = factoryArgs(globalAdmin);
    //     const update = await service.update(args2)
    //     console.log("update", state.name, " --- ", args2)
    //     assert.equal(update[0], RestStatus.OK)
    //     assert.notStrictEqual(state.name, args2.name)
    //     assert.notStrictEqual(state.description, args2.description)
    //     assert.notStrictEqual(state.price, args2.price)
    //     assert.notStrictEqual(state.createdDate, args2.createdDate) // How can we really check the created date?
    // });
});