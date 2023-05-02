import * as R from 'ramda';
import { rest, util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import RestStatus from 'http-status-codes';

import appPermissionManagerJs from "/dapp/permissions/app/appPermissionManager";
import itemManagerJs from '../itemManager';
import itemManagerFactory from '/dapp/items/factory/itemManager.factory.js';
import certificateJs from '/dapp/certificates/certificate'

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of Item Manager
 */
describe('Item Manager', function () {
    this.timeout(config.timeout);

    let globalAdmin;
    let certifier;
    let certifierAddress;
    let contract;
    let newOptions;
    let args = {};
    let permissionManagerContract;

    const getfactoryArgs = () => ({ ...(itemManagerFactory.getItemArgs(util.uid())) });
    const eventFactoryArgs = (itemsAddress, certifierAddress) => ({ ...(itemManagerFactory.getEventArgs(itemsAddress, certifierAddress, util.uid())) });
    const updatefactoryArgs = (address) => ({ ...(itemManagerFactory.updateItemArgs(address, util.uid())) });
    const certifyEventFactoryArgs = (eventAddress) => ({ ...(itemManagerFactory.certifyEventArgs(eventAddress, util.uid())) });


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

        let certifierName = process.env.CERTIFIER_NAME
        let certifierPassword = process.env.CERTIFIER_PASSWORD

        let adminUserToken
        let certifierToken

        try {
            adminUserToken = await oauthHelper.getUserToken(adminUserName, adminUserPassword)
            certifierToken = await oauthHelper.getUserToken(certifierName, certifierPassword)
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

        let certifierCredentials = { token: certifierToken }
        console.log("getting admin user's address:", certifierName)
        const certifierResponse = await oauthHelper.getStratoUserFromToken(certifierCredentials.token)

        assert.strictEqual(
            certifierResponse.status,
            RestStatus.OK,
            certifierResponse.message
        )
        certifier = { ...certifierResponse.user, ...certifierCredentials }

        const cert = await certificateJs.getCertificateMe(globalAdmin)
        const userOrganization = cert.organization;

        newOptions = {
            app: itemManagerJs.contractName,
            org: userOrganization,
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

            await permissionManagerContract.grantCertifierRole({
                user:certifier
            })

        contract = await itemManagerJs.uploadContract(globalAdmin, {
            permissionManager:permissionManagerContract.address
         }, newOptions);
        certifierAddress = certifier.address;
    });

    it('Create an event', async () => {
        // Create Item via itemManager
        const args = getfactoryArgs()
        const [restStatus1, itemAddresses,] = await contract.addItem(args.itemArgs);

        const itemAddressArr = itemAddresses.split(",");

        // Check if Item was created
        const items = await contract.getItems({ address: itemAddressArr }, newOptions)
        assert.equal(restStatus1, RestStatus.OK);
        assert.equal(items.length, args.itemArgs.itemObject.length)

        const itemsAddress = items.map(item => item.address)
        // Create Event via upload
        const eventArgs = eventFactoryArgs(itemsAddress, certifierAddress)
        const [restStatus2, eventAddresses] = await contract.addEvent({ ...eventArgs });

        const eventAddressArr = eventAddresses.split(",");
        assert.equal(restStatus2, RestStatus.CREATED);

        // Check if Event was created
        const events = await contract.getEvents({ address: eventAddressArr }, newOptions)

        assert.equal(restStatus2, RestStatus.CREATED);
        assert.equal(events.length, eventArgs.itemsAddress.length)

        events.forEach(event => {
            assert.deepInclude(R.map(v => '' + v, event),
                R.map(v => '' + v, { appChainId: eventArgs.appChainId, eventTypeId: eventArgs.eventTypeId, eventBatchId: eventArgs.eventBatchId, date: eventArgs.date, summary: eventArgs.summary, certifier: eventArgs.certifier, createdDate: eventArgs.createdDate }));
        });
    });

    it('certify an event', async () => {
        // Create Item via itemManager
        const args = getfactoryArgs()
        const [restStatus1, itemAddresses,] = await contract.addItem(args.itemArgs);

        const itemAddressArr = itemAddresses.split(",");

        // Check if Item was created
        const items = await contract.getItems({ address: itemAddressArr }, newOptions)

        assert.equal(restStatus1, RestStatus.OK);
        assert.equal(items.length, args.itemArgs.itemObject.length)

        const itemsAddress = items.map(item => item.address)
        // Create Event via upload
        const eventArgs = eventFactoryArgs(itemsAddress, certifierAddress)
        const [restStatus2, eventAddresses] = await contract.addEvent({ ...eventArgs });

        const eventAddressArr = eventAddresses.split(",");
        assert.equal(restStatus2, RestStatus.CREATED);

        // Check if Event was created
        const events = await contract.getEvents({ address: eventAddressArr }, newOptions)

        assert.equal(restStatus2, RestStatus.CREATED);
        assert.equal(events.length, eventArgs.itemsAddress.length)

        const eventAddress = events.map(event => event.address);

        // const _contract = {
        //     name: contract.name,
        //     address: contract.address
        // }

        const _contract = await itemManagerJs.bindAddress(
            certifier,
            contract.address,
            newOptions
        )
        // Update an Event
        const certifyEventArgs = certifyEventFactoryArgs(eventAddress);
        const [status, responseMessage] = await itemManagerJs.certifyEvent(certifier, _contract, certifyEventArgs, newOptions);
        assert.equal(status, RestStatus.OK)
        assert.equal(responseMessage, "event has been certified")

        // Check if Event has been updated
        const updatedEvents = await contract.getEvents({ address: eventAddressArr }, newOptions)
        assert.equal(updatedEvents[0].certifierComment, certifyEventArgs.updates['certifierComment'])
        assert.equal(updatedEvents[0].certifiedDate, certifyEventArgs['certifiedDate'])

    });

    it('Other than assigned certifier no one can update the event -401', async () => {
        // Create Item via itemManager
        const args = getfactoryArgs()
        const [restStatus1, itemAddresses,] = await contract.addItem(args.itemArgs);

        const itemAddressArr = itemAddresses.split(",");

        // Check if Item was created
        const items = await contract.getItems({ address: itemAddressArr }, newOptions)

        assert.equal(restStatus1, RestStatus.OK);
        assert.equal(items.length, args.itemArgs.itemObject.length)

        const itemsAddress = items.map(item => item.address)
        // Create Event via upload
        const eventArgs = eventFactoryArgs(itemsAddress, certifierAddress)
        const [restStatus2, eventAddresses] = await contract.addEvent({ ...eventArgs });

        const eventAddressArr = eventAddresses.split(",");
        assert.equal(restStatus2, RestStatus.CREATED);

        // Check if Event was created
        const events = await contract.getEvents({ address: eventAddressArr }, newOptions)

        assert.equal(restStatus2, RestStatus.CREATED);
        assert.equal(events.length, eventArgs.itemsAddress.length)

        const eventAddress = events.map(event => event.address);

        const _contract = await itemManagerJs.bindAddress(
            globalAdmin,
            contract.address,
            newOptions
        )
        // Update an Event
        const certifyEventArgs = certifyEventFactoryArgs(eventAddress);
        
        await assert.restStatus(async () => {
            await  itemManagerJs.certifyEvent(globalAdmin, _contract, certifyEventArgs, newOptions);
        }, RestStatus.UNAUTHORIZED);

    
    });

    it('ItemManager: Create item', async () => {
        // Create Item via itemManager
        const args = getfactoryArgs()
        const [restStatus, itemAddresses,] = await contract.addItem(args.itemArgs);

        const itemAddressArr = itemAddresses.split(",");

        // Check if Raw Materials were created
        const rawMaterials = await contract.getRawMaterials({}, newOptions)
        // assert.equal(rawMaterials.length, args.itemArgs.itemObject.length)
    });

    it('ItemManager: get item ownership history', async () => {
        // Create Item via itemManager
        const args = getfactoryArgs()
        const [, itemAddresses,] = await contract.addItem(args.itemArgs);

        const itemAddressArr = itemAddresses.split(",");
        const itemEvents = await contract.getAllOwnershipEvents({ itemAddress: itemAddressArr }, newOptions)

        assert.equal(itemEvents.length, args.itemArgs.itemObject.length)
    })

    it('ItemManager: Should return repeated serialNumber for a UPC', async () => {
        // Create Item via itemManager
        const args = getfactoryArgs()
        const [restStatus, itemAddresses,] = await contract.addItem(args.itemArgs);

        const [, , repeatedSerialNumbers] = await contract.addItem(args.itemArgs);
        console.log(repeatedSerialNumbers);
        // Convert the Item data into strings as the args are in strings
        assert.deepInclude(repeatedSerialNumbers, R.map(v => '' + v, args.itemArgs.itemObject.length));
    });

    it('Update item', async () => {
        // Create Item via upload
        const args = getfactoryArgs(globalAdmin)
        const [restStatus, itemAddresses] = await contract.addItem(args.itemArgs);
        assert.equal(restStatus, RestStatus.OK);

        // Check if Item was created
        const itemAddressArr = itemAddresses.split(",").filter(address => address != "");
        const item = await contract.getItems({ address: itemAddressArr }, newOptions);
        assert.equal(item.length, args.itemArgs.itemObject.length)

        const args2 = updatefactoryArgs(itemAddressArr);
        const update = await contract.updateItem(args2)
        assert.equal(update[0], RestStatus.OK)

        const updatedItem = await contract.getItems({ address: itemAddressArr }, newOptions);
        assert.equal(updatedItem[0].status, args2['status'])
        assert.equal(updatedItem[0].comment, args2['comment'])
    });

    // TODO: need to be implemented later
    // it('Create and transfer ownership of a Item', async () => {
    //     // Create Item via itemManager
    //     const args = getfactoryArgs()
    //     const [restStatus, itemAddresses,] = await contract.addItem(args.itemArgs);  
    //     const itemAddressArr = itemAddresses.split(",").filter(address => address !== "");

    //     // get items before transfer of ownership
    //     const beforeTransferOwnership = await contract.getItems({ address: itemAddressArr }, newOptions);

    //     // transfer ownership of items
    //     const itemResponse = await contract.transferOwnership({itemsAddress: itemAddressArr, newOwner: constants.testOrg3 });      
    //     assert.equal(itemResponse[0], RestStatus.OK);

    //     // get items after transfer of ownership
    //     const afterTransferOwnership = await contract.getItems({ address: itemAddressArr }, newOptions);
    //     assert.notEqual(beforeTransferOwnership[0].owner, afterTransferOwnership[0].owner);
    //     assert.notEqual(beforeTransferOwnership[0].ownerCommonName, afterTransferOwnership[0].ownerCommonName);
    // });
});