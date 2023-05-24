import * as R from 'ramda';
import { rest, util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import dappJs from '/dapp/dapp/dapp';
// import constants from '/helpers/constants';
import RestStatus from 'http-status-codes';
import userAddressJs from '../userAddress';
import factory from '../factory/userAddress.factory.js';
// import { args } from 'commander';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of UserAddress
 */
describe('UserAddress', function () {
    this.timeout(config.timeout);

    let globalAdmin;
    let contract;
    let dapp;
    let newOptions;

    const factoryArgs = (user) => ({ ...(factory.getUserAddressArgs(util.uid())), assetOwner: user.address});

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

        dapp = await dappJs.loadFromDeployment({ token: adminUserToken }, `${config.configDirPath}/${config.deployFilename}`, options);
        newOptions = {
            org: dapp.managers.cirrusOrg,
            ...options
        }
    });

    // TODO: Update this test, the contract.get() is not working. getState() can return the contract state
    it('should upload user address contract', async () => {
        const args = factoryArgs(globalAdmin)
        contract = await userAddressJs.uploadContract(globalAdmin, args, newOptions);
        const state = await contract.get();
        const state2 = await contract.getState();

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