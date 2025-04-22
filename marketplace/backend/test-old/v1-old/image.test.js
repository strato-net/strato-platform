import { assert, rest } from 'blockapps-rest';
import { util } from '/blockapps-rest-plus';
import dotenv from 'dotenv';
import config from '../../load.config';
import oauthHelper from '/helpers/oauthHelper';
import { Image } from '../../api/v1/endpoints';
import { postFile } from '../../helpers/rest';
import RestStatus from 'http-status-codes';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import constants from '../../helpers/constants';
import jpeg from 'jpeg-js';
import { join } from 'path';
const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

function generateRandomFile() {
  if (!existsSync(constants.tempUploadDir)) {
    mkdirSync(constants.tempUploadDir);
  }
  // create an image buffer with random pixel data
  const width = 100;
  const height = 100;
  const imageData = new Buffer.alloc(width * height * 4);
  for (let i = 0; i < imageData.length; i++) {
    imageData[i] = Math.floor(Math.random() * 256);
  }

  // generate a JPEG image from the image buffer
  const jpegImageData = jpeg.encode(
    { data: imageData, width: width, height: height },
    50
  );
  const filePath = join(constants.tempUploadDir, `${util.uid('test')}.jpg`);
  writeFileSync(filePath, imageData);

  return { filePath };
}

describe('Image Upload End-To-End Tests', function () {
  let globalAdmin;
  this.timeout(config.timeout);

  before(async () => {
    assert.isDefined(
      config.configDirPath,
      'configDirPath is  missing. Set in config'
    );
    assert.isDefined(
      config.deployFilename,
      'deployFilename is missing. Set in config'
    );
    assert.isDefined(
      process.env.GLOBAL_ADMIN_NAME,
      'GLOBAL_ADMIN_NAME is missing. Add it to .env file'
    );
    assert.isDefined(
      process.env.GLOBAL_ADMIN_PASSWORD,
      'GLOBAL_ADMIN_PASSWORD is missing. Add it to .env file'
    );

    let adminUserName = process.env.GLOBAL_ADMIN_NAME;
    let adminUserPassword = process.env.GLOBAL_ADMIN_PASSWORD;

    let adminUserToken;
    try {
      adminUserToken = await oauthHelper.getUserToken(
        adminUserName,
        adminUserPassword
      );
    } catch (e) {
      console.error(
        'ERROR: Unable to fetch the user token, check your username and password in your .env',
        e
      );
      throw e;
    }
    let adminCredentials = { token: adminUserToken };
    console.log("getting admin user's address:", adminUserName);
    const adminResponse = await oauthHelper.getStratoUserFromToken(
      adminCredentials.token
    );
    console.log('adminResponse', adminResponse);

    assert.strictEqual(
      adminResponse.status,
      RestStatus.OK,
      adminResponse.message
    );
    globalAdmin = { ...adminResponse.user, ...adminCredentials };
  });

  it('Upload an image', async () => {
    const { filePath } = generateRandomFile();
    console.log(globalAdmin);
    const createResponse = await postFile(
      Image.prefix,
      Image.upload,
      filePath,
      globalAdmin.token
    );

    assert.equal(createResponse.status, 201, 'should be 201');
    assert.isDefined(createResponse.body, 'body should be defined');
  });
});
