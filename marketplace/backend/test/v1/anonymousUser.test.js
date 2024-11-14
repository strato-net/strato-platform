import { assert } from 'blockapps-rest';
import dotenv from 'dotenv';
import config from '../../load.config';
import { get } from '/helpers/rest';
import { Marketplace, Category, SubCategory } from '../../api/v1/endpoints';

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

describe('Anonymous User End-To-End Tests', function () {
  this.timeout(config.timeout);

  it('Get all Category', async () => {
    // get
    const category = await get(Category.prefix, Category.getAll, {});

    assert.equal(category.status, 200, 'should be 200');
    assert.isDefined(category.body, 'body should be defined');
    assert.isDefined(category.body.data, 'body should be defined');
    // Number of Categories {Art, Carbon, Real Estate}
    assert.equal(category.body.data.length, 3, 'should be 3');
  });

  it('Get top 3 selling products', async () => {
    // get
    const topSellingProducts = await get(
      Marketplace.prefix,
      Marketplace.getTopSellingProducts,
      {}
    );

    assert.equal(topSellingProducts.status, 200, 'should be 200');
    assert.isDefined(topSellingProducts.body, 'body should be defined');
    assert.isDefined(topSellingProducts.body.data, 'body should be defined');
  });

  it('Get all products', async () => {
    // get
    const allProducts = await get(Marketplace.prefix, Marketplace.getAll, {});

    assert.equal(allProducts.status, 200, 'should be 200');
    assert.isDefined(allProducts.body, 'body should be defined');
    assert.isDefined(allProducts.body.data, 'body should be defined');
  });

  it('Get all subCategory', async () => {
    // get

    const subCategory = await get(SubCategory.prefix, SubCategory.getAll, {
      category: 'Art',
    });

    assert.equal(subCategory.status, 200, 'should be 200');
    assert.isDefined(subCategory.body, 'body should be defined');
    assert.isDefined(subCategory.body.data, 'body should be defined');
    assert.isAtLeast(
      subCategory.body.data.length,
      1,
      'should have atleast one sub-category'
    );

    const subCategory2 = await get(SubCategory.prefix, SubCategory.getAll, {
      category: 'Carbon',
    });

    assert.equal(subCategory2.status, 200, 'should be 200');
    assert.isDefined(subCategory2.body, 'body should be defined');
    assert.isDefined(subCategory2.body.data, 'body should be defined');
    assert.isAtLeast(
      subCategory2.body.data.length,
      1,
      'should have atleast one sub-category'
    );

    const subCategory3 = await get(SubCategory.prefix, SubCategory.getAll, {
      category: 'Real Estate',
    });

    assert.equal(subCategory3.status, 200, 'should be 200');
    assert.isDefined(subCategory3.body, 'body should be defined');
    assert.isDefined(subCategory3.body.data, 'body should be defined');
    assert.isAtLeast(
      subCategory3.body.data.length,
      1,
      'should have atleast one sub-category'
    );
  });

  it('Unauthorized Access', async () => {
    // get
    const unauthorizedAccess = await get(
      Marketplace.prefix,
      Marketplace.getTopSellingProductsLoggedIn,
      {}
    );

    assert.equal(unauthorizedAccess.status, 401, 'should be 401');
  });
});
