import { assert, rest } from 'blockapps-rest'
import { util } from '/blockapps-rest-plus'
import dotenv from 'dotenv'
import config from '../../load.config'
import oauthHelper from '/helpers/oauthHelper'
import certificateJs from '/dapp/certificates/certificate'
import { get, post } from '/helpers/rest'
import RestStatus from 'http-status-codes';
import factory from './factories/order'

import { Product, Inventory, Order } from '../../api/v1/endpoints'
import { productArgs } from './factories/product'
import { inventoryArgs } from './factories/inventory'




const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('Order End-To-End Tests', function () {
  this.timeout(config.timeout)
  let globalAdmin
  let seller
  let buyerOrganization

  before(async () => {
    let globalAdminToken
    let sellerToken
    try {
      // Seller and buyer tokens musst be of different orgs.
      globalAdminToken = await oauthHelper.getUserToken(
        `${process.env.TEST_BUYER_ORG}`,
        `${process.env.TEST_BUYER_PASSWORD}`,
      )
      sellerToken = await oauthHelper.getUserToken(
        `${process.env.TEST_SELLER_ORG}`,
        `${process.env.TEST_SELLER_PASSWORD}`,
      ) 
    } catch (e) {
      console.error(
        'ERROR: Unable to fetch the  user token, check your OAuth settings in config',
        e,
      )
      throw e
    }

    const globalAdminCredentials = { token: globalAdminToken }
    const sellerCredentials = {token:sellerToken}

    const globalAdminResponse = await oauthHelper.getStratoUserFromToken(globalAdminCredentials.token)
    const sellerResponse = await oauthHelper.getStratoUserFromToken(sellerCredentials.token)

    assert.strictEqual(
      globalAdminResponse.status,
      RestStatus.OK,
      globalAdminResponse.message
    )
    assert.strictEqual(
      sellerResponse.status,
      RestStatus.OK,
      sellerResponse.message
    )
    seller = { ...sellerResponse.user, ...sellerCredentials }
    globalAdmin = {...globalAdminResponse.user,...globalAdminCredentials}

    const buyerCert = await certificateJs.getCertificateMe(globalAdmin)
    buyerOrganization = buyerCert.organization;
  })

  it('Create an Order Pay Later', async () => {
    const createProductArgs = {
      ...productArgs(util.uid()),
    }


    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      seller.token,
    )
    const [,productAddress]=createProductResponse.body.data;
    
    assert.equal(createProductResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined')
    
    const createInventoryArgs={
      ...inventoryArgs(productAddress, util.uid()),
    }

    const createInventoryResponse=await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      seller.token,
    )
    const [,inventoryAddress,serialNumbers]=createInventoryResponse.body.data
 
    assert.equal(createInventoryResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined')

    const inventories=[inventoryAddress]
    const createOrderArgs=factory.getCreateOrderArgs(util.uid(),buyerOrganization,inventories)
    
    const createOrderResponse = await post(
      Order.prefix,
      Order.create,
      createOrderArgs,
      globalAdmin.token
    )

    assert.equal(createOrderResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(createOrderResponse.body, 'body should be defined')
  })

  it('Create an Order Pay Now', async () => {
    // In this case the seller must have gone through the connect stripe flow
    const createProductArgs = {
      ...productArgs(util.uid()),
    }

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      seller.token,
    )
    const [,productAddress]=createProductResponse.body.data;
    
    assert.equal(createProductResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined')
    
    const createInventoryArgs={
      ...inventoryArgs(productAddress, util.uid()),
    }

    const createInventoryResponse=await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      seller.token,
    )
    const [,inventoryAddress,serialNumbers]=createInventoryResponse.body.data
 
    assert.equal(createInventoryResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined')

    // An array of inventory addresses created by the seller
    const inventories=[inventoryAddress]

    // Create a user address for the buyer's shipping information
    const buyerAddressArgs = factory.getUserAddressArgs(util.uid())
    const createUserAddressResponse = await post(
      Order.prefix,
      Order.userAddress,
      buyerAddressArgs,
      globalAdmin.token
    )

    const [,userAddress]=createUserAddressResponse.body.data

    const getBuyerAddressResponse = await get(
      Order.prefix,
      Order.getAllUserAddress.replace(':address',userAddress),
      {},
      globalAdmin.token
    )

    const buyerAddress = getBuyerAddressResponse.body.data.filter(address=>address.address === userAddress)

    assert.deepInclude(buyerAddress[0], buyerAddressArgs, 'should include the buyer address args')
    
    // The pay now functionality opens this endpoint to make a payment before posting the order
    const createPaymentArgs = factory.getCreatePaymentArgs(util.uid(),buyerOrganization, inventories, userAddress)

    const createPaymentSession = await post(
      Order.prefix,
      Order.payment,
      createPaymentArgs,
      globalAdmin.token
    )

    assert.equal(createPaymentSession.status, RestStatus.OK, 'should be 200');

    const createOrderArgs=factory.getCreateOrderArgs(util.uid(), buyerOrganization, inventories)
    
    const createOrderResponse = await post(
      Order.prefix,
      Order.create,
      createOrderArgs,
      globalAdmin.token
    )

    const orderAddress = createOrderResponse.body.data[0][1]

    assert.equal(createOrderResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(createOrderResponse.body, 'body should be defined')

    // get
    const getOrderResponse = await get(
      Order.prefix,
      Order.get.replace(':address',orderAddress),
      {},
      globalAdmin.token,
    )

    assert.equal(getOrderResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(getOrderResponse.body, 'body should be defined');

  })

  it('Get an Order', async () => {
    const createProductArgs = {
      ...productArgs(util.uid()),
    }

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      seller.token,
    )
    const [,productAddress]=createProductResponse.body.data;

    assert.equal(createProductResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined')

    const createInventoryArgs={
      ...inventoryArgs(productAddress, util.uid()),
    }

    const createInventoryResponse=await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      seller.token,
    )

    const [,inventoryAddress,serialNumbers]=createInventoryResponse.body.data

    assert.equal(createInventoryResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined')

    const inventories=[inventoryAddress]
    const createOrderArgs=factory.getCreateOrderArgs(util.uid(),buyerOrganization,inventories)

    const createOrderResponse = await post(
      Order.prefix,
      Order.create,
      createOrderArgs,
      globalAdmin.token
    )

    const orderAddress = createOrderResponse.body.data[0][1]

    assert.equal(createOrderResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(createOrderResponse.body, 'body should be defined')

    // get
    const getOrderResponse = await get(
      Order.prefix,
      Order.get.replace(':address',orderAddress),
      {},
      globalAdmin.token,
    )

    assert.equal(getOrderResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(getOrderResponse.body, 'body should be defined');
  })


  it('Get all Order', async () => {
    // get
    const getAllOrderResponse = await get(
      Order.prefix,
      Order.getAll,
      {},
      globalAdmin.token,
    )

    assert.equal(getAllOrderResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(getAllOrderResponse.body, 'body should be defined');
    assert.isDefined(getAllOrderResponse.body.data, 'body should be defined');
  })

  it('Create user address', async () => {
    const createUserAddressArgs = factory.getCreateUserAddressArgs(util.uid())

    // create
    const createUserAddressResponse = await post(
      Order.prefix,
      Order.userAddress,
      createUserAddressArgs,
      globalAdmin.token,
    )

    assert.equal(createUserAddressResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(createUserAddressResponse.body, 'body should be defined')
    
  })

  it('Get all user address', async () => {
    // get
    const getAllUserAddressResponse = await get(
      Order.prefix,
      Order.getAllUserAddress,
      {},
      globalAdmin.token,
    )

    assert.equal(getAllUserAddressResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(getAllUserAddressResponse.body, 'body should be defined');
    assert.isDefined(getAllUserAddressResponse.body.data, 'body should be defined');
  })

})
