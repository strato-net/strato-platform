"use strict";
import * as path from "path";

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
  constants,
  AccessToken
  } from 'blockapps-rest';

import BigNumber from "bignumber.js";
import * as chai from "chai";
chai.should();
chai.use(require('chai-bignumber')());

let config:Config=fsUtil.getYaml("config.yaml");
let options:Options={config}

config.apiDebug=true;

// Honestly, past this size bloc can't receive all connections.
const SIZE=10
const transactions = Array.from(Array(SIZE).keys()).map(i => {
  const name = `ScatterUpload_${i}`
  return { nonce: i, name: name, src: `contract record ${name} \{\}` }
})

async function sleep(timeout) {
  return new Promise(resolve => setTimeout(resolve, timeout))
}

describe("Concurrent uploads", function() {

  it('should create multiple contracts and see them all in cirrus', async function () {
    this.timeout(config.timeout);
    const user_name= 'multi_contract' + util.uid();
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let accessToken:AccessToken = await oauth.getAccessTokenByClientSecret();
    let ouser:OAuthUser = {token: accessToken.token.access_token};
    const user = await rest.createUser(ouser, options);
    let balance = new BigNumber(0);
    // while (balance.isZero()) {
    //   await sleep(500);
    //   let result = await rest.getAccounts(user, {...options, params: {address: user.address}})
    //   balance = new BigNumber(result[0].balance);
    // }
    console.log(`Balance of ${user_name} is ${balance}`)
    console.log("Beginning to upload contracts");
    const upload = rest.createContract
    const promises = transactions.map(tx =>
      upload(user, {name: tx.name, source: tx.src, args: {}}, {...options, cacheNonce: true}));
    let allResults = await Promise.all(promises);
    console.log(allResults);
    const query = rest.searchUntil
    const qromises = transactions.map(tx =>
      query(user, {name: `Test-${tx.name}`}, results => results.length > 0, options));
    let allQueries = await Promise.all(qromises);
    console.log(allQueries);
  });

});

