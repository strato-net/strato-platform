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
  enum Rule { NOTHING, AUTO_APPROVE, TWO_VOTES_IN, MAJORITY_RULES }
  event MemberAdded(address member, string enode);
  event MemberRemoved(address member);
  function voteToAdd(address m, string e) { 
    emit MemberAdded(m,e);
  }
  function voteToRemove(address m) {
    emit MemberRemoved(m);
  }
}`;
const args = {addRule: 'AUTO_APPROVE', removeRule: 'AUTO_APPROVE'};
const members = [{
    address: "00000000000000000000000000000000deadbeef"
  , enode: "enode://6d8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@171.16.0.4:30303?discport=30303"
  }, {
    address: "0000000000000000000000000000000012345678"
  , enode: "enode://6f8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@172.16.0.5:30303?discport=30303"
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

describe("Create Chain", function() {
  this.timeout(config.timeout);

  before(async() => {
    // create user
    oauth = oauthUtil.init(config.nodes[0].oauth);
    let accessToken1:AccessToken = await oauth.getAccessTokenByResourceOwnerCredential("user1", "1234", "strato-devel");
    ouser1 = {token: accessToken1.token.access_token};
    let accessToken2:AccessToken = await oauth.getAccessTokenByResourceOwnerCredential("user2", "1234", "strato-devel");
    ouser2 = {token: accessToken2.token.access_token};
    alice = await rest.createUser(ouser1, options);
    bob = await rest.createUser(ouser2, options);

    const bals = [{ address: alice.address, balance: 1000000000000000000000}
                 ,{ address: bob.address, balance: 0}
                 ];
    const mems = [{address: alice.address, enode: members[0].enode}
                 ,{address: bob.address, enode: members[1].enode}
		 ];
    chainId = await rest.createChain(alice, {label, members: mems, balances: bals, src, args}, {name: "Governance"}, options);
    await promiseTimeout(1000);
    const chainInfo = await rest.getChain(ouser1, chainId, options);
    console.log('###CHAININFO###', chainInfo);
  });
  
  it('should add and remover a member from the chain', async() => {
    const addName = 'voteToAdd';
    const removeName = 'voteToRemove';
    const gov = { name: 'Governance', address: '0000000000000000000000000000000000000100' }
    const args = { m: '00000000000000000000000000000000deadbeef', e: 'enode://6f8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@172.16.0.6:30303?discport=30303' }

    await rest.call(alice, {contract: gov, method: addName, args, chainid: chainId}, options);

    const chainInfo1 = await rest.getChain(ouser1, chainId, options);
    console.log('###CHAININFO###',chainInfo1);
    assert.deepEqual(chainInfo1.info.members.length, 3, "member should be added");

    await rest.call(alice, {contract: gov, method: removeName, args, chainid: chainId}, options);

    const chainInfo2 = await rest.getChain(ouser1, chainId, options);
    console.log('###CHAININFO###',chainInfo2);
    assert.deepEqual(chainInfo2.info.members.length, 2, "member should be removed");

  });

});

function promiseTimeout(timeout) {
  return new Promise(function(resolve, reject) {
    setTimeout(resolve, timeout);
  });
}
