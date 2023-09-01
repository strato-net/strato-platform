import * as R from 'ramda';
import { util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import dappJs from '/dapp/dapp/dapp'

import RestStatus from 'http-status-codes';
import certificateJs from '/dapp/certificates/certificate'
import productDocumentManager from "../productDocumentManager"
import factory from '../factory/productDocumentManager.factory';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of productDocument
 */
describe('ProductDocumentManager', function () {
    this.timeout(config.timeout);

    let globalAdmin;
    let contract;
    let dapp;
    let newOptions;
    let adminOrganization;

    const createArgs = () => ({ ...(factory.createArgs(util.uid())) });

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

        const args = factoryArgs(globalAdmin)
        contract = await productDocumentManager.uploadContract(globalAdmin, args, newOptions);
    });

    it('Create ProductDocument - 201', async () => {
        // Create productDocument via upload
        const args = createArgs(globalAdmin)
        contract = await productDocumentManager.uploadContract(globalAdmin, args, newOptions);
        const [restStatus, address] = contract;
        assert.equal(restStatus, RestStatus.OK, 'should succeed')

    });

    it('Create ProductDocument - 201', async () => {
        // Create productDocument via upload
        const args = factoryArgs(globalAdmin)
        contract = await productDocumentManager.uploadContract(globalAdmin,contract, args, newOptions);
        const [restStatus, address] = contract;
        assert.equal(restStatus, RestStatus.OK, 'should succeed')

    });

    it('Get ProductDocument - 201', async () => {
        // Create productDocument via upload
        const args = factoryArgs(globalAdmin)
        const productDocument = await productDocumentManager.getProductDocument(globalAdmin, args, newOptions);
        assert.isObject(productDocument, "should be an object");
        let keys = Object.keys(productDocument)
        assert.containsAllKeys(productDocument, keys, "should have all keys")

    });

    it('GetAll ProductDocuments - 201', async () => {
        // Create productDocument via upload
        const args = factoryArgs(globalAdmin)
        const productDocuments = await productDocumentManager.getProductDocuments(globalAdmin, args, newOptions);
        assert.isArray(productDocuments, "should be an array");
        assert.isAtLeast(productDocuments.length, 1, 'array has atleast length of 1');

    });

    it('Delete ProductDocument - 201', async () => {
        // Create productDocument via upload
        const args = factoryArgs(globalAdmin)
        contract = await productDocumentManager.deleteProductDocument(globalAdmin,contract, args, newOptions);
        const [restStatus, address] = contract;
        assert.equal(restStatus, RestStatus.OK, 'should succeed')

    });

});
