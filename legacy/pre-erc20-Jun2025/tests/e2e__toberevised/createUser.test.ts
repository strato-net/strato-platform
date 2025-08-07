import {
  OAuthUser,
  BlockChainUser,
  Options,
  Config,
  rest,
  util,
  fsUtil,
  oauthUtil,
  assert,
  constants
  } from 'blockapps-rest';

import BigNumber from "bignumber.js";
import * as chai from "chai";
chai.should();
chai.use(require('chai-bignumber')());



let config:Config=fsUtil.getYaml("config.yaml");
let options:Options={config}

let ouser:OAuthUser;

describe("Create User", function() {
  this.timeout(config.timeout);

  before(async () => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    ouser = await oauth.getAccessTokenByClientSecret();
  });

  it('should create a new user and get an address', async () => {
    // create user
    const user:BlockChainUser = await rest.createUser(ouser, options);

    assert.isDefined(user, "should exist");
    assert.isDefined(user.address, "should be defined");
    assert.notEqual(user.address, 0, "should be a nonzero address");
  });

  it('should fill from faucet - no resolve', async () => {
    // create user
    const user:BlockChainUser = await rest.createUser(ouser, options);
    // fill
    const txResult = await rest.fill(user, {isAsync: true, ...options});
    // get an object back
    assert.isObject(txResult);
    assert.equal(txResult.status, constants.TxResultStatus.PENDING, 'status with no resolve should be pending');
  });

  it('should fill from faucet - with resolve', async () => {
    // create user
    const user:BlockChainUser = await rest.createUser(ouser, options);
    // fill
    const txResult = await rest.fill(user, options);
    // get an object back
    assert.isObject(txResult);
    assert.equal(txResult.status, constants.TxResultStatus.SUCCESS, 'status with resolve should be success');
  });

  it('should fill from faucet - with resolve', async () => {
    // create user
    const user:BlockChainUser = await rest.createUser(ouser, options);
    // fill
    const txResult = await rest.fill(user, options);
    // get an object back
    assert.isObject(txResult);
    assert.equal(txResult.status, constants.TxResultStatus.SUCCESS, 'status with resolve should be success');
    // check account

    // FIXME: this might fail in multinode, since fill() will take longer
    const account = await rest.getAccounts(user, {...options, params: {address: user.address}});
    assert.isDefined(account, "account should exist");
    account[0].balance.should.be.bignumber.above(constants.FAUCET_REWARD);
  });

});

describe("Create User - sync (resolve)", function() {

  it('should create a new user and get an address', async () => {
    const uid = util.uid();
    const username = 'User' + uid;
    // create user
    const user:BlockChainUser = await rest.createUser(ouser, options);
    assert.isDefined(user, "should exist");
    assert.isDefined(user.address, "should be defined");
    assert.notEqual(user.address, 0, "should be a nonzero address");
    // check account
    const account = await rest.getAccounts(user, {...options, params:{address: user.address}});
    assert.isDefined(account, "account should exist");
    account[0].balance.should.be.bignumber.above(constants.FAUCET_REWARD);
  });
});
