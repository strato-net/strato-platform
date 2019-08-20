'use strict'

const ba = require('blockapps-rest');
const BigNumber = require('bignumber.js');
const co = require('co');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const config = common.config;
const util = common.util;
const api = common.api;
const moment = require('moment');
const path = require('path');

const adminName = util.uid('Admin');
const adminPassword = '1234';

const contractName = 'Vehicle';
const contractFilename = path.join(config.contractsPath,"Vehicle.sol");

let txs = [];
let txResults = [];

describe('Strato Load Test', function() {
  this.timeout(9999 * 1000);

  let admin;

  const batchSize = util.getArgInt('--batchSize', 1);
  const batchCount = util.getArgInt('--batchCount', 1);
  const batchDelay = util.getArgInt('--batchDelay', 0);
  console.log(`batchSize`, batchSize);
  console.log(`batchCount`, batchCount);
  console.log('delay', batchDelay, 'ms');


  before(function * () {
    console.log(`Creating admin user and contract`);
    admin = yield rest.createUser(adminName, adminPassword);
    console.log(`User: ${admin.name} @ ${admin.address}`);
    yield rest.compileSearch([contractName], contractName, contractFilename);
    let balance = new BigNumber(0);
    while (balance.isZero()) {
      yield promiseTimeout(500);
      balance = yield rest.getBalance(admin.address);
      console.log(`Balance is: ${balance}`);
    }
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
         console.log('delay', batchDelay, 'ms');
        yield promiseTimeout(batchDelay);
      }
    }

    const lastHash = txResults[txResults.length -1].hash;

    console.log(`Waiting on address '${admin.address}' to reach nonce ${batchSize*batchCount}`);
    yield waitResult(admin.address, batchSize, batchCount);

    const endTime = moment();
    const seconds = endTime.diff(startTime, 'seconds');
    console.log(`Total seconds: ${seconds}, Bloc Submission Time: ${blocTime}  TPS ${batchSize * batchCount/seconds}`);

    var TPS = batchSize * batchCount/seconds;
    var data  = [TPS,]; //Alternatively [seconds,blocTime,TPS];
    const fs = require('fs');
    fs.appendFile("graph_PERFORMANCE_multinode_strato_load_custom.csv", data, function(err) {
        if(err) {
            return console.log(err);
        }

        console.log("graph_PERFORMANCE_multinode_strato_load_custom.csv data has been sent!");
        });
    fs.appendFile("graph_PERFORMANCE_multinode_strato_load_custom.csv", "\n", function(err) {
        if(err) {
            return console.log(err);
        }

        //console.log("The file was saved!");
        });

  });

});

function * waitResult(address, batchSize, batchCount) {
  let nonce = 0;
  while(nonce < batchSize*batchCount) {
    yield promiseTimeout(500);
    try {
      console.log(`Current Nonce is: ${nonce}`)
      let result = yield api.strato.account(address);
      console.log(`Result: ${JSON.stringify(result)}`);
      nonce = result[0].nonce;
    } catch (e) {
      console.error(e);
    }
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
