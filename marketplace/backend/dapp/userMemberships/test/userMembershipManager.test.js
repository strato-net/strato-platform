import * as R from 'ramda';
import { rest, util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import RestStatus from 'http-status-codes';
import userMembershipManagerJs from '../userMembershipManager';
import appPermissionManagerJs from "/dapp/permissions/app/appPermissionManager";
import factory from '../factory/userMembershipManager.factory';
import certificateJs from '/dapp/certificates/certificate'
import { args } from 'commander';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of UserMembershipManager
 */
describe('User Membership Manager', function () {
    this.timeout(config.timeout);

    let globalAdmin;
    let contract;
    let newOptions;
    let adminOrganization;
    let permissionManagerContract;
    let userMembershipContract;
    let userMembershipRequestAddress;

    let factoryArgs
    const updateFactoryArgs = (user) => ({ ...(factory.getUpdateUserMembershipArgs(util.uid())) });
    const userMembershipRequestArgs = (userAddress,userMembershipAddress) =>({ ...(factory.getUserMembershipRequestArgs(util.uid(),userAddress,userMembershipAddress)) });
    const updateUserMembershipRequestArgs = (userMembershipRequestAddress) =>({ ...(factory.getUpdateUserMembershipRequestArgs(userMembershipRequestAddress)) });

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
            app: 'UserMembershipManager',
            org: adminOrganization,
            ...options
        }

        factoryArgs = (user) => ({ ...(factory.getUserMembershipArgs(util.uid(), globalAdmin.address, adminOrganization)) });

        // deploy permission manager
        permissionManagerContract = await appPermissionManagerJs.uploadContract(
            globalAdmin, { admin: globalAdmin.address, master: globalAdmin.address }, options);

        // await permissionManagerContract.grantAdminRole({ user: globalAdmin })

        contract = await userMembershipManagerJs.uploadContract(
            globalAdmin, { permissionManager: permissionManagerContract.address }, newOptions);
    });


    it('create userMembership ', async () => {

        const args = factoryArgs(globalAdmin);

        const [status, userMembershipAddress] = await contract.createUserMembership(args);
        assert.equal(status, RestStatus.CREATED);


        userMembershipContract = await contract.get({ address: userMembershipAddress });

        // Sorting is needed in order to allow for chainIds to be in any order
        // Convert all fields into a string to allow for equality checking
        assert.deepInclude(
            // Convert the UserMembership data into strings as the args are in strings
            R.map(v => '' + v, userMembershipContract),
            R.map(v => '' + v, args));
    });

    it('Update userMembership', async () => {

        const updateArgs = updateFactoryArgs();
        const res = await contract.updateUserMembership({ userMembership: userMembershipContract.address, ...updateArgs });
        assert.equal(res[0], RestStatus.OK);

        const updatedData = await contract.get({ address: userMembershipContract.address });

        assert.equal(updatedData['role'], updateArgs['role'])

    })

    it('create user Membership Request',async ()=>{
  
        const args = userMembershipRequestArgs(globalAdmin.address,userMembershipContract.address);
       
        const [status, userMemberships] = await contract.createUserMembershipRequest(args);
        assert.equal(status, RestStatus.CREATED);

        const userMembershipRequestContract = await contract.getUserMembershipRequest({ address: userMemberships[0] });
        userMembershipRequestAddress = userMemberships[0]

        delete args.roles;

        // Sorting is needed in order to allow for chainIds to be in any order
        // Convert all fields into a string to allow for equality checking
        assert.deepInclude(
            // Convert the UserMembership data into strings as the args are in strings
            R.map(v => '' + v, userMembershipRequestContract),
            R.map(v => '' + v, args))
    })

    it('update user Membership Request',async ()=>{

        const args = updateUserMembershipRequestArgs(userMembershipRequestAddress);
        const [status, userMemberships] = await contract.updateUserMembershipRequest(args);
        
        assert.equal(status, RestStatus.CREATED);

        const userMembershipRequestContract = await contract.getUserMembershipRequest({ address: userMembershipRequestAddress })
        assert.equal(args.userMembershipRequestAddress,userMembershipRequestContract.address);
    })
});