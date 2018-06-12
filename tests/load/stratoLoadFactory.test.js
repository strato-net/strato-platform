'use strict'

const ba = require('blockapps-rest');
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

const factoryContractName = 'VehicleFactory';
const factoryContractFilename = path.join(config.contractsPath,"VehicleFactory.sol");

let contractAddress;
let txs = [];
let txResults = [];

describe('Throughput - upload', function () {
  this.timeout(9999 * 1000);

  let admin;

  const batchSize = util.getArgInt('--batchSize', 1);
  const batchCount = util.getArgInt('--batchCount', 1);
  const batchDelay = util.getArgInt('--batchDelay', 0);

  before(function* () {
    console.log(`Creating admin user and contract`);
    admin = yield rest.createUser(adminName, adminPassword);
    yield rest.compileSearch([factoryContractName], factoryContractName, factoryContractFilename);
    const contract = yield rest.uploadContract(admin, factoryContractName, factoryContractFilename);
    contractAddress = contract.address;
  });

  it('Upload contracts', function* () {
    const startTime = moment();
    let blocTime = 0;
    for (let i = 0; i < batchCount; i++) {
      console.log(`Creating ${batchSize} transactions for count ${i}`);
      factory_createCallList(batchSize, i);
      const blocStartTime = moment();
      const results = yield api.bloc.callList({
        password: adminPassword,
        txs: txs.slice(batchSize * i, batchSize * i + batchSize),
        resolve: false
      }, admin.name, admin.address, false);
      const blocEndTime = moment();
      blocTime += blocEndTime.diff(blocStartTime, 'seconds');
      console.log(`Received ${results.length} receipts`);
      txResults = txResults.concat(results);
      if (batchDelay > 100) {
        yield promiseTimeout(batchDelay);
      }
    }

    console.log(`Waiting on address '${admin.address}' to reach nonce ${batchSize*batchCount}`);
    yield waitResult(admin.address, batchSize, batchCount);

    const endTime = moment();
    const seconds = endTime.diff(startTime, 'seconds');
    console.log(`Total seconds: ${seconds}, Bloc Submission Time: ${blocTime}  TPS ${batchSize * batchCount / seconds}`);

  });

});

function factory_createCallList(batchSize, batchIndex) {
  for (let i = 0; i < batchSize; i++) {
    // function Vehicle(string _vin, string _s0, string _s1, string _s2, string _s3) public
    txs.push({
      contractAddress: contractAddress,
      contractName: 'VehicleFactory',
      methodName: 'createVehicle',
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
      },
      value: 0,
    });
  }
  return txs;
}

function * waitResult(address, batchSize, batchCount) {
  let result = yield api.strato.account(address);
  while(result[0].nonce < batchSize*batchCount) {
    console.log(`Current Nonce is: ${result[0].nonce}`);
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
