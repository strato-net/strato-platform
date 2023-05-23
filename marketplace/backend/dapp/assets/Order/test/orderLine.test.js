import * as R from 'ramda';
import { rest, util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import dappJs from '/dapp/dapp/dapp'
import constants from '/helpers/constants';

import RestStatus from 'http-status-codes';

import orderLineJs from '../orderLine';
import orderLineItemJs from '../orderLineItem';
import orderLineFactory from '../factory/orderLine.factory';
import orderLineItemFactory from '../factory/orderLineItem.factory';
import { args } from 'commander';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of OrderLine
 */
describe('orderLine', function() {
    this.timeout(config.timeout);

    let globalAdmin;
    let contract;
    let dapp;
    let newOptions;

    const orderLineFactoryArgs = (user) => ({ ...(orderLineFactory.getOrderLineArgs(util.uid()))});
    const orderLineItemFactoryArgs = (user) => ({ ...(orderLineFactory.getOrderLineItemsArgs(util.uid()))});

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
        globalAdmin = {...adminResponse.user, ...adminCredentials};

        dapp = await dappJs.loadFromDeployment({ token: adminUserToken }, `${config.configDirPath}/${config.deployFilename}`, options);
        newOptions={
            org:dapp.managers.cirrusOrg,
            ...options
        }

    });

    // TODO: Update this test, it is failing
    it('should upload OrderLine smart contract', async () => {
        const args=orderLineFactoryArgs(globalAdmin)
        contract=await orderLineJs.uploadContract(globalAdmin,args,newOptions);
        const state=await contract.get({address:contract.address})
    
        delete args["inventoryOwner"];
        assert.deepInclude(
            // Convert the Category data into strings as the args are in strings
            R.map(v => '' + v, state),
            R.map(v => '' + v, args));
        });
    
    it('addOrderLineItems of orderLine - 404', async () => {
        const orderLineArgs=orderLineFactoryArgs(globalAdmin)
        contract=await orderLineJs.uploadContract(globalAdmin,orderLineArgs,newOptions);

        const orderLIneItemArgs=orderLineItemFactoryArgs(globalAdmin);
        
        await assert.restStatus(async ()=>{
            await contract.addOrderLineItems(orderLIneItemArgs);
        },RestStatus.NOT_FOUND);

    });
    
});