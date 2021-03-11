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
const contractName = 'Title';

const adminName = util.uid('Admin');
const adminPassword = '1234';

describe('LOAD TEST: Upload List', function() {
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

  it(`Upload plain.  Batch count ${batchCount}`, function * () {
    console.log(`Upload plain, Batch count ${batchCount}`);
    const contractName = 'TitleManager';
    const contractFilename = path.join(config.contractsPath,"TitleManager.sol");

    const startTime = moment();
    for (var i = 0; i < batchCount; i++) {
      console.log( 'batch ' + i);
      const args = {_creator: admin.address};
      const temp = yield rest.uploadContract(admin, contractName, contractFilename, args);
    }
    const endTime = moment();
    const seconds = endTime.diff(startTime, 'seconds');
    console.log(`Batch count: ${batchCount}  Batch size: ${batchSize}`);
    console.log(`Total:  seconds: ${seconds}  txs: ${batchCount*batchSize}  TPS ${(batchCount*batchSize)/seconds}`);
  })


  function createTxsBatch(uid, batchId, batchSize) {
    const txs = [];
    for (var i = 0 ; i < batchSize; i++) {
      txs.push({
        contractName: contractName,
        args: {
          _vin: `Vin_${uid}_${batchId}_${i}`,
        }
      });
    }
    return txs;
  }
});
