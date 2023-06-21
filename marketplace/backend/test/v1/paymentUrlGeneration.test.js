import { assert } from 'blockapps-rest'
import { util } from '/blockapps-rest-plus'
import dotenv from 'dotenv'
import config from '../../load.config'
import oauthHelper from '/helpers/oauthHelper'
import RestStatus from 'http-status-codes';
import { get, post } from '/helpers/rest'
import { Order, Product, Inventory } from '../../api/v1/endpoints'
import { productArgs } from './factories/product'
import { inventoryArgs } from './factories/inventory'
import certificateJs from '/dapp/certificates/certificate'
import factory from './factories/order'

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)


describe('Payment Tests', function () {
  this.timeout(config.timeout)
  let seller
  let buyer
  let buyerOrganization
  let buyerCert

  before(async () => {
    let sellerToken
    try {
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

    const sellerCredentials = { token: sellerToken }

    const sellerResponse = await oauthHelper.getStratoUserFromToken(sellerCredentials.token)

    assert.strictEqual(
      sellerResponse.status,
      RestStatus.OK,
      sellerResponse.message
    )
    seller = { ...sellerResponse.user, ...sellerCredentials }



    
    let buyerToken
    try {
      buyerToken = await oauthHelper.getUserToken(
        `${process.env.GLOBAL_ADMIN_NAME}`,
        `${process.env.GLOBAL_ADMIN_PASSWORD}`,
      )
    } catch (e) {
      console.error(
        'ERROR: Unable to fetch the  user token, check your OAuth settings in config',
        e,
      )
      throw e
    }

    const buyerCredentials = { token: buyerToken }

    const buyerResponse = await oauthHelper.getStratoUserFromToken(buyerCredentials.token)

    assert.strictEqual(
      buyerResponse.status,
      RestStatus.OK,
      buyerResponse.message
    )
    buyer = { ...buyerResponse.user, ...buyerCredentials }
    buyerCert = await certificateJs.getCertificateMe(buyer)
    buyerOrganization = buyerCert.organization;

  })

  



it('Get Payment URL', async () => {
  // create inventory and post it as a seller
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
    const [,inventoryAddress]=createInventoryResponse.body.data
 
    assert.equal(createInventoryResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined')

    const inventories=[inventoryAddress]
    const createOrderArgs=factory.getCreateOrderArgs(util.uid(),buyerOrganization,inventories)
    //buyer creates order
    const createOrderResponse = await post(
      Order.prefix,
      Order.create,
      createOrderArgs,
      buyer.token
    )

    const orderAddress = createOrderResponse.body.data[0][1]

    assert.equal(createOrderResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(createOrderResponse.body, 'body should be defined')

    // get inventoryID & other data
    const getOrderResponse = await get(
      Order.prefix,
      Order.get.replace(':address',orderAddress),
      {},
      buyer.token,
    )

    assert.equal(getOrderResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(getOrderResponse.body, 'body should be defined');


        //*   Fetch shippingAddress  *//

    //create Shipping Address for a user
    const shipAddress = await post(
      Order.prefix,
      Order.userAddress,
      {
        shippingName: "Testing Address",
        shippingZipcode:'12345',
        shippingState: 'NY',
        shippingCity: 'Brooklyn',
        shippingAddressLine1: '315 Meserole St, Ste B4',
        shippingAddressLine2: "",
        billingName: 'Tester',
        billingZipcode:'12345',
        billingState: 'NY',
        billingCity: 'Brooklyn',
        billingAddressLine1: '315 Meserole St, Ste B4',
        billingAddressLine2: ""
      },
      buyer.token,
    )

    assert.equal(shipAddress.status, 200, 'should be 200');
    assert.isDefined(shipAddress.body, 'body should be defined');
    assert.isDefined(shipAddress.body.data, 'body should be defined');

        //fetch Shipping Address for a user
        const getShipAddress = await get(
          Order.prefix,
          Order.getAllUserAddress,
          {},
          buyer.token,
        )
        
        assert.equal(getShipAddress.status, 200, 'should be 200');
        assert.isDefined(getShipAddress.body, 'body should be defined');
        assert.isDefined(getShipAddress.body.data, 'body should be defined');

    
    // pay now as a buyer
    const payOrder = await post(
      Order.prefix,
      Order.payment,
      {
      "buyerOrganization":buyerOrganization,
      "orderList":[ JSON.parse(`{"inventoryId":"${getOrderResponse.body.data.orderLines[0].inventoryId}","quantity":${getOrderResponse.body.data.orderLines[0].quantity}}`)],
      "orderTotal" : (getOrderResponse.body.data.orderLines[0].amount) + getOrderResponse.body.data.orderLines[0].tax + getOrderResponse.body.data.orderLines[0].shippingCharges,
      "shippingAddress": getShipAddress.body.data[0].address
      },
      buyer.token,
    )
    
    assert.equal(payOrder.status, 200, 'should be 200');
    assert.isDefined(payOrder.body, 'body should be defined');
    assert.isDefined(payOrder.body.data, 'body should be defined');
})


})
