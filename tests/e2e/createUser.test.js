const ba = require('blockapps-rest');
require('co-mocha');

const rest = ba.rest;
const common = ba.common;
const api = common.api;
const util = common.util;
const BigNumber = common.BigNumber;
const constants = common.constants;
const assert = common.assert;
const config = common.config;

describe("Create User - async (do not resolve)", function() {

  const password = '1234';

  it('should create a new user and get an address', function* () {
    this.timeout(config.timeout);
    const uid = util.uid();
    const username = 'User' + uid;
    // create user
    const doNotResolve = true;
    const user = yield rest.createUser(username, password, doNotResolve);
    assert.isDefined(user, "should exist");
    assert.notEqual(user.address, 0, "should be a nonzero address");
  });

  it('should fill from faucet - no resolve', function* () {
    this.timeout(config.timeout);
    const uid = util.uid();
    const username = 'User' + uid;
    // create user
    const doNotResolve = true;
    const user = yield rest.createUser(username, password, doNotResolve);
    // fill
    const resolve = false;
    const txResult = yield rest.fill(user, resolve);
    // get an object back
    assert.isObject(txResult);
    assert.equal(txResult.status, constants.PENDING, 'status with no resolve should be pending');
  });

  it('should fill from faucet - with resolve', function* () {
    this.timeout(config.timeout);
    const uid = util.uid();
    const username = 'User' + uid;
    // create user
    const doNotResolve = true;
    const user = yield rest.createUser(username, password, doNotResolve);
    // fill
    const resolve = true;
    const txResult = yield rest.fill(user, resolve);
    // get an object back
    assert.isObject(txResult);
    assert.equal(txResult.status, constants.SUCCESS, 'status with resolve should be success');
  });

  it('should fill from faucet - with resolve', function* () {
    this.timeout(config.timeout);
    const uid = util.uid();
    const username = 'User' + uid;
    // create user
    const doNotResolve = true;
    const user = yield rest.createUser(username, password, doNotResolve);
    // fill
    const resolve = true;
    const txResult = yield rest.fill(user, resolve);
    // get an object back
    assert.isObject(txResult);
    assert.equal(txResult.status, constants.SUCCESS, 'status with resolve should be success');
    // check account
    const account = yield rest.getAccount(user.address);
    assert.isDefined(account, "account should exist");
    const expected = new BigNumber(1000).mul(constants.ETHER);
    account[0].balance.should.be.bignumber.eq(expected);
  });

});
