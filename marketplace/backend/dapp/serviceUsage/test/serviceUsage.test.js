import * as R from 'ramda';
import { util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';

import RestStatus from 'http-status-codes';

import serviceUsageJs from '../serviceUsage';
import factory from './serviceUsage.factory.js';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of ServiceUsage
 */
describe('ServiceUsage', function() {
    this.timeout(config.timeout);

    let globalAdmin;
    let contract;

    const member = () => `${util.uid() + 1}`.padStart(40, '0'); // Generate address
    const enode = () => 'enode://' + `${util.uid() + 1}`.padStart(130, '0') + '@1.2.3.4:30303';
    const factoryArgs = (user) => ({ ...(factory.getServiceUsageArgs(util.uid())), assetOwner: user.address});
    const factoryArgsUpdate = (user) => ({ ...(factory.getServiceUsageUpdateArgs(util.uid())), assetOwner: user.address});

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

    it('Create ServiceUsage - 201', async () => {
        // Create ServiceUsage via upload
        const args = factoryArgs(globalAdmin)
        contract = await serviceUsageJs.uploadContract(globalAdmin, args, options);
        const state = await contract.getState();

        assert.notStrictEqual(
            { ...state, constructor: '' },  // Ignore constructor
            { ...args, owner: globalAdmin.address, constructor: '' });
    });

    it('Create and update a ServiceUsage', async () => {
        // Create our ServiceUsage
        const args = factoryArgs(globalAdmin);
        const serviceUsage = await serviceUsageJs.uploadContract(globalAdmin, args, options);
        
        assert.isDefined(serviceUsage.address, "productFile was not created")

        const args2 = factoryArgsUpdate(globalAdmin);
        const update = await serviceUsage.update(args2)
        const response = await serviceUsage.getState();
        console.log("response: ", response)
        
        assert.equal(update[0], RestStatus.OK)
        assert.equal(response.itemId, args.itemId)
        assert.equal(response.createdDate, args.createdDate)
        assert.equal(response.owner, args.assetOwner)
        assert.equal(response.serviceId, args.serviceId)
        // Check for section when we have other values
        assert.notStrictEqual(response.paymentStatus, args.paymentStatus)
        assert.notStrictEqual(response.pricePaid, args.pricePaid)
        assert.notStrictEqual(response.providerComment, args.providerComment)
        assert.notStrictEqual(response.providerLastUpdated, args.providerLastUpdated)
        assert.notStrictEqual(response.providerLastUpdatedDate, args.providerLastUpdatedDate)
        assert.notStrictEqual(response.serviceDate, args.serviceDate)
        assert.notStrictEqual(response.status, args.status)
        assert.notStrictEqual(response.summary, args.summary)
        
        assert.equal(response.paymentStatus, 'PAID')
        assert.equal(response.pricePaid, args2.pricePaid)
        assert.equal(response.providerComment, args2.providerComment)
        assert.equal(response.providerLastUpdated, args2.providerLastUpdated)
        assert.equal(response.providerLastUpdatedDate, args2.providerLastUpdatedDate)
        assert.equal(response.serviceDate, args2.serviceDate)
        assert.equal(response.status, 'COMPLETED')
        assert.equal(response.summary, args2.summary)
    });
});