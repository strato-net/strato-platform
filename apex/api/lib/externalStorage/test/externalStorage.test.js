/* jshint esnext: true */
require('co-mocha');
const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const assert = common.assert;

const externalStorageJs = require('../externalStorage');

const adminName = util.uid('Admin');
const adminPassword = '1234';

const adminName2 = util.uid('Admin');
const adminPassword2 = '1234';


const timeout = 10000;

describe('External Storage tests', function () {
  this.timeout(timeout);

  let admin, admin2, contract;

  before(function* () {
    admin = yield rest.createUser(adminName, adminPassword);
    admin2 = yield rest.createUser(adminName2, adminPassword2);

    const args = {
      _uri: 'uri',
      _host: 'host',
      _hash: 'hash',
      _metadata: 'metadata',
    };

    contract = yield externalStorageJs.uploadContract(admin, args);
  });

  it('Create ExternalStorage - constructor arguments', function* () {

    const uri = 'uri';
    const host = 'host';
    const hash = 'hash';
    const metadata = 'metadata';

    // state
    {
      const externalStorage = yield contract.getState();

      console.log(externalStorage)
      assert.equal(externalStorage.uri, uri);
      assert.equal(externalStorage.host, host);
      assert.equal(externalStorage.fileHash, hash);
      assert.equal(externalStorage.metadata, metadata);
    }
    // query
    {
      const externalStorage2 = yield externalStorageJs.getExternalStorage(contract.address);
      assert.equal(externalStorage2.uri, uri);
      assert.equal(externalStorage2.host, host);
      assert.equal(externalStorage2.fileHash, hash);
      assert.equal(externalStorage2.metadata, metadata);
    }
  });

  it('should attest with new signers', function* () {
    const args = {};

    const result = yield externalStorageJs.attest(admin2, contract.address, args);
    // state
    {
      const appMetadata = yield contract.getState();
      assert.notEqual(appMetadata.signers.indexOf(admin2.address), -1);
    }
  });

});
