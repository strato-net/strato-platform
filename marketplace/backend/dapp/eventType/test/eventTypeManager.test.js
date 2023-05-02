import * as R from 'ramda';
import { rest, util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import dappJs from '/dapp/dapp/dapp';
import RestStatus from 'http-status-codes';
import eventTypeJs from '../eventType';
import eventTypeManagerJs from '../eventTypeManager';
import appPermissionManagerJs from "/dapp/permissions/app/appPermissionManager";
import factory from '../factory/eventTypeManager.factory';
import { args } from 'commander';
import certificateJs from '/dapp/certificates/certificate'

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

describe('Event Type Manager', function () {
    this.timeout(config.timeout);

    let globalAdmin;
    let contract;
    let dapp;
    let newOptions;
    let permissionManagerContract;
    let adminOrganization;

    const factoryArgs = (user) => ({ ...(factory.getEventTypeArgs(util.uid())) });

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
            console.erroe("ERROR: Unable to fetch the user token, check your username and password in your .env", e)
            throw e
        }
        let adminCredentials = { token: adminUserToken }
        console.log("getting admin user's address", adminUserName)
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

        dapp = await dappJs.loadFromDeployment({ token: adminUserToken }, `${config.configDirPath}/${config.deployFilename}`, options);
        newOptions = {
            app: eventTypeManagerJs.contractName,
            org: adminOrganization,
            ...options
        }

         // deploy permission manager
         permissionManagerContract = await appPermissionManagerJs.uploadContract(
            globalAdmin,
            {
                admin: globalAdmin.address,
                master: globalAdmin.address,
            },
            options
            );

        await permissionManagerContract.grantTradingEntityRole({
            user:globalAdmin
        })
       
        contract = await eventTypeManagerJs.uploadContract(globalAdmin, {
            permissionManager:permissionManagerContract.address
         }, newOptions);
    });

    it('Create Event Type', async () => {
        const args = factoryArgs(globalAdmin);

        const [status, eventTypeAddress] = await contract.createEventType(args);
        assert.equal(status, RestStatus.CREATED);

        let eventTypeData = await contract.get({ address: eventTypeAddress });

        assert.deepInclude(
            // Convert the Event Type data into strings as the args are in strings
            R.map(v => '' + v, eventTypeData),
            R.map(v => '' + v, args)
        );
    });

    it('Create multiple Event Types', async () => {
        const args1 = factoryArgs(globalAdmin);
        const args2 = factoryArgs(globalAdmin);
        const args3 = factoryArgs(globalAdmin);
        const args4 = factoryArgs(globalAdmin);
        const args5 = factoryArgs(globalAdmin);

        const [status1, eventTypeAddress1] = await contract.createEventType(args1);
        const [status2, eventTypeAddress2] = await contract.createEventType(args2);
        const [status3, eventTypeAddress3] = await contract.createEventType(args3);
        const [status4, eventTypeAddress4] = await contract.createEventType(args4);
        const [status5, eventTypeAddress5] = await contract.createEventType(args5);

        assert.equal(status1, RestStatus.CREATED);
        assert.equal(status2, RestStatus.CREATED);
        assert.equal(status3, RestStatus.CREATED);
        assert.equal(status4, RestStatus.CREATED);
        assert.equal(status5, RestStatus.CREATED);

        let eventTypeData1 = await contract.get({ address: eventTypeAddress1 });
        let eventTypeData2 = await contract.get({ address: eventTypeAddress2 });
        let eventTypeData3 = await contract.get({ address: eventTypeAddress3 });
        let eventTypeData4 = await contract.get({ address: eventTypeAddress4 });
        let eventTypeData5 = await contract.get({ address: eventTypeAddress5 });

        assert.deepInclude(
            R.map(v => '' + v, eventTypeData1),
            R.map(v => '' + v, args1)
        );
        assert.deepInclude(
            R.map(v => '' + v, eventTypeData2),
            R.map(v => '' + v, args2)
        );
        assert.deepInclude(
            R.map(v => '' + v, eventTypeData3),
            R.map(v => '' + v, args3)
        );
        assert.deepInclude(
            R.map(v => '' + v, eventTypeData4),
            R.map(v => '' + v, args4)
        );
        assert.deepInclude(
            R.map(v => '' + v, eventTypeData5),
            R.map(v => '' + v, args5)
        );
    });

    it('get Event Type', async () => {
        const args1 = factoryArgs(globalAdmin);
        const [status, eventTypeAddress] = await contract.createEventType(args1);
        assert.equal(status, RestStatus.CREATED);

        let eventTypeData = await contract.get({ address: eventTypeAddress });

        assert.deepInclude(
            R.map(v => '' + v, eventTypeData),
            R.map(v => '' + v, args1)
        );
    })

    it('getAll Event Types', async () => {
        const args1 = factoryArgs(globalAdmin);
        const args2 = factoryArgs(globalAdmin);
        const args3 = factoryArgs(globalAdmin);
        const args4 = factoryArgs(globalAdmin);
        const args5 = factoryArgs(globalAdmin);

        const [status1, eventTypeAddress1] = await contract.createEventType(args1);
        const [status2, eventTypeAddress2] = await contract.createEventType(args2);
        const [status3, eventTypeAddress3] = await contract.createEventType(args3);
        const [status4, eventTypeAddress4] = await contract.createEventType(args4);
        const [status5, eventTypeAddress5] = await contract.createEventType(args5);

        assert.equal(status1, RestStatus.CREATED);
        assert.equal(status2, RestStatus.CREATED);
        assert.equal(status3, RestStatus.CREATED);
        assert.equal(status4, RestStatus.CREATED);
        assert.equal(status5, RestStatus.CREATED);


        let eventTypes = await contract.getAll();

        assert.equal(eventTypes.length >= 5, true);

        // Check the end of the array to see if the last 5 event types are the ones we just created
        assert.deepInclude(
            R.map(v => '' + v, eventTypes[eventTypes.length - 5]),
            R.map(v => '' + v, args1)
        );

        assert.deepInclude(
            R.map(v => '' + v, eventTypes[eventTypes.length - 4]),
            R.map(v => '' + v, args2)
        );

        assert.deepInclude(
            R.map(v => '' + v, eventTypes[eventTypes.length - 3]),
            R.map(v => '' + v, args3)
        );

        assert.deepInclude(
            R.map(v => '' + v, eventTypes[eventTypes.length - 2]),
            R.map(v => '' + v, args4)
        );

        assert.deepInclude(
            R.map(v => '' + v, eventTypes[eventTypes.length - 1]),
            R.map(v => '' + v, args5)
        );
    })
});

