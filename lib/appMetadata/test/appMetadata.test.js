require('co-mocha');
const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common;
const config = common.config;
const util = common.util;
const should = common.should;
const assert = common.assert;
const Promise = common.Promise;
const BigNumber = ba.common.BigNumber;
const constants = ba.common.constants

const appMetadataJs = require('../appMetadata');

const adminName = util.uid('Admin');
const adminPassword = '1234';

describe('AppMetadata tests', function() {
  this.timeout(config.timeout);

  let admin;

  before(function* () {
    admin = yield rest.createUser(adminName, adminPassword);
  });

  it('Create AppMetadata - constructor arguments', function* () {
    const appName = 'appName';
    const version = 'version';
    const url = 'url';
    const description = 'description';
    const maintainer = 'maintainer';

    const args = {
      _appName: appName,
      _version: version,
      _url: url,
      _description: description,
      _maintainer: maintainer,
    };

    const contract = yield appMetadataJs.uploadContract(admin, args);
    // state
    {
      const appMetadata = yield contract.getState();
      assert.equal(appMetadata.appName, appName, 'appName');
      assert.equal(appMetadata.version, version, 'version');
      assert.equal(appMetadata.url, url, 'url');
      assert.equal(appMetadata.description, description, 'description');
      assert.equal(appMetadata.maintainer, maintainer, 'maintainer');
    }
    // query
    {
      const appMetadata = yield appMetadataJs.getAppMetadata(contract.address);
      assert.equal(appMetadata.appName, appName, 'appName');
      assert.equal(appMetadata.version, version, 'version');
      assert.equal(appMetadata.url, url, 'url');
      assert.equal(appMetadata.description, description, 'description');
      assert.equal(appMetadata.maintainer, maintainer, 'maintainer');
    }
  });

  it('should update AppMetadata with new values', function* () {
    const appName = 'appName';
    const version = 'version';
    const url = 'url';
    const description = 'description';
    const maintainer = 'maintainer';

    const args = {
      _appName: appName,
      _version: version,
      _url: url,
      _description: description,
      _maintainer: maintainer,
    };
    const contract = yield appMetadataJs.uploadContract(admin, args);

    const appNameN = 'new appName';
    const versionN = 'new version';
    const urlN = 'new url';
    const descriptionN = 'new description';
    const maintainerN = 'new maintainer';

    const argsUpdate = {
      _appName: appNameN,
      _version: versionN,
      _url: urlN,
      _description: descriptionN,
      _maintainer: maintainerN,
    };
    const result = yield contract.update(argsUpdate);
    // state
    {
      const appMetadata = yield contract.getState();
      assert.equal(appMetadata.appName, appNameN, 'appName');
      assert.equal(appMetadata.version, versionN, 'version');
      assert.equal(appMetadata.url, urlN, 'url');
      assert.equal(appMetadata.description, descriptionN, 'description');
      assert.equal(appMetadata.maintainer, maintainerN, 'maintainer');
    }
  });

  it('should fail to update AppMetadata with new values as the wrong user', function* () {
    const appName = 'appName';
    const version = 'version';
    const url = 'url';
    const description = 'description';
    const maintainer = 'maintainer';

    const args = {
      _appName: appName,
      _version: version,
      _url: url,
      _description: description,
      _maintainer: maintainer,
    };
    const contract = yield appMetadataJs.uploadContract(admin, args);
    const testUser = yield rest.createUser(adminName, adminPassword);

    const appNameN = 'new appName';
    const versionN = 'new version';
    const urlN = 'new url';
    const descriptionN = 'new description';
    const maintainerN = 'new maintainer';

    const argsUpdate = {
      _appName: appNameN,
      _version: versionN,
      _url: urlN,
      _description: descriptionN,
      _maintainer: maintainerN,
    };
    const result = yield contract.update(argsUpdate, testUser);
    // state
    {
      const appMetadata = yield contract.getState();
      assert.equal(appMetadata.appName, appName, 'appName');
      assert.equal(appMetadata.version, version, 'version');
      assert.equal(appMetadata.url, url, 'url');
      assert.equal(appMetadata.description, description, 'description');
      assert.equal(appMetadata.maintainer, maintainer, 'maintainer');
    }
  });
});
