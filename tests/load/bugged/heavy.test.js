const ba = require('blockapps-rest');
const co = require('co');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const api = common.api;
const config = common.config;
const util = common.util;
const assert = common.assert;
const nodes = config.nodes;
const moment = require('moment');
const constants = common.constants;
const path = require('path');

const titleManagerJs = require(`./titleManager`);
const contractName = 'TitleHeavy';

const adminName = util.uid('Admin');
const adminPassword = '1234';

describe('LOAD TEST: Batch upload of heavy contract', function() {
  this.timeout(999999 * 1000);

  let admin, contract;
  const batchSize = util.getArgInt('--batchSize', 3);
  const batchCount = util.getArgInt('--batchCount', 1);

  before(function * () {
    console.log(`Creating admin user and contract`);
    admin = yield rest.createUser(adminName, adminPassword);
    console.log(admin);
    contract = yield titleManagerJs.uploadContract(admin);
    console.log(contract);
  });

  it(`Upload contract list: Batch size: ${batchSize}, Batch count ${batchCount}`, function * () {
    console.log(`Upload contract list: Batch size: ${batchSize}, Batch count ${batchCount}`);
    const uid = util.uid();

    const startTime = moment();
    for (var i = 0; i < batchCount; i++) {
      console.log( 'batch ' + i);
      const txs = createTxsBatch(uid, i, batchSize);
      const result = yield rest.uploadContractList(admin, txs);
    }
    const endTime = moment();
    const seconds = endTime.diff(startTime, 'seconds');
    console.log(`Batch count: ${batchCount}  Batch size: ${batchSize}`);
    console.log(`Total:  seconds: ${seconds}  txs: ${batchCount*batchSize}  TPS ${(batchCount*batchSize)/seconds}`);
  });


  function createTxsBatch(uid, batchId, batchSize) {
    const txs = [];
    for (var i = 0 ; i < batchSize; i++) {
      txs.push({
        contractName: contractName,
        args: {
          _s0: `s0_${uid}_${batchId}_${i}`,
          _s1: `s1_${uid}_${batchId}_${i}`,
          _s2: `s2_${uid}_${batchId}_${i}`,
          _s3: `s3_${uid}_${batchId}_${i}`,
          _s4: `s4_${uid}_${batchId}_${i}`,
          _s5: `s5_${uid}_${batchId}_${i}`,
          _s6: `s6_${uid}_${batchId}_${i}`,
          _s7: `s7_${uid}_${batchId}_${i}`,
          _s8: `s8_${uid}_${batchId}_${i}`,
          _s9: `s9_${uid}_${batchId}_${i}`,
        }
      });
    }
    return txs;
  }
});
