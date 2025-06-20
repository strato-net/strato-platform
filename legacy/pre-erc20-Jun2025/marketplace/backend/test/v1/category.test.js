import { assert, rest } from 'blockapps-rest';
import { util } from '/blockapps-rest-plus';
import dotenv from 'dotenv';
import config from '../../load.config';
import oauthHelper from '/helpers/oauthHelper';
import RestStatus from 'http-status-codes';
import { get } from '/helpers/rest';
import dappJs from '../../dapp/dapp/dapp';
import { Category } from '../../api/v1/endpoints';

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
        'ERROR: Unable to fetch the  user token, check your OAuth settings in config',
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

  // it('Get a Category', async () => {

  //   // get
  //   const category = await get(
  //     Category.prefix,
  //     Category.get.replace(':address', createResponse.body.data[1]),
  //     {},
  //     globalAdmin.token,
  //   )

  //   const responseData = category?.body.data

  //   assert.equal(category.status, 200, 'should be 200');
  //   assert.isDefined(category.body, 'body should be defined');

  //   assert.equal(responseData['name'], createArgs['name'], 'name should be equal');
  // })

  it('Get all Category', async () => {
    // get
    const category = await get(
      Category.prefix,
      Category.getAll,
      {},
      globalAdmin.token
    );

    assert.equal(category.status, 200, 'should be 200');
    assert.isDefined(category.body, 'body should be defined');
    assert.isDefined(category.body.data, 'body should be defined');
  });
});
