import * as R from 'ramda';
import { util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';

import RestStatus from 'http-status-codes';
import certificateJs from '/dapp/certificates/certificate';
import productManagerJs from '../productManager';
import factory from '../factory/productManager.factory';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of Product Manager
 */
describe('Product Manager', function () {
  this.timeout(config.timeout);

  let tradingEntity;
  let contract;
  let newOptions;
  let tradingEntityOrganization;
  let certifier;

  const getfactoryArgs = () => ({ ...factory.getProductArgs(util.uid()) });
  const updatefactoryArgs = (address) => ({
    ...factory.updateProductArgs(address, util.uid()),
  });
  const inventoryFactoryArgs = () => ({
    ...factory.getInventoryArgs(util.uid()),
  });
  const inventoryFactoryArgsWithNoSN = () => ({
    ...factory.getInventoryArgsWithNoSN(util.uid()),
  });
  const updateinventoryFactoryArgs = (address, inventoryAddress) => ({
    ...factory.updateInventoryArgs(address, inventoryAddress, util.uid()),
  });
  const updateInventoriesQuantitiesFactoryArgs = (
    inventoryAddress,
    quantity
  ) => ({
    ...factory.updateInventoriesQuantitiesArgs(inventoryAddress, quantity),
  });

  before(async () => {
    assert.isDefined(
      config.configDirPath,
      'configDirPath is  missing. Set in config'
    );
    assert.isDefined(
      config.deployFilename,
      'deployFilename is missing. Set in config'
    );
    assert.isDefined(
      process.env.GLOBAL_ADMIN_NAME,
      'GLOBAL_ADMIN_NAME is missing. Add it to .env file'
    );
    assert.isDefined(
      process.env.GLOBAL_ADMIN_PASSWORD,
      'GLOBAL_ADMIN_PASSWORD is missing. Add it to .env file'
    );

    let tradingEntityUserName = process.env.GLOBAL_ADMIN_NAME;
    let tradingEntityPassword = process.env.GLOBAL_ADMIN_PASSWORD;
    let certifierUserName = process.env.CERTIFIER_NAME;
    let certifierPassword = process.env.CERTIFIER_PASSWORD;

    let tradingEntityToken;
    let certifierToken;
    try {
      tradingEntityToken = await oauthHelper.getUserToken(
        tradingEntityUserName,
        tradingEntityPassword
      );
      certifierToken = await oauthHelper.getUserToken(
        certifierUserName,
        certifierPassword
      );
    } catch (e) {
      console.error(
        'ERROR: Unable to fetch the user token, check your username and password in your .env',
        e
      );
      throw e;
    }
    let tradingEntityCredentials = { token: tradingEntityToken };
    console.log(
      "getting trading entity user's address:",
      tradingEntityUserName
    );
    const tradingEntityResponse = await oauthHelper.getStratoUserFromToken(
      tradingEntityCredentials.token
    );

    let certifierCredentials = { token: certifierToken };
    console.log("getting certifier user's address:", tradingEntityUserName);
    const certifierResponse = await oauthHelper.getStratoUserFromToken(
      certifierCredentials.token
    );

    assert.strictEqual(
      tradingEntityResponse.status,
      RestStatus.OK,
      tradingEntityResponse.message
    );
    tradingEntity = {
      ...tradingEntityResponse.user,
      ...tradingEntityCredentials,
    };

    assert.strictEqual(
      certifierResponse.status,
      RestStatus.OK,
      certifierResponse.message
    );
    certifier = { ...certifierResponse.user, ...certifierCredentials };

    const tradingEntityCert =
      await certificateJs.getCertificateMe(tradingEntity);
    tradingEntityOrganization = tradingEntityCert.organization;

    newOptions = {
      app: productManagerJs.contractName,
      org: tradingEntityOrganization,
      ...options,
    };

    contract = await productManagerJs.uploadContract(
      tradingEntity,
      {},
      newOptions
    );
  });

  it('Create a product', async () => {
    // Create Product via upload
    const args = getfactoryArgs(tradingEntity);
    const [restStatus, productAddress] = await contract.createProduct({
      ...args.productArgs,
    });

    // Check if Product was created
    const product = await contract.getProduct(
      { address: productAddress },
      newOptions
    );

    assert.deepInclude(
      // Convert the Product data into strings as the args are in strings
      R.map((v) => '' + v, product),
      R.map((v) => '' + v, { ...args.productArgs })
    );
  });

  it('Update a product', async () => {
    // Create Product via upload
    const args = getfactoryArgs();
    const [restStatus, productAddress] = await contract.createProduct({
      ...args.productArgs,
    });

    // Check if Product was created
    const product = await contract.getProduct(
      { address: productAddress },
      newOptions
    );

    assert.deepInclude(
      // Convert the Product data into strings as the args are in strings
      R.map((v) => '' + v, product),
      R.map((v) => '' + v, { ...args.productArgs })
    );

    const args2 = updatefactoryArgs(productAddress);
    const update = await contract.updateProduct(args2);
    assert.equal(update[0], RestStatus.OK);
  });

  it('Create and delete the product', async () => {
    // Create Product via upload
    const args = getfactoryArgs();
    const [restStatus, productAddress] = await contract.createProduct({
      ...args.productArgs,
    });

    // Check if Product was created
    const product = await contract.getProduct(
      { address: productAddress },
      newOptions
    );

    // delete the product
    const deleteResponse = await contract.deleteProduct({
      productAddress: productAddress,
    });
    assert.equal(deleteResponse[0], RestStatus.OK);
  });

  it('Create inventory for product', async () => {
    // Create Product via upload
    const args = getfactoryArgs();
    const [restStatus, productAddress] = await contract.createProduct({
      ...args.productArgs,
    });

    // Check if Product was created
    const product = await contract.getProduct(
      { address: productAddress },
      newOptions
    );

    assert.deepInclude(
      // Convert the Product data into strings as the args are in strings
      R.map((v) => '' + v, product),
      R.map((v) => '' + v, { ...args.productArgs })
    );

    // Create the inventory
    const inventoryArgs = inventoryFactoryArgs();
    const inventoryResponse = await contract.createInventory({
      productAddress: productAddress,
      ...inventoryArgs,
    });
    assert.equal(inventoryResponse[0], RestStatus.OK);

    // Check if Inventory was created
    const inventory = await contract.getInventory(
      { address: inventoryResponse[1] },
      newOptions
    );

    delete inventoryArgs.serialNumbers;

    assert.deepInclude(
      // Convert the Inventory data into strings as the args are in strings
      R.map((v) => '' + v, inventory),
      R.map((v) => '' + v, inventoryArgs)
    );
  });

  it('Create and update inventory for product', async () => {
    // Create Product via upload
    const args = getfactoryArgs();
    const [restStatus, productAddress] = await contract.createProduct({
      ...args.productArgs,
    });

    // Check if Product was created
    const product = await contract.getProduct(
      { address: productAddress },
      newOptions
    );

    assert.deepInclude(
      // Convert the Product data into strings as the args are in strings
      R.map((v) => '' + v, product),
      R.map((v) => '' + v, { ...args.productArgs })
    );

    // Create the inventory
    const inventoryArgs = inventoryFactoryArgs();
    const inventoryResponse = await contract.createInventory({
      productAddress: productAddress,
      ...inventoryArgs,
    });
    assert.equal(inventoryResponse[0], RestStatus.OK);

    // Check if Inventory was created
    const inventory = await contract.getInventory(
      { address: inventoryResponse[1] },
      newOptions
    );

    delete inventoryArgs.serialNumbers;

    assert.deepInclude(
      // Convert the Inventory data into strings as the args are in strings
      R.map((v) => '' + v, inventory),
      R.map((v) => '' + v, inventoryArgs)
    );

    // Update the inventory
    const updateArgs = updateinventoryFactoryArgs(
      productAddress,
      inventoryResponse[1]
    );
    const updateInventoryResponse = await contract.updateInventory(updateArgs);
    assert.equal(updateInventoryResponse[0], RestStatus.OK);
  });

  it('create products (multiple)', async () => {
    const args1 = getfactoryArgs(tradingEntity);
    const args2 = getfactoryArgs(tradingEntity);
    const args3 = getfactoryArgs(tradingEntity);
    const args4 = getfactoryArgs(tradingEntity);

    const [status1, productAddress1] = await contract.createProduct({
      ...args1.productArgs,
    });
    const [status2, productAddress2] = await contract.createProduct({
      ...args2.productArgs,
    });
    const [status3, productAddress3] = await contract.createProduct({
      ...args3.productArgs,
    });
    const [status4, productAddress4] = await contract.createProduct({
      ...args4.productArgs,
    });

    const productData1 = await contract.getProduct(
      { address: productAddress1 },
      newOptions
    );
    const productData2 = await contract.getProduct(
      { address: productAddress2 },
      newOptions
    );
    const productData3 = await contract.getProduct(
      { address: productAddress3 },
      newOptions
    );
    const productData4 = await contract.getProduct(
      { address: productAddress4 },
      newOptions
    );

    // Our logic shouldn't mix up products
    assert.deepInclude(
      R.map((v) => '' + v, productData1),
      R.map((v) => '' + v, { ...args1.productArgs })
    );
    assert.deepInclude(
      R.map((v) => '' + v, productData2),
      R.map((v) => '' + v, { ...args2.productArgs })
    );
    assert.deepInclude(
      R.map((v) => '' + v, productData3),
      R.map((v) => '' + v, { ...args3.productArgs })
    );
    assert.deepInclude(
      R.map((v) => '' + v, productData4),
      R.map((v) => '' + v, { ...args4.productArgs })
    );
  });

  it('Should create inventory for a product (with and without serial numbers)', async () => {
    // create the product
    const args = getfactoryArgs(tradingEntity);
    const [status, productAddress] = await contract.createProduct({
      ...args.productArgs,
    });

    let productData = await contract.getProduct(
      { address: productAddress },
      newOptions
    );

    assert.deepInclude(
      // Convert the Product data into strings as the args are in strings
      R.map((v) => '' + v, productData),
      R.map((v) => '' + v, { ...args.productArgs })
    );

    // create multiple inventories of product
    const inventoryArgs1 = inventoryFactoryArgs();
    const inventoryArgs2 = inventoryFactoryArgs();
    const inventoryArgs3 = inventoryFactoryArgsWithNoSN();
    const inventoryArgs4 = inventoryFactoryArgsWithNoSN();

    const [status1, inventory1] = await contract.createInventory({
      productAddress: productAddress,
      ...inventoryArgs1,
    });
    const [status2, inventory2] = await contract.createInventory({
      productAddress: productAddress,
      ...inventoryArgs2,
    });
    const [status3, inventory3] = await contract.createInventory({
      productAddress: productAddress,
      ...inventoryArgs3,
    });
    const [status4, inventory4] = await contract.createInventory({
      productAddress: productAddress,
      ...inventoryArgs4,
    });

    const inventoryData1 = await contract.getInventory(
      { address: inventory1 },
      newOptions
    );
    const inventoryData2 = await contract.getInventory(
      { address: inventory2 },
      newOptions
    );
    const inventoryData3 = await contract.getInventory(
      { address: inventory3 },
      newOptions
    );
    const inventoryData4 = await contract.getInventory(
      { address: inventory4 },
      newOptions
    );

    // Serial numbers are not stored in these contracts so we will remove them from the args
    delete inventoryArgs1.serialNumbers;
    delete inventoryArgs2.serialNumbers;
    delete inventoryArgs3.serialNumbers;
    delete inventoryArgs4.serialNumbers;

    // Our logic shouldn't mix up inventories
    assert.deepInclude(
      R.map((v) => '' + v, inventoryData1),
      R.map((v) => '' + v, inventoryArgs1)
    );
    assert.deepInclude(
      R.map((v) => '' + v, inventoryData2),
      R.map((v) => '' + v, inventoryArgs2)
    );
    assert.deepInclude(
      R.map((v) => '' + v, inventoryData3),
      R.map((v) => '' + v, inventoryArgs3)
    );
    assert.deepInclude(
      R.map((v) => '' + v, inventoryData4),
      R.map((v) => '' + v, inventoryArgs4)
    );
  });

  it('create inventory for a product (multiple) ', async () => {
    // create the product
    const args = getfactoryArgs(tradingEntity);
    const [status, productAddress] = await contract.createProduct({
      ...args.productArgs,
    });

    let productData = await contract.getProduct(
      { address: productAddress },
      newOptions
    );

    assert.deepInclude(
      // Convert the Product data into strings as the args are in strings
      R.map((v) => '' + v, productData),
      R.map((v) => '' + v, { ...args.productArgs })
    );

    // create multiple inventories of product
    const inventoryArgs1 = inventoryFactoryArgs();
    const inventoryArgs2 = inventoryFactoryArgs();
    const inventoryArgs3 = inventoryFactoryArgs();
    const inventoryArgs4 = inventoryFactoryArgs();

    const [status1, inventory1] = await contract.createInventory({
      productAddress: productAddress,
      ...inventoryArgs1,
    });
    const [status2, inventory2] = await contract.createInventory({
      productAddress: productAddress,
      ...inventoryArgs2,
    });
    const [status3, inventory3] = await contract.createInventory({
      productAddress: productAddress,
      ...inventoryArgs3,
    });
    const [status4, inventory4] = await contract.createInventory({
      productAddress: productAddress,
      ...inventoryArgs4,
    });

    const inventoryData1 = await contract.getInventory(
      { address: inventory1 },
      newOptions
    );
    const inventoryData2 = await contract.getInventory(
      { address: inventory2 },
      newOptions
    );
    const inventoryData3 = await contract.getInventory(
      { address: inventory3 },
      newOptions
    );
    const inventoryData4 = await contract.getInventory(
      { address: inventory4 },
      newOptions
    );

    delete inventoryArgs1.serialNumbers;
    delete inventoryArgs2.serialNumbers;
    delete inventoryArgs3.serialNumbers;
    delete inventoryArgs4.serialNumbers;

    // Our logic shouldn't mix up inventories
    assert.deepInclude(
      R.map((v) => '' + v, inventoryData1),
      R.map((v) => '' + v, inventoryArgs1)
    );
    assert.deepInclude(
      R.map((v) => '' + v, inventoryData2),
      R.map((v) => '' + v, inventoryArgs2)
    );
    assert.deepInclude(
      R.map((v) => '' + v, inventoryData3),
      R.map((v) => '' + v, inventoryArgs3)
    );
    assert.deepInclude(
      R.map((v) => '' + v, inventoryData4),
      R.map((v) => '' + v, inventoryArgs4)
    );
  });

  it('Create inventory for product and update quantity', async () => {
    // Create Product via upload
    const args = getfactoryArgs();
    const [restStatus, productAddress] = await contract.createProduct({
      ...args.productArgs,
    });

    // Check if Product was created
    const product = await contract.getProduct(
      { address: productAddress },
      newOptions
    );

    assert.deepInclude(
      // Convert the Product data into strings as the args are in strings
      R.map((v) => '' + v, product),
      R.map((v) => '' + v, { ...args.productArgs })
    );

    // Create the inventory
    const inventoryArgs = inventoryFactoryArgs();
    const inventoryResponse = await contract.createInventory({
      productAddress: productAddress,
      ...inventoryArgs,
    });
    assert.equal(inventoryResponse[0], RestStatus.OK);

    // Check if Inventory was created
    const updateInventoryArgs = updateInventoriesQuantitiesFactoryArgs(
      inventoryResponse[1],
      0
    );
    const [status] = await contract.updateInventoriesQuantities(
      updateInventoryArgs,
      newOptions
    );
    const inventoryData = await contract.getInventory(
      { address: inventoryResponse[1] },
      newOptions
    );
    assert.equal(status, RestStatus.OK);
  });

  it('create Product - 401', async () => {
    const args = getfactoryArgs(certifier);
    let _contract = await productManagerJs.bindAddress(
      certifier,
      contract.address,
      newOptions
    );

    await assert.restStatus(async () => {
      await _contract.createProduct({ ...args.productArgs });
    }, RestStatus.UNAUTHORIZED);
  });
});
