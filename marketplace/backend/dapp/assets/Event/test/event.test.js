import * as R from 'ramda';
import { rest, util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import constants from '/helpers/constants';

import RestStatus from 'http-status-codes';

import appPermissionManagerJs from '/dapp/permissions/app/appPermissionManager';
import eventJs from '../event';
import eventChainJs from '../eventChain';
import factory from './event.factory.js';
// import user from '/dapp/users/user.js';
import { args } from 'commander';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of Event
 */
describe.skip('Event', function () {
    this.timeout(config.timeout);

    let globalAdmin;
    let contract;

    const member = () => `${util.uid() + 1}`.padStart(40, '0'); // Generate address
    const enode = () => 'enode://' + `${util.uid() + 1}`.padStart(130, '0') + '@1.2.3.4:30303';
    const factoryArgs = (user) => ({ ...(factory.getEventArgs(util.uid())), assetOwner: user.address });

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


    });

    it('Create Event - 201', async () => {
        // Create Event via upload
        const args = factoryArgs(globalAdmin)
        contract = await eventJs.uploadContract(globalAdmin, args, options);
        const state = await contract.getState();

        assert.notStrictEqual(
            { ...state, constructor: '' },  // Ignore constructor
            { ...args, owner: globalAdmin.address, constructor: '' });
    });

    it('addMember - 200', async () => {
        const res = await contract.addMember(member(), enode());
        assert.equal(res[0], RestStatus.OK);
    });

    it('removeMember - 200', async () => {
        const res = await contract.removeMember(member());
        assert.equal(res[0], RestStatus.OK);
    });

    it('addMembers - 200', async () => {
        const res = await contract.addMembers([member(), member(), member()], [enode(), enode(), enode()]);
        assert.equal(res[0], RestStatus.OK);
    });

    it('removeMembers - 200', async () => {
        const res = await contract.removeMembers([member(), member(), member()]);
        assert.equal(res[0], RestStatus.OK);
    });

    it('createEvent (Private chain)', async () => {
        const args = factoryArgs(globalAdmin);
        const event = await eventChainJs.createEvent(globalAdmin, args, options);
        const eventData = await event.get();
        // Sorting is needed in order to allow for chainIds to be in any order
        // Convert all fields into a string to allow for equality checking
        assert.deepInclude(
            // Convert the Event data into strings as the args are in strings
            R.map(v => '' + v, eventData),
            R.map(v => '' + v, args));
    });

    it('createEvent (Private chain, multiple)', async () => {
        const args1 = factoryArgs(globalAdmin);
        const args2 = factoryArgs(globalAdmin);
        const args3 = factoryArgs(globalAdmin);
        const args4 = factoryArgs(globalAdmin);
        const event1 = await eventChainJs.createEvent(globalAdmin, args1, options);
        const event2 = await eventChainJs.createEvent(globalAdmin, args2, options);
        const event3 = await eventChainJs.createEvent(globalAdmin, args3, options);
        const event4 = await eventChainJs.createEvent(globalAdmin, args4, options);
        const eventData1 = await event1.get();
        const eventData2 = await event2.get();
        const eventData3 = await event3.get();
        const eventData4 = await event4.get();
        // Our logic shouldn't mix up events
        assert.deepInclude(R.map(v => '' + v, eventData1), R.map(v => '' + v, args1));
        assert.deepInclude(R.map(v => '' + v, eventData2), R.map(v => '' + v, args2));
        assert.deepInclude(R.map(v => '' + v, eventData3), R.map(v => '' + v, args3));
        assert.deepInclude(R.map(v => '' + v, eventData4), R.map(v => '' + v, args4));
    });

    // it('Create an organization manager', async () => {
    //     // Create App Permission Manager
    //     const appPermissionManagerContract = await appPermissionManagerJs.uploadContract(globalAdmin, {
    //         admin: globalAdmin.address,
    //         master: globalAdmin.address,
    //     }, options);

    //     // assign role
    //     await appPermissionManagerContract.grantGlobalAdminRole({ user: globalAdmin });

    //     // Create Organization Manager
    //     const organizationManager = await organizationManagerJs.uploadContract(globalAdmin,
    //         { permissionManager: appPermissionManagerContract.address }, options);

    //     assert.notEqual(organizationManager.address, constants.zeroAddress, 'Contract address must be not zero');

    //     const { permissionManager, owner } = await organizationManager.getState();
    //     assert.equal(owner, globalAdmin.address, 'owner');
    //     assert.equal(permissionManager, appPermissionManagerContract.address, 'permissionManager');
    // });

    it('Create and transfer ownership of a Event', async () => {
        // Create our Event
        const args = factoryArgs(globalAdmin);
        const event = await eventChainJs.createEvent(globalAdmin, args, options);

        // Check if Event was created
        const eventData = await event.get();
        assert.deepInclude(R.map(v => '' + v, eventData), R.map(v => '' + v, args));

        // Create App Permission Manager
        const appPermissionManagerContract = await appPermissionManagerJs.uploadContract(globalAdmin, {
            admin: globalAdmin.address,
            master: globalAdmin.address,
        }, options);

        // assign role
        await appPermissionManagerContract.grantGlobalAdminRole({ user: globalAdmin });

        let addrToBeTransferedTo = 0x0 // TODO FILL THIS IN


        const eventResponse = await event.transferOwnership(addrToBeTransferedTo);
        assert.equal(eventResponse, RestStatus.OK)
    });

    it('Create and update a Event', async () => {
        // Create our Event
        const args = factoryArgs(globalAdmin);
        const event = await eventChainJs.createEvent(globalAdmin, args, options);

        // Check if Event was created
        const eventData = await event.get();
        assert.deepInclude(R.map(v => '' + v, eventData), R.map(v => '' + v, args));


        const args2 = factoryArgs(globalAdmin);
        const update = await event.update(args2)
        assert.equal(update[0], RestStatus.OK)
    });
});
