import { assert } from 'blockapps-rest';
import { util } from '/blockapps-rest-plus';
import dotenv from 'dotenv';
import config from '../../load.config';
import oauthHelper from '/helpers/oauthHelper';
import RestStatus from 'http-status-codes';
import { get, post } from '/helpers/rest';
import { Order, Product, Inventory } from '../../api/v1/endpoints';
import { productArgs } from './factories/product';
import { inventoryArgs } from './factories/inventory';
import certificateJs from '/dapp/certificates/certificate';
import factory from './factories/order';

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

describe('Payment Tests', function () {
  this.timeout(config.timeout);
  let seller;
  let buyer;
  let buyerOrganization;
  let buyerCert;

  before(async () => {
    let sellerToken;
    try {
      sellerToken = await oauthHelper.getUserToken(
        `${process.env.TEST_SELLER_ORG}`,
        `${process.env.TEST_SELLER_PASSWORD}`
      );
    } catch (e) {
      console.error(
        'ERROR: Unable to fetch the  user token, check your OAuth settings in config',
        e
      );
      throw e;
    }

    const sellerCredentials = { token: sellerToken };

    const sellerResponse = await oauthHelper.getStratoUserFromToken(
      sellerCredentials.token
    );

    assert.strictEqual(
      sellerResponse.status,
      RestStatus.OK,
      sellerResponse.message
    );
    seller = { ...sellerResponse.user, ...sellerCredentials };

    let buyerToken;
    try {
      buyerToken = await oauthHelper.getUserToken(
        `${process.env.TEST_BUYER_ORG}`,
        `${process.env.TEST_BUYER_PASSWORD}`
      );
    } catch (e) {
      console.error(
        'ERROR: Unable to fetch the  user token, check your OAuth settings in config',
        e
      );
      throw e;
    }

    const buyerCredentials = { token: buyerToken };

    const buyerResponse = await oauthHelper.getStratoUserFromToken(
      buyerCredentials.token
    );

    assert.strictEqual(
      buyerResponse.status,
      RestStatus.OK,
      buyerResponse.message
    );
    buyer = { ...buyerResponse.user, ...buyerCredentials };
    buyerCert = await certificateJs.getCertificateMe(buyer);
    buyerOrganization = buyerCert.organization;
  });

  //////////////////////////////////////////
  //** Pay Now/Later & Stripe URL Tests **//
  /////////////////////////////////////////

  /*////////////////////////////////*
 Flow: 
1. Seller creates Inventory
2. Buyer will have the shipping address created
3. Buyer will proceed with creating payment session
4. Creation of order & retrieval
/////////////////////////////////*/

  it('Payment URL Generation & Creation Of Order Tests', async () => {
    // create inventory and post it as a seller
    const createProductArgs = {
      ...productArgs(util.uid()),
    };

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      seller.token
    );
    const [, productAddress] = createProductResponse.body.data;

    assert.equal(createProductResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    const createInventoryArgs = {
      ...inventoryArgs(productAddress, util.uid()),
    };

    const createInventoryResponse = await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      seller.token
    );
    const [, inventoryAddress] = createInventoryResponse.body.data;

    assert.equal(
      createInventoryResponse.status,
      RestStatus.OK,
      'should be 200'
    );
    assert.isDefined(createInventoryResponse.body, 'body should be defined');

    const inventories = [inventoryAddress];

    //*   shippingAddress  *//

    //create Shipping Address for a user (buyer)
    const buyerAddressArgs = factory.getUserAddressArgs(util.uid());
    const shipAddress = await post(
      Order.prefix,
      Order.userAddress,
      buyerAddressArgs,
      buyer.token
    );

    assert.equal(shipAddress.status, 200, 'should be 200');
    assert.isDefined(shipAddress.body, 'body should be defined');
    assert.isDefined(shipAddress.body.data, 'body should be defined');

    const [, userAddress] = shipAddress.body.data;

    //fetch Shipping Address for a user
    const getShipAddress = await get(
      Order.prefix,
      Order.getAllUserAddress.replace(':address', userAddress),
      {},
      buyer.token
    );

    assert.equal(getShipAddress.status, 200, 'should be 200');
    assert.isDefined(getShipAddress.body, 'body should be defined');
    assert.isDefined(getShipAddress.body.data, 'body should be defined');

    const buyerAddress = getShipAddress.body.data.filter(
      (address) => address.address === userAddress
    );
    assert.deepInclude(
      buyerAddress[0],
      buyerAddressArgs,
      'should include the buyer address args'
    );

    // create payment session
    const payOrderArgs = factory.getCreatePaymentArgs(
      util.uid(),
      buyerOrganization,
      inventories,
      userAddress
    );
    const payOrder = await post(
      Order.prefix,
      Order.payment,
      payOrderArgs,
      buyer.token
    );

    assert.equal(payOrder.status, 200, 'should be 200');
    assert.isDefined(payOrder.body, 'body should be defined');
    assert.isDefined(payOrder.body.data, 'body should be defined');
    assert.equal(
      payOrder.body.data.url.substr(0, 34),
      factory.paymentUrlDomain,
      'should have a stripe url generated'
    );

    ////////////////////////////// Order Tests ////////////////////////////////////////

    //Create an Order

    const createOrderArgs = factory.getCreateOrderArgs(
      util.uid(),
      buyerOrganization,
      inventories
    );

    const createOrderResponse = await post(
      Order.prefix,
      Order.create,
      createOrderArgs,
      buyer.token
    );

    const orderAddress = createOrderResponse.body.data[0][1];

    assert.equal(createOrderResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(createOrderResponse.body, 'body should be defined');

    // get
    const getOrderResponse = await get(
      Order.prefix,
      Order.get.replace(':address', orderAddress),
      {},
      buyer.token
    );

    assert.equal(getOrderResponse.status, RestStatus.OK, 'should be 200');
    assert.isDefined(getOrderResponse.body, 'body should be defined');
  });
});
