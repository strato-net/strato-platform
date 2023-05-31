import * as R from 'ramda';
import { rest, util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';

import RestStatus from 'http-status-codes';

import rawMaterialJs from 'dapp/items/rawMaterials/rawMaterial';
import factory from 'dapp/items/rawMaterials/factory/rawMaterial.factory';
import certificateJs from '/dapp/certificates/certificate'

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of Event
 */
describe('Raw Material', function () {
    this.timeout(config.timeout);

    let globalAdmin;
    let contract;
    let newOptions;

    const factoryArgs = () => ({ ...(factory.getRawMaterialArgs(util.uid())) });

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

        const cert = await certificateJs.getCertificateMe(globalAdmin)
        const userOrganization = cert.organization;

        newOptions = {
            org: userOrganization,
            ...options
        }
    });

    it('Create Raw Material', async () => {
        // Create Raw Material via upload
        const args = factoryArgs()
        contract = await rawMaterialJs.uploadContract(globalAdmin, args, newOptions);
        const state = await contract.get();

        assert.deepInclude(
            // Convert the Raw Material data into strings as the args are in strings
            R.map(v => '' + v, state),
            R.map(v => '' + v, { ...args }));
    });
});
