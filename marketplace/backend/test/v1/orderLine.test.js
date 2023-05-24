import { assert, rest } from 'blockapps-rest'
import { util } from '/blockapps-rest-plus'
import dotenv from 'dotenv'
import config from '../../load.config'
import constants from '/helpers/constants'
import oauthHelper from '/helpers/oauthHelper'
import { get, post, put } from '/helpers/rest'
import RestStatus from 'http-status-codes';
import certificateJs from '/dapp/certificates/certificate'
import factory from './factories/orderLine'
import { Order, Product,Inventory,OrderLine,OrderLineItem } from '../../api/v1/endpoints'
import { inventoryArgs } from './factories/inventory'
import { productArgs } from './factories/product'

const options = { config }

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('OrderLine End-To-End Tests', function () {
  this.timeout(config.timeout)
  let globalAdmin
  let seller
  let buyerOrganization
  before(async () => {
    let globalAdminToken
    let sellerToken
    try {
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

  it('get an orderLine', async () => {
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
    const serialNumbers=createInventoryArgs.serialNumber
    const serialNumbersArray = serialNumbers.map(serialNumber => serialNumber.itemSerialNumber)

    
    const createInventoryResponse=await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      seller.token,
    )
    const [,inventoryAddress]=createInventoryResponse.body.data

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
    const [orderResponse]=createOrderResponse.body.data

    const [,orderAddress] = orderResponse

    assert.equal(createOrderResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(createOrderResponse.body, 'body should be defined')

    // get
    const getOrderResponse = await get(
      Order.prefix,
      Order.get.replace(':address',orderAddress),
      {},
      globalAdmin.token,
    )
    const [orderLines]=getOrderResponse.body.data.orderLines
    const {address:orderLineId}=orderLines
    const orderId=getOrderResponse.body.data.orderId
    

    assert.equal(getOrderResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(getOrderResponse.body, 'body should be defined');
    
    // create order line item
    const createOrderLineItemsArgs=factory.getCreateOrderLineItemsArgs(orderId,orderAddress,orderLineId,serialNumbersArray)

    const createOrderLineItemsResponse=await post(
      OrderLineItem.prefix,
      OrderLineItem.create,
      createOrderLineItemsArgs,
      seller.token
    );

    assert.equal(createOrderLineItemsResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(createOrderLineItemsResponse.body, 'body should be defined');

    // get 

    const getOrderLineResponse = await get(
        Order.prefix,
        Order.get.replace(':address',orderAddress),
        {},
        globalAdmin.token,
      )

    assert.equal(getOrderLineResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(getOrderLineResponse.body, 'body should be defined');

  })



  it('Get all OrderLine', async () => {
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

  
})
