import * as R from 'ramda';
import { rest, util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import constants from '/helpers/constants';

import RestStatus from 'http-status-codes';

import productFileJs from '../productFile';
import factory from './productFile.factory.js';
import { args } from 'commander';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of ProductFile
 */
describe('ProductFile', function() {
    this.timeout(config.timeout);

    let globalAdmin;
    let contract;

    const member = () => `${util.uid() + 1}`.padStart(40, '0'); // Generate address
    const enode = () => 'enode://' + `${util.uid() + 1}`.padStart(130, '0') + '@1.2.3.4:30303';
    const factoryArgsCreate = (user) => ({ ...(factory.getProductFileArgs(util.uid())), assetOwner: user.address});
    const factoryArgsUpdate = (user) => ({ ...(factory.updateProductFileArgs(util.uid())), assetOwner: user.address});

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

    it('Create ProductFile - 201', async () => {
        // Create ProductFile via upload
        const args = factoryArgsCreate(globalAdmin)
        contract = await productFileJs.uploadContract(globalAdmin, args, options);
        const state = await contract.getState();

        assert.notStrictEqual(
            { ...state, constructor: '' },  // Ignore constructor
            { ...args, owner: globalAdmin.address, constructor: '' });
    });

    it('Create and update a ProductFile', async () => {
        // Create our ProductFile
        const args = factoryArgsCreate(globalAdmin);
        const productFile = await productFileJs.uploadContract(globalAdmin, args, options);
        
        assert.isDefined(productFile.address, "productFile was not created")
        
        const args2 = factoryArgsUpdate(globalAdmin);
        const update = await productFile.update(args2)
        const response = await productFile.getState();
        console.log("response: ", response)
        
        assert.equal(update[0], RestStatus.OK)
        assert.equal(response.productId, args.productId)
        assert.equal(response.createdDate, args.createdDate)
        assert.equal(response.owner, args2.assetOwner)
        assert.equal(response.fileName, args2.fileName)
        assert.equal(response.fileLocation, args2.fileLocation)
        assert.equal(response.fileHash, args2.fileHash)
        assert.equal(response.currentType, 'DOCUMENT') 
        // Check for section when we have other values
        assert.equal(response.uploadDate, args2.uploadDate)
        assert.notStrictEqual(response.fileName, args.name)
        assert.notStrictEqual(response.fileLocation, args.price)
        assert.notStrictEqual(response.fileHash, args.description)
        assert.notStrictEqual(response.currentType, args.currentType)
    });
});