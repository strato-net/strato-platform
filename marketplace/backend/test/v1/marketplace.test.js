import * as R from 'ramda';
import { rest, util, assert } from '/blockapps-rest-plus';
import dotenv from 'dotenv'
import config from '../../load.config'
import oauthHelper from '/helpers/oauthHelper'
import RestStatus from 'http-status-codes';
import { get, post, put } from '/helpers/rest'


import { marketplaceArgs, categoryArgs, subCategoryArgs, productArgs, inventoryArgs } from './factories/marketplace'
import { Category, SubCategory, Marketplace, Product, Inventory } from '../../api/v1/endpoints'

const options = { config }

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('Marketplace End-To-End Tests', function () {
  this.timeout(config.timeout)
  let seller, buyer

  before(async () => {
    let sellerToken, buyerToken
    try {
      sellerToken = await oauthHelper.getUserToken(
        `${process.env.TEST_SELLER_ORG}`,
        `${process.env.TEST_SELLER_PASSWORD}`,
      )
      buyerToken = await oauthHelper.getUserToken(
        `${process.env.TEST_BUYER_ORG}`,
        `${process.env.TEST_BUYER_PASSWORD}`,
      )
    } catch (e) {
      console.error(
        'ERROR: Unable to fetch the  user token, check your OAuth settings in config',
        e,
      )
      throw e
    }

    const sellerCredentials = { token: sellerToken }
    const buyerCredentials = { token: buyerToken }

    const sellerResponse = await oauthHelper.getStratoUserFromToken(sellerCredentials.token)
    const buyerResponse = await oauthHelper.getStratoUserFromToken(buyerCredentials.token)


    assert.strictEqual(
      sellerResponse.status,
      RestStatus.OK,
      sellerResponse.message
    )
    seller = { ...sellerResponse.user, ...sellerCredentials }

    assert.strictEqual(
      buyerResponse.status,
      RestStatus.OK,
      buyerResponse.message
    )
    buyer = { ...buyerResponse.user, ...buyerCredentials }
  })

  it('Get all inventories with filter for seller', async () => {
    const createArgs = {
      ...categoryArgs(util.uid()),
    }

    const createResponse = await post(
      Category.prefix,
      Category.create,
      createArgs,
      seller.token,
    )

    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined')
    assert.isDefined(createResponse.body.data, 'body.data should be defined')

    const createSubCategoryArgs = {
      ...subCategoryArgs(createResponse.body.data[1], util.uid()),
    }

    const createSubCategoryResponse = await post(
      SubCategory.prefix,
      SubCategory.create,
      createSubCategoryArgs,
      seller.token,
    )

    assert.equal(createSubCategoryResponse.status, 200, 'should be 200');
    assert.isDefined(createSubCategoryResponse.body, 'body should be defined')

    // create product
    const createProductArgs = {
      ...productArgs(util.uid(), createResponse.body.data[1], createSubCategoryResponse.body.data[1]),
    }

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      seller.token
    )

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    // get product
    const getProduct = await get(
      Product.prefix,
      Product.get.replace(':address', createProductResponse.body.data[1]),
      {},
      seller.token,
    )

    assert.equal(getProduct.status, 200, 'should be 200');
    assert.isDefined(getProduct.body, 'body should be defined');

    // create inventory
    const createInventoryArgs = {
      ...inventoryArgs(createProductResponse.body.data[1], util.uid()),
    }

    const createInventoryResponse = await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      seller.token,
    )

    assert.equal(createInventoryResponse.status, 200, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined')
    assert.isDefined(createInventoryResponse.body.data, 'body.data should be defined')

    const marketArgs = {
      ...marketplaceArgs(getProduct.body.data.categoryId, getProduct.body.data.subCategoryId, getProduct.body.data.name, getProduct.body.data.manufacturer),
    }

    // get
    const marketplace = await get(
      Marketplace.prefix,
      Marketplace.getAll,
      marketArgs,
      seller.token,
    )

    console.log("marketplace", marketplace.body.data)

    assert.equal(marketplace.status, 200, 'should be 200');
    assert.isDefined(marketplace.body, 'body should be defined');
    assert.isDefined(marketplace.body.data, 'body should be defined');
    assert.lengthOf(marketplace.body.data, 1, "Marketplace should be empty.");
  })

  it('Get all inventories with filter for buyer', async () => {
    const createArgs = {
      ...categoryArgs(util.uid()),
    }

    const createResponse = await post(
      Category.prefix,
      Category.create,
      createArgs,
      seller.token,
    )

    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined')
    assert.isDefined(createResponse.body.data, 'body.data should be defined')

    const createSubCategoryArgs = {
      ...subCategoryArgs(createResponse.body.data[1], util.uid()),
    }

    const createSubCategoryResponse = await post(
      SubCategory.prefix,
      SubCategory.create,
      createSubCategoryArgs,
      seller.token,
    )

    assert.equal(createSubCategoryResponse.status, 200, 'should be 200');
    assert.isDefined(createSubCategoryResponse.body, 'body should be defined')

    // create product
    const createProductArgs = {
      ...productArgs(util.uid(), createResponse.body.data[1], createSubCategoryResponse.body.data[1]),
    }

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      seller.token
    )

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    // get product
    const getProduct = await get(
      Product.prefix,
      Product.get.replace(':address', createProductResponse.body.data[1]),
      {},
      seller.token,
    )

    assert.equal(getProduct.status, 200, 'should be 200');
    assert.isDefined(getProduct.body, 'body should be defined');

    // create inventory
    const createInventoryArgs = {
      ...inventoryArgs(createProductResponse.body.data[1], util.uid()),
    }

    const createInventoryResponse = await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      seller.token,
    )

    assert.equal(createInventoryResponse.status, 200, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined')
    assert.isDefined(createInventoryResponse.body.data, 'body.data should be defined')

    const marketArgs = {
      ...marketplaceArgs(getProduct.body.data.categoryId, getProduct.body.data.subCategoryId, getProduct.body.data.name, getProduct.body.data.manufacturer),
    }

    // get
    const marketplace = await get(
      Marketplace.prefix,
      Marketplace.getAll,
      marketArgs,
      buyer.token,
    )

    assert.deepInclude(
      // Convert the Marketplace data into strings as the args are in strings
      R.map(v => '' + v, marketplace.body.data[0]),
      R.map(v => '' + v, { ...marketplaceArgs(getProduct.body.data.categoryId, getProduct.body.data.subCategoryId, getProduct.body.data.name, getProduct.body.data.manufacturer) }));

    assert.equal(marketplace.status, 200, 'should be 200');
    assert.isDefined(marketplace.body, 'body should be defined');
    assert.isDefined(marketplace.body.data, 'body should be defined');
    assert.isTrue(marketplace.body.data[0].isInventoryAvailable, 'inventory is present');
  })

  it('Get all inventories without filter for seller', async () => {
    const createArgs = {
      ...categoryArgs(util.uid()),
    }

    const createResponse = await post(
      Category.prefix,
      Category.create,
      createArgs,
      seller.token,
    )

    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined')
    assert.isDefined(createResponse.body.data, 'body.data should be defined')

    const createSubCategoryArgs = {
      ...subCategoryArgs(createResponse.body.data[1], util.uid()),
    }

    const createSubCategoryResponse = await post(
      SubCategory.prefix,
      SubCategory.create,
      createSubCategoryArgs,
      seller.token,
    )

    assert.equal(createSubCategoryResponse.status, 200, 'should be 200');
    assert.isDefined(createSubCategoryResponse.body, 'body should be defined')

    // create product
    const createProductArgs = {
      ...productArgs(util.uid(), createResponse.body.data[1], createSubCategoryResponse.body.data[1]),
    }

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      seller.token
    )

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    // create inventory
    const createInventoryArgs = {
      ...inventoryArgs(createProductResponse.body.data[1], util.uid()),
    }

    const createInventoryResponse = await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      seller.token,
    )

    assert.equal(createInventoryResponse.status, 200, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined')
    assert.isDefined(createInventoryResponse.body.data, 'body.data should be defined')

    // get
    const marketplace = await get(
      Marketplace.prefix,
      Marketplace.getAll,
      {},
      seller.token,
    )

    assert.equal(marketplace.status, 200, 'should be 200');
    assert.isDefined(marketplace.body, 'body should be defined');
    assert.isDefined(marketplace.body.data, 'body should be defined');
    // assert.lengthOf(marketplace.body.data, 0, "Marketplace should be empty.");
  })

  it('Get all inventories without filter for buyer', async () => {
    const createArgs = {
      ...categoryArgs(util.uid()),
    }

    const createResponse = await post(
      Category.prefix,
      Category.create,
      createArgs,
      seller.token,
    )

    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined')
    assert.isDefined(createResponse.body.data, 'body.data should be defined')

    const createSubCategoryArgs = {
      ...subCategoryArgs(createResponse.body.data[1], util.uid()),
    }

    const createSubCategoryResponse = await post(
      SubCategory.prefix,
      SubCategory.create,
      createSubCategoryArgs,
      seller.token,
    )

    assert.equal(createSubCategoryResponse.status, 200, 'should be 200');
    assert.isDefined(createSubCategoryResponse.body, 'body should be defined')

    // create product
    const createProductArgs = {
      ...productArgs(util.uid(), createResponse.body.data[1], createSubCategoryResponse.body.data[1]),
    }

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      seller.token
    )

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    // create inventory
    const createInventoryArgs = {
      ...inventoryArgs(createProductResponse.body.data[1], util.uid()),
    }

    const createInventoryResponse = await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      seller.token,
    )

    assert.equal(createInventoryResponse.status, 200, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined')
    assert.isDefined(createInventoryResponse.body.data, 'body.data should be defined')

    // get
    const marketplace = await get(
      Marketplace.prefix,
      Marketplace.getAll,
      {},
      buyer.token,
    )

    assert.equal(marketplace.status, 200, 'should be 200');
    assert.isDefined(marketplace.body, 'body should be defined');
    assert.isDefined(marketplace.body.data, 'body should be defined');
    assert.isTrue(marketplace.body.data[0].isInventoryAvailable, 'inventory is present');
  })

  it('Get top 3 selling products', async () => {
    // get
    const topSellingProducts = await get(
      Marketplace.prefix,
      Marketplace.getTopSellingProducts,
      {},
      seller.token,
    )

    assert.equal(topSellingProducts.status, 200, 'should be 200');
    assert.isDefined(topSellingProducts.body, 'body should be defined');
    assert.isDefined(topSellingProducts.body.data, 'body should be defined');
  })
})
