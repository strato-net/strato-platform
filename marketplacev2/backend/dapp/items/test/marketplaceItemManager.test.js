import * as R from 'ramda';
import { util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';

import RestStatus from 'http-status-codes';
import certificateJs from '/dapp/certificates/certificate'
import marketplaceItemManagerJs from '../marketplaceItemManager';
import factory from '../factory/marketplaceItemManager.factory';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of the Marketplace Item Manager
 */
describe('Marketplace Item Manager', function () {
  this.timeout(config.timeout);

  let tradingEntity;
  let contract;
  let newOptions;
  let tradingEntityOrganization;
  let certifier;

  const addMItemFactoryArgs = () => ({ ...(factory.addMarketplaceItemArgs(util.uid())) });
  const updateItemFactoryArgs = (address) => ({ ...(factory.updateItemArgs(address, util.uid())) });
  const addEventFactoryArgs = (address, certifierAddress) => ({ ...(factory.addEventArgs(address, certifierAddress, util.uid())) });
  const certifyEventFactoryArgs = (address) => ({ ...(factory.certifyEventArgs(address, util.uid())) });
  const updateProductFactoryArgs = (address) => ({ ...(factory.updateProductArgs(address, util.uid())) });
  const deleteProductFactoryArgs = (address) => ({ ...(factory.deleteProductArgs(address, util.uid())) });
  const updateInventoryFactoryArgs = (address) => ({ ...(factory.updateInventoryArgs(address, util.uid())) });
  const updateIQuantitiesFactoryArgs = (address, quantity) => ({ ...(factory.updateInventoriesQuantitiesArgs(address, quantity)) });

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

      let tradingEntityUserName = process.env.GLOBAL_ADMIN_NAME;
      let tradingEntityPassword = process.env.GLOBAL_ADMIN_PASSWORD;
      let certifierUserName = process.env.CERTIFIER_NAME;
      let certifierPassword = process.env.CERTIFIER_PASSWORD;

      let tradingEntityToken;
      let certifierToken;
      try {
          tradingEntityToken = await oauthHelper.getUserToken(tradingEntityUserName, tradingEntityPassword)
          certifierToken = await oauthHelper.getUserToken(certifierUserName, certifierPassword)
      } catch (e) {
          console.error("ERROR: Unable to fetch the user token, check your username and password in your .env", e)
          throw e
      }
      let tradingEntityCredentials = { token: tradingEntityToken }
      console.log("getting trading entity user's address:", tradingEntityUserName)
      const tradingEntityResponse = await oauthHelper.getStratoUserFromToken(tradingEntityCredentials.token);

      let certifierCredentials = { token: certifierToken }
      console.log("getting certifier user's address:", tradingEntityUserName)
      const certifierResponse = await oauthHelper.getStratoUserFromToken(certifierCredentials.token);

      assert.strictEqual(
          tradingEntityResponse.status,
          RestStatus.OK,
          tradingEntityResponse.message
      )
      tradingEntity = { ...tradingEntityResponse.user, ...tradingEntityCredentials }

      assert.strictEqual(
          certifierResponse.status,
          RestStatus.OK,
          certifierResponse.message
      )
      certifier = { ...certifierResponse.user, ...certifierCredentials }

      const tradingEntityCert = await certificateJs.getCertificateMe(tradingEntity);
      tradingEntityOrganization = tradingEntityCert.organization;

      newOptions = {
          app: marketplaceItemManagerJs.contractName,
          org: tradingEntityOrganization,
          ...options
      }

      contract = await marketplaceItemManagerJs.uploadContract(tradingEntity, {}, newOptions);
      certifierAddress = certifier.address;
  });

  it('Create a marketplace item', async () => {
      // Create marketplace item via upload
      const args = addMItemFactoryArgs(tradingEntity);
      const [restStatus, itemAddress] = await contract.addMarketplaceItem({ ...args.itemArgs });

      // Check if the marketplace item was created
      const item = await contract.getItem({ address: itemAddress }, newOptions);

      assert.deepInclude(
          // Convert the marketplace item data into strings as the args are in strings
          R.map(v => '' + v, item),
          R.map(v => '' + v, { ...args.itemArgs }));
  });

  it('Create an event', async () => {
      // Create marketplace item via upload
      const args = addMItemFactoryArgs(tradingEntity);
      const [restStatus, itemAddress] = await contract.addMarketplaceItem({ ...args.itemArgs });

      // Check if the marketplace item was created
      const item = await contract.getItem({ address: itemAddress }, newOptions);

      assert.deepInclude(
          // Convert the marketplace item data into strings as the args are in strings
          R.map(v => '' + v, item),
          R.map(v => '' + v, { ...args.itemArgs }));

      // Create Event via upload
      const args2 = addEventFactoryArgs(itemAddress, certifierAddress);
      const [restStatus2, eventAddresses] = await contract.addEvent(args2);

      const eventAddressArr = eventAddresses.split(",");
      assert.equal(restStatus2, RestStatus.CREATED);

      // Check if Event was created
      const events = await contract.getEvents({ address: eventAddressArr }, newOptions);

      assert.equal(restStatus2, RestStatus.CREATED);
      assert.equal(events.length, eventArgs.itemsAddress.length);

      events.forEach(event => {
          assert.deepInclude(R.map(v => '' + v, event),
              R.map(v => '' + v, { eventTypeId: eventArgs.eventTypeId, eventBatchId: eventArgs.eventBatchId, date: eventArgs.date, summary: eventArgs.summary, certifier: eventArgs.certifier, createdDate: eventArgs.createdDate }));
      });
  });

  it('certify an event', async () => {
      // Create marketplace item via upload
      const args = addMItemFactoryArgs(tradingEntity);
      const [restStatus, itemAddress] = await contract.addMarketplaceItem({ ...args.itemArgs });

      // Check if the marketplace item was created
      const item = await contract.getItem({ address: itemAddress }, newOptions);

      assert.deepInclude(
          // Convert the marketplace item data into strings as the args are in strings
          R.map(v => '' + v, item),
          R.map(v => '' + v, { ...args.itemArgs }));

      // Create Event via upload
      const args2 = addEventFactoryArgs(itemAddress, certifierAddress);
      const [restStatus2, eventAddresses] = await contract.addEvent(args2);

      const eventAddressArr = eventAddresses.split(",");
      assert.equal(restStatus2, RestStatus.CREATED);

      // Check if Event was created
      const events = await contract.getEvents({ address: eventAddressArr }, newOptions);

      assert.equal(restStatus2, RestStatus.CREATED);
      assert.equal(events.length, eventArgs.itemsAddress.length);

      const eventAddress = events.map(event => event.address);

      const _contract = await marketplaceItemManagerJs.bindAddress(
          certifier,
          contract.address,
          newOptions
      )

      // Update an Event
      const certifyEventArgs = certifyEventFactoryArgs(eventAddress);
      const [status, responseMessage] = await marketplaceItemManagerJs.certifyEvent(certifier, _contract, certifyEventArgs, newOptions);
      assert.equal(status, RestStatus.OK)
      assert.equal(responseMessage, "event has been certified")

      // Check if Event has been updated
      const updatedEvents = await contract.getEvents({ address: eventAddressArr }, newOptions);
      assert.equal(updatedEvents[0].certifierComment, certifyEventArgs.updates['certifierComment'])
      assert.equal(updatedEvents[0].certifiedDate, certifyEventArgs['certifiedDate'])
  });

  it('Other than assigned certifier no one can update the event -401', async () => {
      // Create marketplace item via upload
      const args = addMItemFactoryArgs(tradingEntity);
      const [restStatus, itemAddress] = await contract.addMarketplaceItem({ ...args.itemArgs });

      // Check if the marketplace item was created
      const item = await contract.getItem({ address: itemAddress }, newOptions);

      assert.deepInclude(
          // Convert the marketplace item data into strings as the args are in strings
          R.map(v => '' + v, item),
          R.map(v => '' + v, { ...args.itemArgs }));

      // Create Event via upload
      const args2 = addEventFactoryArgs(itemAddress, certifierAddress);
      const [restStatus2, eventAddresses] = await contract.addEvent(args2);

      const eventAddressArr = eventAddresses.split(",");
      assert.equal(restStatus2, RestStatus.CREATED);

      // Check if Event was created
      const events = await contract.getEvents({ address: eventAddressArr }, newOptions);

      assert.equal(restStatus2, RestStatus.CREATED);
      assert.equal(events.length, eventArgs.itemsAddress.length);

      const eventAddress = events.map(event => event.address);

      const _contract = await marketplaceItemManagerJs.bindAddress(
          tradingEntity,
          contract.address,
          newOptions
      )

      // Update an Event
      const certifyEventArgs = certifyEventFactoryArgs(eventAddress);

      await assert.restStatus(async () => {
        await marketplaceItemManagerJs.certifyEvent(tradingEntity, _contract, certifyEventArgs, newOptions);
      }, RestStatus.UNAUTHORIZED);
  });

  it('Get marketplace item ownership history', async () => {
      // Create a marketplace item via upload
      const args = addMItemFactoryArgs(tradingEntity);
      const [restStatus, itemAddress] = await contract.addMarketplaceItem({ ...args.itemArgs });

      const itemAddressArr = itemAddress.split(",");
      const itemEvents = await contract.getAllOwnershipEvents({ itemAddress: itemAddressArr }, newOptions);

      assert.equal(itemEvents.length, args.itemArgs.itemObject.length)
  });

  it('Update marketplace item', async () => {
      // Create a marketplace item via upload
      const args = addMItemFactoryArgs(tradingEntity);
      const [restStatus, itemAddress] = await contract.addMarketplaceItem({ ...args.itemArgs });

      // Check if the marketplace item was created
      const item = await contract.getItem({ address: itemAddress }, newOptions);

      assert.deepInclude(
          // Convert the marketplace item data into strings as the args are in strings
          R.map(v => '' + v, item),
          R.map(v => '' + v, { ...args.itemArgs }));

      const args2 = updateItemFactoryArgs(itemAddress);
      const update = await contract.updateItem(args2);
      assert.equal(update[0], RestStatus.OK)

      const updatedItem = await contract.getItems({ address: itemAddress }, newOptions);
      assert.equal(updatedItem[0].status, args2['status'])
      assert.equal(updatedItem[0].comment, args2['comment'])
  });

  it('Update the product of a marketplace item', async () => {
      // Create a marketplace item via upload
      const args = addMItemFactoryArgs(tradingEntity);
      const [restStatus, itemAddress] = await contract.addMarketplaceItem({ ...args.itemArgs });

      // Check if the marketplace item was created
      const item = await contract.getItem({ address: itemAddress }, newOptions);

      assert.deepInclude(
          // Convert the marketplace item data into strings as the args are in strings
          R.map(v => '' + v, item),
          R.map(v => '' + v, { ...args.itemArgs }));

      const args2 = updateProductFactoryArgs(itemAddress);
      const update = await contract.updateProduct(args2);
      assert.equal(update[0], RestStatus.OK)
  });

  it('Create a marketplace item and delete the product', async () => {
      // Create a marketplace item via upload
      const args = addMItemFactoryArgs(tradingEntity);
      const [restStatus, itemAddress] = await contract.addMarketplaceItem({ ...args.itemArgs });

      // Check if the marketplace item was created
      const item = await contract.getItem({ address: itemAddress }, newOptions);

      // Delete the product
      const args2 = deleteProductFactoryArgs(itemAddress);
      const deleteResponse = await contract.deleteProduct(args2);
      assert.equal(deleteResponse[0], RestStatus.OK);
  })

  it('Create a marketplace item and update inventory', async () => {
      // Create a marketplace item via upload
      const args = addMItemFactoryArgs(tradingEntity);
      const [restStatus, itemAddress] = await contract.addMarketplaceItem({ ...args.itemArgs });

      // Check if the marketplace item was created
      const item = await contract.getItem({ address: itemAddress }, newOptions);

      assert.deepInclude(
          // Convert the marketplace item data into strings as the args are in strings
          R.map(v => '' + v, item),
          R.map(v => '' + v, { ...args.itemArgs }));

      // Update the inventory
      const args2 = updateInventoryFactoryArgs(itemAddress);
      const updateInventoryResponse = await contract.updateInventory(args2);
      assert.equal(updateInventoryResponse[0], RestStatus.OK);
  })

  it('create products (multiple)', async () => {
      const args1 = addMItemFactoryArgs(tradingEntity);
      const args2 = addMItemFactoryArgs(tradingEntity);
      const args3 = addMItemFactoryArgs(tradingEntity);
      const args4 = addMItemFactoryArgs(tradingEntity);

      const [status1, itemAddress1] = await contract.addMarketplaceItem({ ...args1.itemArgs });
      const [status2, itemAddress2] = await contract.addMarketplaceItem({ ...args2.itemArgs });
      const [status3, itemAddress3] = await contract.addMarketplaceItem({ ...args3.itemArgs });
      const [status4, itemAddress4] = await contract.addMarketplaceItem({ ...args4.itemArgs });

      const itemData1 = await contract.getItem({ address: itemAddress1 }, newOptions);
      const itemData2 = await contract.getItem({ address: itemAddress2 }, newOptions);
      const itemData3 = await contract.getItem({ address: itemAddress3 }, newOptions);
      const itemData4 = await contract.getItem({ address: itemAddress4 }, newOptions);

      assert.deepInclude(R.map(v => '' + v, itemData1), R.map(v => '' + v, { ...args1.itemArgs }));
      assert.deepInclude(R.map(v => '' + v, itemData2), R.map(v => '' + v, { ...args2.itemArgs }));
      assert.deepInclude(R.map(v => '' + v, itemData3), R.map(v => '' + v, { ...args3.itemArgs }));
      assert.deepInclude(R.map(v => '' + v, itemData4), R.map(v => '' + v, { ...args4.itemArgs }));
  });

  it('Create marketplace item and update inventory quantity', async () => {
      // Create a marketplace item via upload
      const args = addMItemFactoryArgs(tradingEntity);
      const [restStatus, itemAddress] = await contract.addMarketplaceItem({ ...args.itemArgs });

      // Check if the marketplace item was created
      const item = await contract.getItem({ address: itemAddress }, newOptions);

      assert.deepInclude(
          // Convert the marketplace item data into strings as the args are in strings
          R.map(v => '' + v, item),
          R.map(v => '' + v, { ...args.itemArgs }));

      const args2 = updateIQuantitiesFactoryArgs(itemAddress, 0);
      const [status,] = await contract.updateInventoriesQuantities(args2, newOptions);
      const item2 = await contract.getItem({ address: itemAddress }, newOptions);
      assert.equal(status, RestStatus.OK);
  });

  it('create MarketplaceItemManager - 401', async () => {
      const args = addMItemFactoryArgs(certifier);
      let _contract = await marketplaceItemManagerJs.bindAddress(
          certifier,
          contract.address,
          newOptions
      )


      await assert.restStatus(async () => {
          await _contract.addMarketplaceItem({ ...args.itemArgs });
      }, RestStatus.UNAUTHORIZED);
  });
}); 