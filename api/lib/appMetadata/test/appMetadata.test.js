require('co-mocha');
const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const assert = common.assert;

const appMetadataJs = require('../appMetadata');

const adminName = util.uid('Admin');
const adminPassword = '1234';


const timeout = 30000;

describe('AppMetadata tests', function() {
  this.timeout(timeout);

  let admin;

  before(function* () {
    admin = yield rest.createUser(adminName, adminPassword);
  });

  it('Create AppMetadata - constructor arguments', function* () {
    const appName = 'appName';
    const version = 'version';
    const description = 'description';
    const maintainer = 'maintainer';
    const hash = 'hash';
    const host = 'host';

    const args = {
      _appName: appName,
      _version: version,
      _description: description,
      _maintainer: maintainer,
      _hash: hash,
      _host: host,
    };

    const contract = yield appMetadataJs.uploadContract(admin, args);
    // state
    {
      const appMetadata = yield contract.getState();
      assert.equal(appMetadata.appName, appName, 'appName');
      assert.equal(appMetadata.version, version, 'version');
      assert.equal(appMetadata.description, description, 'description');
      assert.equal(appMetadata.maintainer, maintainer, 'maintainer');
      assert.equal(appMetadata.hash, hash, 'hash');
      assert.equal(appMetadata.host, host, 'host')
    }
    // query
    {
      const appMetadata = yield appMetadataJs.getAppMetadata(contract.address);
      assert.equal(appMetadata.appName, appName, 'appName');
      assert.equal(appMetadata.version, version, 'version');
      assert.equal(appMetadata.description, description, 'description');
      assert.equal(appMetadata.maintainer, maintainer, 'maintainer');
      assert.equal(appMetadata.hash, hash, 'hash');
      assert.equal(appMetadata.host, host, 'host');
    }
  });

  it('should update AppMetadata with new values', function* () {
    const appName = 'appName';
    const version = 'version';
    const description = 'description';
    const maintainer = 'maintainer';
    const hash = 'hash';
    const host = 'host';

    const args = {
      _appName: appName,
      _version: version,
      _description: description,
      _maintainer: maintainer,
      _hash: hash,
      _host: host,
    };
    const contract = yield appMetadataJs.uploadContract(admin, args);

    const appNameN = 'new appName';
    const versionN = 'new version';
    const descriptionN = 'new description';
    const maintainerN = 'new maintainer';
    const hashN = 'new hash';
    const hostN = 'new host';

    const argsUpdate = {
      _appName: appNameN,
      _version: versionN,
      _description: descriptionN,
      _maintainer: maintainerN,
      _hash: hashN,
      _host: hostN,
    };
    const result = yield contract.update(argsUpdate);
    // state
    {
      const appMetadata = yield contract.getState();
      assert.equal(appMetadata.appName, appNameN, 'appName');
      assert.equal(appMetadata.version, versionN, 'version');
      assert.equal(appMetadata.description, descriptionN, 'description');
      assert.equal(appMetadata.maintainer, maintainerN, 'maintainer');
      assert.equal(appMetadata.hash, hashN, 'hash');
      assert.equal(appMetadata.host, hostN, 'host');
    }
  });

  it('should fail to update AppMetadata with new values as the wrong user', function* () {
    const appName = 'appName';
    const version = 'version';
    const description = 'description';
    const maintainer = 'maintainer';
    const hash = 'hash';
    const host = 'host';

    const args = {
      _appName: appName,
      _version: version,
      _description: description,
      _maintainer: maintainer,
      _hash: hash,
      _host: host,
    };
    const contract = yield appMetadataJs.uploadContract(admin, args);
    const testUser = yield rest.createUser(adminName, adminPassword);

    const appNameN = 'new appName';
    const versionN = 'new version';
    const descriptionN = 'new description';
    const maintainerN = 'new maintainer';
    const hashN = 'new hash';
    const hostN = 'new host';

    const argsUpdate = {
      _appName: appNameN,
      _version: versionN,
      _description: descriptionN,
      _maintainer: maintainerN,
      _hash: hashN,
      _host: hostN,
    };
    const result = yield contract.update(argsUpdate, testUser);
    // state
    {
      const appMetadata = yield contract.getState();
      assert.equal(appMetadata.appName, appName, 'appName');
      assert.equal(appMetadata.version, version, 'version');
      assert.equal(appMetadata.description, description, 'description');
      assert.equal(appMetadata.maintainer, maintainer, 'maintainer');
      assert.equal(appMetadata.hash, hash, 'hash');
      assert.equal(appMetadata.host, host, 'host');
    }
  });
});
