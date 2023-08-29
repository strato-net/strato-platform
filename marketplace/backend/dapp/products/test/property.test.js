import * as R from 'ramda';
import { util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import dappJs from '/dapp/dapp/dapp'

import RestStatus from 'http-status-codes';
import certificateJs from '/dapp/certificates/certificate'
import propertyJs from '../property';
import factory from '../factory/property.factory';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of Properties
 */
describe('Property', function () {
    this.timeout(config.timeout);

    let globalAdmin;
    let contract;
    let dapp;
    let newOptions;
    let adminOrganization;
    let args;

    const factoryArgs = () => ({ ...(factory.getPropertyArgs(util.uid())) });

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

        args = factoryArgs(globalAdmin)
    });

    it('Create Property - 201', async () => {
        contract = await propertyJs.uploadContract(globalAdmin, args, newOptions);
        const state = await contract.getState();

        assert.deepInclude(
            R.map(v => '' + v, state),
            R.map(v => '' + v, { ...args }));
    });

    it('Get All Properties - 201', async () => {
        const properties = await propertyJs.getAll(globalAdmin, {}, newOptions);
        assert(Array.isArray(properties), 'should be array');
        assert.isAtLeast(properties.length, 1, 'Properties has length of 1');
    });

    it('Get Property - 201', async () => {
        const payload = {
            uniqueProductID: `${util.uid() + 2}`.padStart(40, '0'),
            address: contract.address
        };

        const property = await propertyJs.get(globalAdmin, payload, newOptions);
        assert.isObject(property, 'property is an object');
        assert.deepInclude(
            // Convert the Property data into strings as the args are in strings
            R.map(v => '' + v, property),
            R.map(v => '' + v, { ...args }));
    });

});