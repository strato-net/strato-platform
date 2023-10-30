import * as R from 'ramda';
import { rest, util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import dappJs from '/dapp/dapp/dapp';
// import constants from '/helpers/constants';
import RestStatus from 'http-status-codes';
// import appPermissionManagerJs from '/dapp/permissions/app/appPermissionManager';
import eventTypeJs from '../eventType';
import factory from '../factory/eventType.factory.js';
// import { args } from 'commander';
import certificateJs from '/dapp/certificates/certificate'

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of EventType
 */
describe('EventType', function () {
    this.timeout(config.timeout);

    let globalAdmin;
    let contract;
    let dapp;
    let newOptions;
    let adminOrganization;

    const factoryArgs = (user) => ({ ...(factory.getEventTypeArgs(util.uid())), assetOwner: user.address });

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
        console.log("adminResponse", adminResponse)


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

    it('should upload Event Type contract', async () => {
        const args = factoryArgs(globalAdmin)
        contract = await eventTypeJs.uploadContract(globalAdmin, args, newOptions);
        const state = await contract.get({ address: contract.address });

        console.log("state1", state, "args1", args)

        assert.notStrictEqual(
            { ...state, constructor: '' },  // Ignore constructor
            { ...args, owner: globalAdmin.address, constructor: '' }
        );

        // Exclude owner from comparison. Args param has owner as asserOwner
        assert.deepInclude(
            R.map(v => '' + v, state),
            R.init(R.map(v => '' + v, args))
        );

        assert.strictEqual(state.owner, args.assetOwner);

    });

});