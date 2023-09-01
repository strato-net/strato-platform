import * as R from 'ramda';
import { util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import dappJs from '/dapp/dapp/dapp'

import RestStatus from 'http-status-codes';
import certificateJs from '/dapp/certificates/certificate'
import productDocument from "../productDocument"
import factory from '../factory/productDocument.factory';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of productDocument
 */
describe('ProductDocument', function () {
    this.timeout(config.eout);

    let globalAdmin;
    let contract;
    let dapp;
    let newOptions;
    let adminOrganization;

    const factoryArgs = () => ({ ...(factory.getProductDocumentArgs(util.uid())) });

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
    });

    it('Create ProductDocument - 201', async () => {
        // Create productDocument via upload
        const args = factoryArgs(globalAdmin)
        contract = await productDocument.uploadContract(globalAdmin, args, newOptions);
        const state = await contract.getState();

        assert.deepInclude(
            // Convert the productDocument data into strings as the args are in strings
            R.map(v => '' + v, state),
            R.map(v => '' + v, { ...args }));
    });

    it('Get ProductDocument - 201', async () => {
        // Create productDocument via upload
        const args = factoryArgs(globalAdmin)
        contract = await productDocument.get(globalAdmin, args, newOptions);

        assert.deepInclude(
            // Convert the productDocument data into strings as the args are in strings
            R.map(v => '' + v, state),
            R.map(v => '' + v, { ...args }));
    });

    it('GetAll ProductDocument - 201', async () => {
        // Create productDocument via upload
        const args = factoryArgs(globalAdmin)
        contract = await productDocument.getAll(globalAdmin, args, newOptions);
        const state = await contract.getState();

        assert.deepInclude(
            // Convert the productDocument data into strings as the args are in strings
            R.map(v => '' + v, state),
            R.map(v => '' + v, { ...args }));
    });

});
