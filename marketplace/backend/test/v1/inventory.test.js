import { assert, rest } from 'blockapps-rest';
import { util } from '/blockapps-rest-plus';
import dotenv from 'dotenv';
import config from '../../load.config';
import oauthHelper from '/helpers/oauthHelper';
import { get, post, put } from '/helpers/rest';
import RestStatus from 'http-status-codes';

import { productArgs } from './factories/product';
import {
  inventoryArgs,
  inventoryArgsWithNoSN,
  newInventoryArgs,
  updateInventoryArgs,
} from './factories/inventory';
import { Product, Inventory } from '../../api/v1/endpoints';

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

describe('Inventory End-To-End Tests', function () {
  this.timeout(config.timeout);
  let admin;

  before(async () => {
    let adminToken;
    try {
      adminToken = await oauthHelper.getUserToken(
        `${process.env.GLOBAL_ADMIN_NAME}`,
        `${process.env.GLOBAL_ADMIN_PASSWORD}`
      );
    } catch (e) {
      console.error(
        'ERROR: Unable to fetch the org user token, check your OAuth settings in config',
        e
      );
      throw e;
    }

    const adminCredentials = { token: adminToken };

    const adminResponse = await oauthHelper.getStratoUserFromToken(
      adminCredentials.token
    );

    assert.strictEqual(
      adminResponse.status,
      RestStatus.OK,
      adminResponse.message
    );
    admin = { ...adminResponse.user, ...adminCredentials };
  });

  it('Create an Inventory', async () => {
    // create product
    const createProductArgs = {
      ...productArgs(util.uid()),
    };

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      admin.token
    );

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    const productAddress = createProductResponse.body.data[1];

    // create inventory
    const createInventoryArgs = {
      ...inventoryArgs(productAddress, util.uid()),
    };

    const createInventoryResponse = await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      admin.token
    );

    assert.equal(createInventoryResponse.status, 200, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined');
    assert.isDefined(
      createInventoryResponse.body.data,
      'body.data should be defined'
    );
  });

  it('Create an Inventory (Without Serial Number)', async () => {
    // create product
    const createProductArgs = {
      ...productArgs(util.uid()),
    };

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      admin.token
    );

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    const productAddress = createProductResponse.body.data[1];

    // create inventory
    const createInventoryArgs = {
      ...inventoryArgsWithNoSN(productAddress, util.uid()),
    };

    const createInventoryResponse = await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      admin.token
    );

    assert.equal(createInventoryResponse.status, 200, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined');
    assert.isDefined(
      createInventoryResponse.body.data,
      'body.data should be defined'
    );
  });

  it('Get an Inventory', async () => {
    // create product
    const createProductArgs = {
      ...productArgs(util.uid()),
    };

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      admin.token
    );

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    const productAddress = createProductResponse.body.data[1];

    // create inventory
    const createInventoryArgs = {
      ...inventoryArgs(productAddress, util.uid()),
    };

    const createInventoryResponse = await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      admin.token
    );

    assert.equal(createInventoryResponse.status, 200, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined');
    assert.isDefined(
      createInventoryResponse.body.data,
      'body.data should be defined'
    );

    // get inventory
    const getInventory = await get(
      Inventory.prefix,
      Inventory.get.replace(':address', createInventoryResponse.body.data[1]),
      {},
      admin.token
    );

    assert.equal(getInventory.status, 200, 'should be 200');
    assert.isDefined(getInventory.body, 'body should be defined');

    assert.equal(
      getInventory.body.data['productId'],
      createInventoryArgs['productAddress'],
      'productAddress should be equal'
    );
    assert.equal(
      getInventory.body.data['quantity'],
      createInventoryArgs['quantity'],
      'quantity should be equal'
    );
    assert.equal(
      getInventory.body.data['pricePerUnit'],
      createInventoryArgs['pricePerUnit'],
      'pricePerUnit should be equal'
    );
    assert.equal(
      getInventory.body.data['batchId'],
      createInventoryArgs['batchId'],
      'batchId should be equal'
    );
    assert.equal(
      getInventory.body.data['status'],
      createInventoryArgs['status'],
      'status should be equal'
    );
    assert.equal(
      getInventory.body.data['createdAt'],
      createInventoryArgs['createdAt'],
      'createdAt should be equal'
    );
  });

  it('Get all Inventories', async () => {
    // get
    const getInventories = await get(
      Inventory.prefix,
      Inventory.getAll,
      {},
      admin.token
    );
    assert.equal(getInventories.status, 200, 'should be 200');
    assert.isDefined(getInventories.body, 'body should be defined');
    assert.isDefined(getInventories.body.data, 'body.data should be defined');
  });

  it('Update an Inventory', async () => {
    // create product
    const createProductArgs = {
      ...productArgs(util.uid()),
    };

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      admin.token
    );

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    const productAddress = createProductResponse.body.data[1];

    // create inventory
    const createInventoryArgs = {
      ...inventoryArgs(productAddress, util.uid()),
    };

    const createInventoryResponse = await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      admin.token
    );

    assert.equal(createInventoryResponse.status, 200, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined');
    assert.isDefined(
      createInventoryResponse.body.data,
      'body.data should be defined'
    );

    const createdInventoryAddress = createInventoryResponse.body.data[1];
    const updateArgs = {
      ...updateInventoryArgs(
        productAddress,
        createdInventoryAddress,
        util.uid()
      ),
    };

    // update inventory
    const updateInventory = await put(
      Inventory.prefix,
      Inventory.update,
      updateArgs,
      admin.token
    );

    assert.equal(updateInventory.status, 200, 'should be 200');
    assert.isDefined(updateInventory.body, 'body should be defined');
    assert.isDefined(updateInventory.body.data, 'body.data should be defined');
    assert.isArray(updateInventory.body.data, 'body.data is array');
  });

  // TODO: This test should be updated. If the user does not enter a serial number, it will cause this test to fial. If numbers are entered this test still works fine.
  it('should not create inventories of duplicate serial numbers for same product', async () => {
    // create product
    const createProductArgs = {
      ...productArgs(util.uid()),
    };

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      admin.token
    );

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    const productAddress = createProductResponse.body.data[1];

    // create inventory
    const createInventoryArgs = {
      ...inventoryArgs(productAddress, util.uid()),
    };

    const createInventoryResponse1 = await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      admin.token
    );

    assert.equal(createInventoryResponse1.status, 200, 'should be 200');
    assert.isDefined(createInventoryResponse1.body, 'body should be defined');
    assert.isDefined(
      createInventoryResponse1.body.data,
      'body.data should be defined'
    );

    // create another inventory
    const createInventoryResponse2 = await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      admin.token
    );

    assert.equal(createInventoryResponse2.status, 409, 'should be 409');
  });

  it('Create an Inventory with no raw materials', async () => {
    // create product
    const createProductArgs = {
      ...productArgs(util.uid()),
    };

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      admin.token
    );

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    const productAddress = createProductResponse.body.data[1];

    // create inventory
    const createInventoryArgs = {
      ...newInventoryArgs(productAddress, util.uid()),
    };

    const createInventoryResponse = await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      admin.token
    );

    assert.equal(createInventoryResponse.status, 200, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined');
    assert.isDefined(
      createInventoryResponse.body.data,
      'body.data should be defined'
    );
  });
});
