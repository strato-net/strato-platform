import { assert, rest } from 'blockapps-rest'
import { util } from '/blockapps-rest-plus'
import dotenv from 'dotenv'
import config from '../../load.config'
import constants from '/helpers/constants'
import oauthHelper from '/helpers/oauthHelper'
import { get, post, put } from '/helpers/rest'
import RestStatus from 'http-status-codes'
import dappJs from '../../dapp/dapp/dapp'

import { productArgs, updateProductArgs } from './factories/product'
import { inventoryArgs } from './factories/inventory'
import { itemArgs, updateItemArgs } from './factories/item'
import { Item, Product, Inventory, Organizations } from '../../api/v1/endpoints'
const options = { config }

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('Item End-To-End Tests', function () {
  this.timeout(config.timeout)
  let orgAdmin

  before(async () => {
    let orgAdminToken
    try {
      orgAdminToken = await oauthHelper.getUserToken(
        `${process.env.GLOBAL_ADMIN_NAME}`,
        `${process.env.GLOBAL_ADMIN_PASSWORD}`,
      )
    } catch (e) {
      console.error(
        'ERROR: Unable to fetch the org user token, check your OAuth settings in config',
        e,
      )
      throw e
    }

    const orgAdminCredentials = { token: orgAdminToken }

    const orgAdminResponse = await oauthHelper.getStratoUserFromToken(orgAdminCredentials.token)
    console.log("adminResponse", orgAdminResponse)
    const dapp = await dappJs.loadFromDeployment(orgAdminCredentials, `${config.configDirPath}/${config.deployFilename}`, options);
    

    assert.strictEqual(
      orgAdminResponse.status,
      RestStatus.OK,
      orgAdminResponse.message
    )
    orgAdmin = { ...orgAdminResponse.user, ...orgAdminCredentials }
  })

  it('Get all Items', async () => {
    // get items
    const getItems = await get(
      Item.prefix,
      Item.getAll,
      {},
      orgAdmin.token,
    )

    assert.equal(getItems.status, 200, 'should be 200');
    assert.isDefined(getItems.body, 'body should be defined');
    assert.isDefined(getItems.body.data, 'body should be defined');
  });

  it('Get item ownership history', async () => {
    // create product
    const createProductArgs = {
      ...productArgs(util.uid()),
    }

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      orgAdmin.token
    )

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    const productAddress = createProductResponse.body.data[1]

    // create inventory
    const createInventoryArgs = {
      ...inventoryArgs(productAddress, util.uid()),
    }

    const createInventoryResponse = await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      orgAdmin.token,
    )

    assert.equal(createInventoryResponse.status, 200, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined')
    assert.isDefined(createInventoryResponse.body.data, 'body.data should be defined')

    // get item ownership history
    const getItemOwnershipHistory = await get(
      Item.prefix,
      Item.ownershipHistory.replace(':address', createInventoryResponse.body.data[2].split(',')[0]),
      {},
      orgAdmin.token,
    )

    assert.equal(getItemOwnershipHistory.status, 200, 'should be 200');
    assert.isDefined(getItemOwnershipHistory.body, 'body should be defined');
    assert.isDefined(getItemOwnershipHistory.body.data, 'body should be defined');
  });

  it('Get all Raw Materials', async () => {
    // get raw materials
    const getRawMaterials = await get(
      Item.prefix,
      Item.getRawMaterials,
      {},
      orgAdmin.token,
    )

    assert.equal(getRawMaterials.status, 200, 'should be 200');
    assert.isDefined(getRawMaterials.body, 'body should be defined');
    assert.isDefined(getRawMaterials.body.data, 'body should be defined');
  });

})
