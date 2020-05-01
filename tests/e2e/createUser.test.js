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

const password = '1234';

describe("Create User - isAsync (do not resolve)", function() {

  it('should create a new user and get an address', function* () {
    this.timeout(config.timeout);
    const uid = util.uid();
    const username = 'User' + uid;
    // create user
    const isAsync = true;
    const user = yield rest.createUser(username, password, isAsync);
    assert.isDefined(user, "should exist");
    assert.isDefined(user.address, "should be defined");
    assert.notEqual(user.address, 0, "should be a nonzero address");
  });

  it('should fill from faucet - no resolve', function* () {
    this.timeout(config.timeout);
    const uid = util.uid();
    const username = 'User' + uid;
    // create user
    const isAsync = true;
    const user = yield rest.createUser(username, password, isAsync);
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
    const isAsync = true;
    const user = yield rest.createUser(username, password, isAsync);
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
    const isAsync = true;
    const user = yield rest.createUser(username, password, isAsync);
    // fill
    const resolve = true;
    const txResult = yield rest.fill(user, resolve);
    // get an object back
    assert.isObject(txResult);
    assert.equal(txResult.status, constants.SUCCESS, 'status with resolve should be success');
    // check account

    // FIXME: this might fail in multinode, since fill() will take longer
    const account = yield rest.getAccount(user.address);
    assert.isDefined(account, "account should exist");
    account[0].balance.should.be.bignumber.above(constants.FAUCET_REWARD);
  });

});

describe("Create User - sync (resolve)", function() {

  it('should create a new user and get an address', function* () {
    this.timeout(config.timeout);
    const uid = util.uid();
    const username = 'User' + uid;
    // create user
    const user = yield rest.createUser(username, password);
    assert.isDefined(user, "should exist");
    assert.isDefined(user.address, "should be defined");
    assert.notEqual(user.address, 0, "should be a nonzero address");
    // check account
    const account = yield rest.getAccount(user.address);
    assert.isDefined(account, "account should exist");
    account[0].balance.should.be.bignumber.above(constants.FAUCET_REWARD);
  });
});
