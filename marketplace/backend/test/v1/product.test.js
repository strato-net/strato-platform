import * as R from 'ramda';
import { util, assert } from '/blockapps-rest-plus';
import dotenv from 'dotenv'
import config from '../../load.config'
import oauthHelper from '/helpers/oauthHelper'
import { get, post, put } from '/helpers/rest'
import RestStatus from 'http-status-codes';
import { productArgs, updateProductArgs, updateImageProductArgs } from './factories/product'
import { inventoryArgs } from './factories/inventory'
import { Product, Inventory } from '../../api/v1/endpoints'


const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('Product End-To-End Tests', function () {
  this.timeout(config.timeout)
  let admin
  let sameOrgUser
  let adminToken
  let sameOrgUserToken

  before(async () => {

    try {
      adminToken = await oauthHelper.getUserToken(
        `${process.env.GLOBAL_ADMIN_NAME}`,
        `${process.env.GLOBAL_ADMIN_PASSWORD}`,
      )
      // Make sure this user is of the same org as the admin user
      sameOrgUserToken = await oauthHelper.getUserToken(
        `${process.env.ORG_ADMIN_NAME}`,
        `${process.env.ORG_ADMIN_PASSWORD}`,
      )
    } catch (e) {
      console.error(
        'ERROR: Unable to fetch the org user token, check your OAuth settings in config',
        e,
      )
      throw e
    }

    const adminCredentials = { token: adminToken }
    const sameOrgUserCredentials = { token: sameOrgUserToken }

    const adminResponse = await oauthHelper.getStratoUserFromToken(adminCredentials.token)
    const sameOrgUserResponse = await oauthHelper.getStratoUserFromToken(sameOrgUserCredentials.token)

    assert.strictEqual(
      adminResponse.status,
      RestStatus.OK,
      adminResponse.message
    )

    assert.strictEqual(
      sameOrgUserResponse.status,
      RestStatus.OK,
      sameOrgUserResponse.message
    )

    admin = { ...adminResponse.user, ...adminCredentials }
    sameOrgUser = { ...sameOrgUserResponse.user, ...sameOrgUserCredentials }
  })

  it('Create a Product', async () => {
    // create product
    const createProductArgs = {
      ...productArgs(util.uid()),
    }

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      admin.token
    )

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');
  })

  it('Get a Product', async () => {
    // create product
    const createProductArgs = {
      ...productArgs(util.uid()),
    }

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      admin.token
    )

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    // get product
    const getProduct = await get(
      Product.prefix,
      Product.get.replace(':address', createProductResponse.body.data[1]),
      {},
      admin.token,
    )

    assert.equal(getProduct.status, 200, 'should be 200');
    assert.isDefined(getProduct.body, 'body should be defined');

    assert.deepInclude(
      // Convert the Product data into strings as the args are in strings
      R.map(v => '' + v, getProduct.body.data),
      R.map(v => '' + v, { ...createProductArgs.productArgs }));
  })

  it('Get all Products', async () => {
    // get products
    const getProducts = await get(
      Product.prefix,
      Product.getAll,
      {},
      admin.token,
    )

    assert.equal(getProducts.status, 200, 'should be 200');
    assert.isDefined(getProducts.body, 'body should be defined');
    assert.isDefined(getProducts.body.data, 'body.data should be defined');
  })

  it('Create and delete the product if inventory is not present', async () => {
    // create product
    const createProductArgs = {
      ...productArgs(util.uid()),
    }

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      admin.token
    )

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    const productAddress = createProductResponse.body.data[1]

    // delete product
    const deleteProductResponse = await put(
      Product.prefix,
      Product.delete,
      { productAddress: productAddress },
      admin.token,
    )

    assert.equal(deleteProductResponse.status, 200, 'should be 200');
    assert.isDefined(deleteProductResponse.body, 'body should be defined')
    assert.isDefined(deleteProductResponse.body.data, 'body.data should be defined')
    assert.isArray(deleteProductResponse.body.data, 'body.data is array')

    // get product
    const getProduct = await get(
      Product.prefix,
      Product.get.replace(':address', createProductResponse.body.data[1]),
      {},
      admin.token,
    )

    assert.equal(getProduct.status, 200, 'should be 200');
    assert.isDefined(getProduct.body, 'body should be defined');

    const isInventoryAvailable = getProduct.body.data['isInventoryAvailable']
    const isDeleted = getProduct.body.data['isDeleted']

    if (isInventoryAvailable == false) assert.equal(isDeleted, true, 'isDeleted should be true')
    else assert.equal(isDeleted, false, 'isDeleted should be false')
  })

  it('Create and delete the product if inventory is present', async () => {
    // create product
    const createProductArgs = {
      ...productArgs(util.uid()),
    }

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      admin.token
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
      admin.token,
    )

    assert.equal(createInventoryResponse.status, 200, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined')
    assert.isDefined(createInventoryResponse.body.data, 'body.data should be defined')

    // delete product
    const deleteProductResponse = await put(
      Product.prefix,
      Product.delete,
      { productAddress: productAddress },
      admin.token,
    )

    assert.equal(deleteProductResponse.status, 409, 'should be 409');

    // get product
    const getProduct = await get(
      Product.prefix,
      Product.get.replace(':address', createProductResponse.body.data[1]),
      {},
      admin.token,
    )

    assert.equal(getProduct.status, 200, 'should be 200');
    assert.isDefined(getProduct.body, 'body should be defined');

    const isInventoryAvailable = getProduct.body.data['isInventoryAvailable']
    const isDeleted = getProduct.body.data['isDeleted']

    if (isInventoryAvailable)
      assert.equal(isDeleted, false, 'isDeleted should be false')
    else
      assert.equal(isDeleted, true, 'isDeleted should be true')

  })

  it('Update Product', async () => {
    // create product
    const createProductArgs = {
      ...productArgs(util.uid()),
    }

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      admin.token
    )

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    const productAddress = createProductResponse.body.data[1]

    // update product
    const updateArgs = {
      ...updateProductArgs(productAddress, util.uid()),
    }

    // This update changes the uniqueProductCode, description, and isActive fields only, the image is not changed or deleted
    const updateProduct = await put(
      Product.prefix,
      Product.update,
      updateArgs,
      admin.token,
    )

    assert.equal(updateProduct.status, 200, 'should be 200');
    assert.isDefined(updateProduct.body, 'body should be defined');

    // get product
    const getProduct = await get(
      Product.prefix,
      Product.get.replace(':address', productAddress),
      {},
      admin.token,
    )

    assert.equal(getProduct.status, 200, 'should be 200');
    assert.isDefined(getProduct.body, 'body should be defined');

    assert.deepInclude(
      // Convert the Product data into strings as the args are in strings
      R.map(v => '' + v, getProduct.body.data),
      R.map(v => '' + v, { ...updateArgs.updates }));
  })

  it('Updates product and deletes the old image', async () => {
    // create product
    const createProductArgs = {
      ...productArgs(util.uid()),
    }

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      admin.token
    )

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    const productAddress = createProductResponse.body.data[1]

    // update product
    const updateImageArgs = {
      ...updateImageProductArgs(productAddress, util.uid()),
    }

    // This update changes the image field. When the image is changed it is deleted from the server.
    // See in product controller and UpdateProductModal.js for more details.
    const updateProduct = await put(
      Product.prefix,
      Product.update,
      updateImageArgs,
      admin.token,
    )

    assert.equal(updateProduct.status, 200, 'should be 200');
    assert.isDefined(updateProduct.body, 'body should be defined');

    // get product
    const getProduct = await get(
      Product.prefix,
      Product.get.replace(':address', productAddress),
      {},
      admin.token,
    )
    // The old image key is not stored in the contract, so it is not returned in the response
    delete updateImageArgs.updates.oldImageKey

    assert.equal(getProduct.status, 200, 'should be 200');
    assert.isDefined(getProduct.body, 'body should be defined');

    assert.deepInclude(
      // Convert the Product data into strings as the args are in strings
      R.map(v => '' + v, getProduct.body.data),
      R.map(v => '' + v, { ...updateImageArgs.updates }));

  });

  it('Update Product with a different user of same organization', async () => {
    // create product
    const createProductArgs = {
      ...productArgs(util.uid()),
    }

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      sameOrgUser.token
    )

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    const productAddress = createProductResponse.body.data[1]

    // update product
    const updateArgs = {
      ...updateProductArgs(productAddress, util.uid()),
    }

    // This update changes the uniqueProductCode, description, and isActive fields only, the image is not changed or deleted
    const updateProduct = await put(
      Product.prefix,
      Product.update,
      updateArgs,
      sameOrgUser.token,
    )

    assert.equal(updateProduct.status, 200, 'should be 200');
    assert.isDefined(updateProduct.body, 'body should be defined');

    // get product
    const getProduct = await get(
      Product.prefix,
      Product.get.replace(':address', productAddress),
      {},
      sameOrgUser.token,
    )

    assert.equal(getProduct.status, 200, 'should be 200');
    assert.isDefined(getProduct.body, 'body should be defined');

    assert.deepInclude(
      // Convert the Product data into strings as the args are in strings
      R.map(v => '' + v, getProduct.body.data),
      R.map(v => '' + v, { ...updateArgs.updates }));


    // Including the update of the image for a different user of the same organization
    // update product with image change
    const updateImageArgs = {
      ...updateImageProductArgs(productAddress, util.uid()),
    }

    const updateProductImage = await put(
      Product.prefix,
      Product.update,
      updateImageArgs,
      admin.token,
    )

    assert.equal(updateProductImage.status, 200, 'should be 200');
    assert.isDefined(updateProductImage.body, 'body should be defined');

    // get product
    const getProductWithImage = await get(
      Product.prefix,
      Product.get.replace(':address', productAddress),
      {},
      admin.token,
    )
    // The old image key is not stored in the contract, so it is not returned in the response
    delete updateImageArgs.updates.oldImageKey

    assert.equal(getProductWithImage.status, 200, 'should be 200');
    assert.isDefined(getProductWithImage.body, 'body should be defined');

    assert.deepInclude(
      // Convert the Product data into strings as the args are in strings
      R.map(v => '' + v, getProductWithImage.body.data),
      R.map(v => '' + v, { ...updateImageArgs.updates }));
  })
})  