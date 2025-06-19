import { assert } from 'blockapps-rest';
import dotenv from 'dotenv';
import config from '../../load.config';
import oauthHelper from '/helpers/oauthHelper';
import RestStatus from 'http-status-codes';
import { get } from '/helpers/rest';
import dappJs from '../../dapp/dapp/dapp';

import { SubCategory } from '../../api/v1/endpoints';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

describe('Category End-To-End Tests', function () {
  this.timeout(config.timeout);
  let globalAdmin;

  before(async () => {
    let globalAdminToken;
    try {
      globalAdminToken = await oauthHelper.getUserToken(
        `${process.env.GLOBAL_ADMIN_NAME}`,
        `${process.env.GLOBAL_ADMIN_PASSWORD}`
      );
    } catch (e) {
      console.error(
        'ERROR: Unable to fetch the org user token, check your OAuth settings in config',
        e
      );
      throw e;
    }

    const globalAdminCredentials = { token: globalAdminToken };

    const globalAdminResponse = await oauthHelper.getStratoUserFromToken(
      globalAdminCredentials.token
    );
    const dapp = await dappJs.loadFromDeployment(
      globalAdminCredentials,
      `${config.configDirPath}/${config.deployFilename}`,
      options
    );

    assert.strictEqual(
      globalAdminResponse.status,
      RestStatus.OK,
      globalAdminResponse.message
    );
    globalAdmin = { ...globalAdminResponse.user, ...globalAdminCredentials };
  });

  // it('get a subCategory', async () => {
  //   const createArgs = {
  //     ...categoryArgs(util.uid()),
  //   }

  //   const createResponse = await post(
  //     Category.prefix,
  //     Category.create,
  //     createArgs,
  //     globalAdmin.token,
  //   )

  //   assert.equal(createResponse.status, 200, 'should be 200');
  //   assert.isDefined(createResponse.body, 'body should be defined')
  //   assert.isDefined(createResponse.body.data, 'body.data should be defined')

  //   const categoryAddress = createResponse.body.data[1]

  //   const createSubCategoryArgs = {
  //     ...subCategoryArgs(categoryAddress, util.uid()),
  //   }

  //   const createSubCategoryResponse = await post(
  //     SubCategory.prefix,
  //     SubCategory.create,
  //     createSubCategoryArgs,
  //     globalAdmin.token,
  //   )

  //   assert.equal(createSubCategoryResponse.status, 200, 'should be 200');
  //   assert.isDefined(createSubCategoryResponse.body, 'body should be defined')

  //   // get
  //   const subCategory = await get(
  //     SubCategory.prefix,
  //     SubCategory.get.replace(':address', createSubCategoryResponse.body.data[1]),
  //     {},
  //     globalAdmin.token,
  //   )

  //   const responseData = subCategory?.body.data

  //   assert.equal(subCategory.status, 200, 'should be 200');
  //   assert.isDefined(subCategory.body, 'body should be defined');

  //   assert.equal(responseData['name'], createSubCategoryArgs['name'], 'name should be equal');
  //   assert.equal(responseData['description'], createSubCategoryArgs['description'], 'description should be equal');
  // })

  it('Get all subCategory', async () => {
    // get

    const subCategory = await get(
      SubCategory.prefix,
      SubCategory.getAll,
      { category: 'Art' },
      globalAdmin.token
    );

    assert.equal(subCategory.status, 200, 'should be 200');
    assert.isDefined(subCategory.body, 'body should be defined');
    assert.isDefined(subCategory.body.data, 'body should be defined');
  });

  //   const subCategory = await get(
  //     SubCategory.prefix,
  //     SubCategory.getAll,
  //     {category:"Carbon"},
  //     globalAdmin.token,
  //   )

  //   assert.equal(subCategory.status, 200, 'should be 200');
  //   assert.isDefined(subCategory.body, 'body should be defined');
  //   assert.isDefined(subCategory.body.data, 'body should be defined');
  // })
  // const subCategory = await get(
  //   SubCategory.prefix,
  //   SubCategory.getAll,
  //   {category:"Real Estate"},
  //   globalAdmin.token,
  // )

  // assert.equal(subCategory.status, 200, 'should be 200');
  // assert.isDefined(subCategory.body, 'body should be defined');
  // assert.isDefined(subCategory.body.data, 'body should be defined');
});
