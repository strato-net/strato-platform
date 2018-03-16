const ba = require('blockapps-rest');
const co = require('co');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const api = common.api;
const moment = require('moment');

const adminName = util.uid('Admin');
const adminPassword = '1234';

const contractName = 'Vehicle';
const contractFilename = process.cwd() + `/e2e/load/contracts/Vehicle.sol`;

let txs = [];
let txResults = [];

describe('Strato Load Test', function() {
  this.timeout(9999 * 1000);

  let admin;

  const batchSize = util.getArgInt('--batchSize', 1);
  const batchCount = util.getArgInt('--batchCount', 1);

  before(function * () {
    console.log(`Creating admin user and contract`);
    admin = yield rest.createUser(adminName, adminPassword);
    yield rest.compileSearch([contractName], contractName, contractFilename);
  });

  it('Upload contracts', function * () {
    const startTime = moment();
    for(let i = 0; i < batchCount; i++) {
      console.log(`Creating ${batchSize} transactions for count ${i}`);
      factory_createUploadList(batchSize, i);
      const results = yield api.bloc.uploadList({
        password: adminPassword,
        contracts: txs.slice(batchSize * i, batchSize * i + batchSize),
        resolve: false 
      }, admin.name, admin.address, false);
      console.log(`Received ${results.length} receipts`);
      txResults = txResults.concat(results);
    
    }

    const lastHash = txResults[txResults.length -1].hash;

    console.log(`Waiting on hash '${lastHash}' to resolve`);
    yield waitResult(lastHash);

    const endTime = moment();
    const seconds = endTime.diff(startTime, 'seconds');
    console.log(`Total:  seconds: ${seconds},  TPS ${batchSize * batchCount/seconds}`);    

  });
  
});

function * waitResult(hash) {
  let result = yield api.strato.transactionResult(hash);
  while(!(result.length == 1 && result[0].status == 'success')) {
    if(result.length == 1) {
      console.log(`Current status for hash '${hash}' is '${result[0].status}`);
    }
    yield promiseTimeout(200);
    result = yield api.strato.transactionResult(hash);
  }
}

function promiseTimeout(timeout) {
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      resolve();
    }, timeout);
  });
}

function factory_createUploadList(batchSize, batchIndex) {
  for (var i = 0; i < batchSize; i++) {
    // function Vehicle(string _vin, string _s0, string _s1, string _s2, string _s3) public
    txs.push({
      contractName: contractName,
      args: {
        _vin: `vin_${batchIndex}_${i}`,
        _s0: `s0_${batchIndex}_${i}`,
        _s1: `s1_${batchIndex}_${i}`,
        _s2: `s2_${batchIndex}_${i}`,
        _s3: `s3_${batchIndex}_${i}`,
      },
      txParams: {
        gasLimit: 10000000000,
        gasPrice: 1,
        nonce: batchSize * batchIndex + i
      }
    });
  }
  return txs;
}