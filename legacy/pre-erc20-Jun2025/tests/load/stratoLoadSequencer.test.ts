'use strict'

const ba = require('blockapps-rest');
const co = require('co');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const config = common.config
const util = common.util;
const api = common.api;
const moment = require('moment');
const path = require('path')

const adminName = util.uid('Admin');
const adminPassword = '1234';

const contractName = 'Vehicle';
const contractFilename = path.join(config.contractsPath, "Vehicle.sol");

let txs = [];
let txResults = [];

describe('Strato Load Test', function() {
  this.timeout(9999 * 1000);

  let admin;

  const batchSize = util.getArgInt('--batchSize', 1);
  const batchCount = util.getArgInt('--batchCount', 1);
  const batchDelay = util.getArgInt('--batchDelay', 0);
  

  before(function * () {
    console.log(`Creating admin user and contract`);
    admin = yield rest.createUser(adminName, adminPassword, true);
    console.log(`User: ${admin.name} @ ${admin.address}`);
    yield rest.compileSearch([contractName], contractName, contractFilename);
  });

  it('Upload contracts', function * () {
    const startTime = moment();
    let blocTime = 0;
    for(let i = 0; i < batchCount; i++) {
      console.log(`Creating ${batchSize} transactions for count ${i}`);
      factory_createUploadList(batchSize, i);
      const blocStartTime = moment();
      const results = yield api.bloc.uploadList({
        password: adminPassword,
        contracts: txs.slice(batchSize * i, batchSize * i + batchSize),
        resolve: false 
      }, admin.name, admin.address, false);
      const blocEndTime = moment();
      blocTime += blocEndTime.diff(blocStartTime, 'seconds');
      console.log(`Received ${results.length} receipts`);
      txResults = txResults.concat(results);
      if(batchDelay > 100) {
        yield promiseTimeout(batchDelay);
      }
    }

    const lastHash = txResults[txResults.length -1].hash;

//    console.log(`Waiting on address '${admin.address}' to reach nonce ${batchSize*batchCount}`);
//    yield waitResult(admin.address, batchSize, batchCount);

    const endTime = moment();
    const seconds = endTime.diff(startTime, 'seconds');
    console.log(`Total seconds: ${seconds}, Bloc Submission Time: ${blocTime}  TPS ${batchSize * batchCount/seconds}`);    

  });
  
});

function * waitResult(address, batchSize, batchCount) {
  let result = yield api.strato.account(address);
  while(result[0].nonce < batchSize*batchCount) {
    console.log(`Current Nonce is: ${result[0].nonce}`)
    yield promiseTimeout(500);
    result = yield api.strato.account(address);
  }
}

function promiseTimeout(timeout) {
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      resolve();
    }, timeout);
  });
}

function isObject(val) {
  if (val === null) { return false;}
  return ( (typeof val === 'function') || (typeof val === 'object') );
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
        gasLimit: 10000000,
        gasPrice: 1,
        nonce: batchSize * batchIndex + i
      }
    });
  }
  return txs;
}
