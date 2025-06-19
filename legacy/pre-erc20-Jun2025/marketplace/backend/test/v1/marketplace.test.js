import * as R from 'ramda';
import { util, assert } from '/blockapps-rest-plus';
import dotenv from 'dotenv';
import config from '../../load.config';
import oauthHelper from '/helpers/oauthHelper';
import RestStatus from 'http-status-codes';
import { get, post } from '/helpers/rest';

import {
  marketplaceArgs,
  categoryArgs,
  subCategoryArgs,
  productArgs,
  inventoryArgs,
} from './factories/marketplace';
import {
  Category,
  SubCategory,
  Marketplace,
  Product,
  Inventory,
} from '../../api/v1/endpoints';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

describe('Marketplace End-To-End Tests', function () {
  this.timeout(config.timeout);
  let seller, buyer;

  before(async () => {
    let sellerToken, buyerToken;
    try {
      sellerToken = await oauthHelper.getUserToken(
        `${process.env.TEST_SELLER_ORG}`,
        `${process.env.TEST_SELLER_PASSWORD}`
      );
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

    const sellerCredentials = { token: sellerToken };
    const buyerCredentials = { token: buyerToken };

    const sellerResponse = await oauthHelper.getStratoUserFromToken(
      sellerCredentials.token
    );
    const buyerResponse = await oauthHelper.getStratoUserFromToken(
      buyerCredentials.token
    );

    assert.strictEqual(
      sellerResponse.status,
      RestStatus.OK,
      sellerResponse.message
    );
    seller = { ...sellerResponse.user, ...sellerCredentials };

    assert.strictEqual(
      buyerResponse.status,
      RestStatus.OK,
      buyerResponse.message
    );
    buyer = { ...buyerResponse.user, ...buyerCredentials };
  });

  it('Get top 3 selling products', async () => {
    // get
    const topSellingProducts = await get(
      Marketplace.prefix,
      Marketplace.getTopSellingProducts,
      {},
      seller.token
    );

    assert.equal(topSellingProducts.status, 200, 'should be 200');
    assert.isDefined(topSellingProducts.body, 'body should be defined');
    assert.isDefined(topSellingProducts.body.data, 'body should be defined');
  });
});
