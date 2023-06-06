import { assert } from 'blockapps-rest'
import { util } from '/blockapps-rest-plus'
import dotenv from 'dotenv'
import config from '../../load.config'
import oauthHelper from '/helpers/oauthHelper'
import { get, post, put } from '/helpers/rest'
import RestStatus from 'http-status-codes';
import certificateJs from '/dapp/certificates/certificate'
import factory from './factories/orderLineItem'
import { OrderLineItem, Order,Product,Inventory } from '../../api/v1/endpoints'
import { inventoryArgs } from './factories/inventory'
import { productArgs } from './factories/product'


const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('OrderLineItem End-To-End Tests', function () {
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

  it('Create an OrderLineItem', async () => {
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

    const getCreateOrderLineItemsResponse=await post(
      OrderLineItem.prefix,
      OrderLineItem.create,
      createOrderLineItemsArgs,
      seller.token
    );

    assert.equal(getCreateOrderLineItemsResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(getCreateOrderLineItemsResponse.body, 'body should be defined');
  })

  it('Get a OrderLineItem', async () => {
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
    const createOrderArgs=factory.getCreateOrderArgs(util.uid(),'blockapps',inventories)
    
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

    const getCreateOrderLineItemsResponse=await post(
      OrderLineItem.prefix,
      OrderLineItem.create,
      createOrderLineItemsArgs,
      seller.token
    );

    assert.equal(getCreateOrderLineItemsResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(getCreateOrderLineItemsResponse.body, 'body should be defined');
    const orderLineItemAddress = getCreateOrderLineItemsResponse.body.data[0];

    // get
    const getMachine = await get(
      OrderLineItem.prefix,
      OrderLineItem.get.replace(':address', orderLineItemAddress),
      {},
      seller.token,
    )

    assert.equal(getMachine.status, 200, 'should be 200');
    assert.isDefined(getMachine.body, 'body should be defined');
  })

  it('Get all OrderLineItem', async () => {
    // get
    const getOrderLineItemResponse = await get(
      OrderLineItem.prefix,
      OrderLineItem.getAll,
      {},
      globalAdmin.token,
    )

    assert.equal(getOrderLineItemResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(getOrderLineItemResponse.body, 'body should be defined');
    assert.isDefined(getOrderLineItemResponse.body.data, 'body should be defined');
  })

  it('Create an Order till closed status with pay later flow', async () => {
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
    
    console.log(createOrderResponse.body.data)
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

    const getCreateOrderLineItemsResponse=await post(
      OrderLineItem.prefix,
      OrderLineItem.create,
      createOrderLineItemsArgs,
      seller.token
    );

    assert.equal(getCreateOrderLineItemsResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(getCreateOrderLineItemsResponse.body, 'body should be defined');

    const orderCloseArgs = {
      address:orderAddress,
      updates:{
        status:3,
        sellerComments:"dfjlksdjf",
        fullfilmentDate:0
      }
    }

     // update inventory
     const updateSellerDetailsResponse = await put(
      Order.prefix,
      Order.updateSellerDetails,
      orderCloseArgs,
      seller.token,
    )

    assert.equal(updateSellerDetailsResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(updateSellerDetailsResponse.body, 'body should be defined');
  })
  
  // The following test case passes all conditions and works well. It's flagged as pending for development purpose.
  it("Sholud not create an order if seller hasn't activated the payment method", async () => {
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
      Order.payment,
      createOrderArgs,
      globalAdmin.token
    )

    assert.equal(createOrderResponse.status, RestStatus.CONFLICT, 'should be 409');
    assert.isDefined(createOrderResponse.body, 'body should be defined');
    assert.equal(createOrderResponse.body.error, "Seller hasn't activated this payment method");
  })
})
