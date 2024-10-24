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

const label = 'My chain label';
const src = `contract Governance {
  constructor() {}
  enum Rule { NOTHING, AUTO_APPROVE, TWO_VOTES_IN, MAJORITY_RULES }
  event OrgAdded(string orgName);
  event OrgRemoved(string orgName);
  function voteToAdd(string o) { 
    emit OrgAdded(o);
  }
  function voteToRemove(string o) {
    emit OrgRemoved(o);
  }
}`;
const args = {addRule: 'AUTO_APPROVE', removeRule: 'AUTO_APPROVE'};
const members = [{
    orgName: "BlockApps"
  }, {
    orgName: "Microsoft"
  }];
const balances = [
           { address: "00000000000000000000000000000000deadbeef"
           , balance: 1000000000000000000000
           },
           { address: "0000000000000000000000000000000012345678"
           , balance: 0
           }];

let oauth:oauthUtil;
let ouser1:OAuthUser;
let ouser2:OAuthUser;

var alicename;
var bobname;
var alice:BlockChainUser;
var bob:BlockChainUser;
var chainId;

// describe("Create Chain", function() {
//   this.timeout(config.timeout);

//   before(async() => {
//     // create user
//     oauth = await oauthUtil.init(config.nodes[0].oauth);
//     let accessToken1:AccessToken = await oauth.getAccessTokenByResourceOwnerCredential("user3", "1234", "strato-devel");
//     ouser1 = {token: accessToken1.token.access_token};
//     let accessToken2:AccessToken = await oauth.getAccessTokenByResourceOwnerCredential("user4", "1234", "strato-devel");
//     ouser2 = {token: accessToken2.token.access_token};
//     alice = await rest.createUser(ouser1, options);
//     bob = await rest.createUser(ouser2, options);

//     const bals = [{ address: alice.address, balance: 1000000000000000000000}
//                  ,{ address: bob.address, balance: 0}
//                  ];
//     const mems = members;
//     chainId = await rest.createChain(alice, {label, members: mems, balances: bals, src, args}, {name: "Governance"}, options);
//     await promiseTimeout(1000);
//     const chainInfo = await rest.getChain(ouser1, chainId, options);
//     console.log('###CHAININFO###', chainInfo);
//   });
  
//   it('should add and remover a member from the chain', async() => {
//     const addName = 'voteToAdd';
//     const removeName = 'voteToRemove';
//     const gov = { name: 'Governance', address: '0000000000000000000000000000000000000100' }
//     const args = { o: 'Amazon' }

//     await rest.call(alice, {contract: gov, method: addName, args, chainid: chainId}, options);

//     const action = (opts) => rest.getChain(ouser1, chainId, opts);
//     const addPredicate = (ci) => ci.info.members.length === 3
//     const removePredicate = (ci) => ci.info.members.length === 4
//     await util.until(addPredicate, action, options)
//     const chainInfo1 = await rest.getChain(ouser1, chainId, options);
//     console.log('###CHAININFO###',chainInfo1);
//     assert.deepEqual(chainInfo1.info.members.length, 3, "member should be added");

//     await rest.call(alice, {contract: gov, method: removeName, args, chainid: chainId}, options);

//     await util.until(removePredicate, action, options)
//     const chainInfo2 = await rest.getChain(ouser1, chainId, options);
//     console.log('###CHAININFO###',chainInfo2);
//     assert.deepEqual(chainInfo2.info.members.length, 4, "member should be removed");

//   });

// });

// function promiseTimeout(timeout) {
//   return new Promise(function(resolve, reject) {
//     setTimeout(resolve, timeout);
//   });
// }
