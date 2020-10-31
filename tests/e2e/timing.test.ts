const ba = require('blockapps-rest');
require('co-mocha');
const co = require('co');
const moment = require('moment');
const fs = require('fs');

const rest = ba.rest;
const api = ba.common.api;
const common = ba.common;
const util = common.util;
const BigNumber = common.BigNumber;
const constants = common.constants;
const assert = common.assert;
const config = common.config;


/* describe.only("block times", function() {
  this.timeout(config.timeout);
  it('block timea', function* () {
    const blockTimes = yield getBlockTimes(100);
    const jsonToCSV2 = require('json-to-csv');
    jsonToCSV2(blockTimes, 'blockTiming.csv');  //  FIXME thats a promise
  });
}); */


describe("Send Transaction Test", function() {
  this.timeout(config.timeout * config.nodes.length);

  const uid = util.uid();
  const userPairs = [];
  const nodes = config.nodes;
  const password = '1234';
  const value = new BigNumber(8).mul(constants.ETHER); // 8 eth in wei
  const stats = {};

  const txTiming = [];

  before(function* () {
    //stats.blockNumber = yield rest.getLastBlockNumber();
    //stats.startTime = moment().valueOf();
    // create a pair of users on every node
    yield createUserPairs(uid, password, userPairs);
  });

  it.skip('should send correct amount MULTIPLE TIMES between all pairs.  https://blockapps.atlassian.net/browse/API-20', function* () {
    const count = 20;
    var total = new BigNumber(0);
    // send multiple
    for (var i=0; i < count; i++) {
      const nodeValue = value.plus(i*100);
      total = total.plus(nodeValue);
      for (let node of nodes) {
        // send alice->bob on that node
        const pair = userPairs[node.id];
        yield send(node.id, pair.alice, pair.bob, nodeValue);
      }
    }
    //// block times
    //const blockTimes = yield getBlockTimes(count*nodes.length + 20);
    //// write timing to file
    //console.log(JSON.stringify(txTiming, null, 2));
    //const jsonToCSV1 = require('json-to-csv');
    //jsonToCSV1(txTiming, 'txTiming.csv');  //  FIXME thats a promise
    //const jsonToCSV2 = require('json-to-csv');
    //jsonToCSV2(blockTimes, 'blockTiming.csv');  //  FIXME thats a promise


      // check balance for those accounts on each node
    yield checkBalance(nodes[0].alice,nodes[0].bob,total);
    //const pair = userPairs[0];
      //yield checkBalance(pair.alice, pair.bob, total);
  });

  it('should send correct amount MULTIPLE TIMES between all pairs.  https://blockapps.atlassian.net/browse/API-20', function* () {
    const count = 20;
    var total = new BigNumber(0);
    // send multiple
    for (var i=0; i < count; i++) {
      const nodeValue = value.plus(i*100);
      total = total.plus(nodeValue);
        const txPending = [];
      for (let node of nodes) {
        // send alice->bob on that node
        const pair = userPairs[node.id];
          console.log('Sending', nodeValue.toString(), 'on node', node.id);
          txPending.push({status:'Pending', hash: yield rest.send(pair.alice,pair.bob,nodeValue,true,undefined,node.id)});
      }
      for (let pend of txPending) {
        console.log('~~~~~~~~~~ Resolving transaction', pend.hash, '~~~~~~~~~~');
        for (let node of nodes) {
          console.log('########## Resolving node', node.id, '##########');
          txResult = yield getResolved(function*(){return yield pend;},node);
          assert.equal(txResult.status,'Success', 'batch tx status');
        }
      }
    }
    yield checkBalance(nodes[0].alice,nodes[0].bob,total);
  });

  it.skip('should send correct amount of ether', function* () {
    const uid = util.uid();
    const aliceName = 'Alice' + uid;
    const bobName = 'Bob' + uid;

    const alice = yield rest.createUser(aliceName, password);
    const bob = yield rest.createUser(bobName, password);

    // must use BigNumber for balances
    alice.accounts = yield rest.getAccount(alice.address);
    alice.startingBalance = new BigNumber(alice.accounts[0].balance);

    bob.accounts = yield rest.getAccount(bob.address);
    bob.startingBalance = new BigNumber(bob.accounts[0].balance);

    assert.isOk(alice.startingBalance.equals(bob.startingBalance), "balances should be equal before sending ether");
    // send
    const receipt = yield rest.send(alice, bob, value);
    const txResult = yield rest.transactionResult(receipt.hash);
    assert.equal(txResult[0].status, 'success', 'tx status');
    // check balances
    alice.accounts = yield rest.getAccount(alice.address);
    alice.endBalance = new BigNumber(alice.accounts[0].balance);

    bob.accounts = yield rest.getAccount(bob.address);
    bob.endBalance = new BigNumber(bob.accounts[0].balance);

    //TODO Calculate gas cost and factor into balance
    assert.isOk(alice.startingBalance.minus(value).greaterThan(alice.endBalance), "alice's balance should be slightly less than expected due to gas costs");
    assert.isOk(bob.startingBalance.plus(value).equals(bob.endBalance), "bob's balance should be as expected after sending ether");
  });

    function* getResolved(func, node) {
        var txResult = yield func();
        var i = 0;
        while(txResult.status == 'Pending') {
            //console.log('Got pending result for', txResult.hash,':', i);]
            yield sleep(1000);
            txResult = yield rest.getBlocResult(txResult.hash, false, node.id);
            i++;
        }
        console.log('Got', txResult.status, 'result for', txResult.hash, 'after', i, 'attempts');

        if(txResult.status != 'Success') {
          console.log(txResult);
        }
        
        return txResult;
    }

  // ================================================================
  function* createUserPairs(uid, password, pairs) {
    console.log('creating users');
    for (let node of nodes) {
      // create
      const aliceName = `Alice_${node.id}_${uid}`;
      const alice = yield rest.createUser(aliceName, password, true, node.id);
      yield getResolved(function* (){return yield rest.fill(alice, false, node.id);}, node);
      console.log('alice', alice);
      //for(var i=0; i<1000000000; i++) {}; //about 3s delay. Done to allow p2p network to sync new faucet nonce and make it adjust for block time
      const bobName = `Bob_${node.id}_${uid}`;
      const bob = yield rest.createUser(bobName, password, true, node.id);
        yield getResolved(function* (){return yield rest.fill(bob, false, node.id);}, node);
      console.log('bob', bob);
      //for(var i=0; i<1000000000; i++) {}; //about 3s delay. Done to allow p2p network to sync new faucet nonce and make it adjust for block time
      const pair = {alice: alice, bob:bob};
      pairs[node.id]= pair;
      // test creation on the node
      const users = yield rest.getUsers(node.id);
      const found = users.filter(user => {
        return user === aliceName || user === bobName;
      });
      assert.equal(found.length, 2, 'must find both');
    }
    console.log('DONE creating users');
  }



  function sleep(milli) {
    //console.log('sleep', milli);
    return new Promise(resolve => setTimeout(resolve, milli));
  }

  function timerStart() {
    const now = new Date().getTime();
    return now;
  }

  function timerStop(startTime) {
    const now = new Date().getTime();
    return now - startTime;
  }

  function* send(nodeId, alice, bob, value, nonce) {
    // it is OK for nonce to be undefined!
    console.log('send', nodeId, alice.name, bob.name, value.toString(), nonce);
    //const startTime = timerStart();
    txResult = yield getResolved(function*(){hash = yield rest.send(alice,bob,value,true,nonce,nodeId); return {status: 'Pending', hash: hash};},nodeId);
    //const txElapsed = timerStop(startTime);
    ////const txResult = yield rest.transactionResult(receipt.hash, nodeId);
    //const blockElapsed = yield getLastBlockTime(nodeId);
    //const txTimingObject = {
    //  node: nodeId,
    //  txElapsed: txElapsed,
    //  txResultTime: txResult[0].time,
    //  blockElapsed: blockElapsed,
    //  blockHash: txResult[0].blockHash
    //  //txResult: txResult,
    //};
    //txTiming.push(txTimingObject);
    //console.log('send tx: txElapsed', txElapsed, 'txResult.time', txResult[0].time);

    assert.equal(txResult.status, 'Success', 'tx status');

    return txResult;
  }

  function* checkBalance(alice, bob, value) {
    const ACCOUNT_INDEX = 0;
    const FAUCET_AWARD = new BigNumber(1000).times(constants.ETHER) ;

    for (let node of nodes) {
      const pair = userPairs[node.id];
      console.log('checkBalance', node.id, pair.alice.name, pair.bob.name, value.toString());
      // check balances
      const aliceBalance = yield rest.getBalance(pair.alice.address, ACCOUNT_INDEX, node.id);
      const bobBalance = yield rest.getBalance(pair.bob.address, ACCOUNT_INDEX, node.id);
      bobBalance.should.be.bignumber.eq(FAUCET_AWARD.plus(value));
    }
  }

  //function* getBlockTimes(count, node) {
  //  const blocks = yield api.strato.last(count, node.id);
  //  const blockTimeStamps = blocks.map(block => {
  //    return {
  //      time: Date.parse(block.blockData.timestamp),
  //      difficulty: block.blockData.difficulty
  //    };
  //  });

  //  const blockTimeDelta = blockTimeStamps
  //    .slice(1)
  //    .map((block, index) => {
  //      const delta = blockTimeStamps[index+0].time - blockTimeStamps[index+1].time;
  //      return {
  //        delta: delta,
  //        difficulty: block.difficulty
  //      };
  //    });

  //  return blockTimeDelta;
  //}

  //function* getLastBlockTime(node) {
  //  const blocks = yield api.strato.last(2, node.id);
  //  // console.log(blocks);
  //  const t0 = Date.parse(blocks[0].blockData.timestamp);
  //  const t1 = Date.parse(blocks[1].blockData.timestamp);
  //  const elapsed = t0 - t1;
  //  console.log('block elapsed', elapsed, t0, t1);
  //  return elapsed;
  //}

});


//function* getBlockTimes(count, node) {
//  const blocks = yield api.strato.last(count, node.id);
//  const blockTimeStamps = blocks.map(block => {
//    return {
//      time: Date.parse(block.blockData.timestamp),
//      difficulty: block.blockData.difficulty,
//      number: block.blockData.number
//    };
//  });
//
//  const blockTimeDelta = blockTimeStamps
//    .slice(1)
//    .map((block, index) => {
//      const delta = blockTimeStamps[index+0].time - blockTimeStamps[index+1].time;
//      return {
//        delta: delta,
//        difficulty: block.difficulty,
//        number: block.number
//      };
//    });
//
//  return blockTimeDelta;
//}
