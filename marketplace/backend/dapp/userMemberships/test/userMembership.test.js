import * as R from 'ramda';
import { rest, util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import dappJs from '/dapp/dapp/dapp'
import RestStatus from 'http-status-codes';
import userMembershipJs from '../userMembership';
import factory from '../factory/userMembership.factory';
import certificateJs from '/dapp/certificates/certificate'
import { args } from 'commander';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of UserMembership
 */
describe('User Membership', function () {
    this.timeout(config.timeout);

    let globalAdmin;
    let contract;
    let dapp;
    let newOptions;
    let adminOrganization;

    let factoryArgs

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


        const certificate = await certificateJs.getCertificateMe(globalAdmin)
        adminOrganization = certificate.organization;

        newOptions = {
            org: adminOrganization,
            ...options
        }
        factoryArgs = (user) => ({ ...(factory.getUserMembershipArgs(util.uid(), globalAdmin.address, adminOrganization)) });

    });


    it('should upload UserMembership smart contract', async () => {
        const args = factoryArgs(globalAdmin)
        contract = await userMembershipJs.uploadContract(globalAdmin, args, newOptions);
        const state = await contract.get({address:contract.address})

        assert.deepInclude(
            // Convert the UserMembership data into strings as the args are in strings
            R.map(v => '' + v, state),
            R.map(v => '' + v, args));
    });

    it('should get user roles', async () => {
        const state = await contract.getRoles()
        assert.isArray(state, 'Incorrect response type');
        assert.isNotEmpty(state, 'Should not be empty');
    })
});