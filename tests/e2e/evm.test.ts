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
