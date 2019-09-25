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

const contractName = 'FiscalFactoryEvent';
const contractFilename = path.join(config.contractsPath,"FiscalFactoryEvent.sol");

let txs = [];
let txResults = [];

describe('Strato Load Test', function() {
  this.timeout(9999 * 1000);

  let admin;
  let contractAddress;

  const batchCopies = util.getArgInt('--batchCopies', 1);
  const batchSize = util.getArgInt('--batchSize', 1);
  const batchCount = util.getArgInt('--batchCount', 1);
  const batchDelay = util.getArgInt('--batchDelay', 0);

  before(function * () {
    console.log(`Creating admin user and contract`);
    admin = yield rest.createUser(adminName, adminPassword);
    console.log(`User: ${admin.name} @ ${admin.address}`);
    let balance = new BigNumber(0);
    while (balance.isZero()) {
      yield promiseTimeout(500);
      balance = yield rest.getBalance(admin.address);
      console.log(`Balance is: ${balance}`);
    }
//    yield rest.compileSearch([contractName], contractName, contractFilename);
    const args = { admin: admin.address, initialOriginator: admin.address }
    const contract = yield rest.uploadContract(admin, contractName, contractFilename, args);
    contractAddress = contract.address;
  });

  it('Upload contracts', function * () {
    const startTime = moment();
    let blocTime = 0;
    for(let i = 0; i < batchCount; i++) {
      console.log(`Creating ${batchSize} transactions for count ${i}`);
      factory_createCallList(contractAddress, batchSize, i, batchCopies);
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
      if(batchDelay > 100) {
        yield promiseTimeout(batchDelay);
      }
    }

    const lastHash = txResults[txResults.length -1].hash;

    console.log(`Waiting on address '${admin.address}' to reach nonce ${batchSize*batchCount + 1}`);
    yield waitResult(admin.address, batchSize, batchCount);

    const endTime = moment();
    const seconds = endTime.diff(startTime, 'seconds');
    const timestamp = new Date().getTime();  //current timestamp in milliseconds
    console.log(`Total seconds: ${seconds}, Bloc Submission Time: ${blocTime}  TPS: ${(batchCopies * batchSize * batchCount)/seconds} Timestamp: ${timestamp}`);

  });

});

function * waitResult(address, batchSize, batchCount) {
  let nonce = 0;
  while(nonce < batchSize*batchCount + 1) {
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

function factory_createCallList(contractAddress, batchSize, batchIndex, batchCopies) {
  for (let i = 0; i < batchSize; i++) {
    if (batchCopies <= 1) {
      txs.push({
        contractAddress: contractAddress,
        contractName: 'FiscalFactoryEvent',
        methodName: 'createFiscal',
        args: {
            src_countryCode: `src_countryCode_${batchIndex}_${i}`
          , src_currencyCode: `src_currencyCode_${batchIndex}_${i}`
          , src_phoneNumber: `src_phoneNumber_${batchIndex}_${i}`
          , src_taxCode: `src_taxCode_${batchIndex}_${i}`
          , src_latitude: (batchSize * batchIndex) + i + 1
          , src_longitude: (batchSize * batchIndex) + i + 1
          , dest_countryCode: `dest_countryCode_${batchIndex}_${i}`
          , dest_currencyCode: `dest_currencyCode_${batchIndex}_${i}`
          , dest_phoneNumber: `dest_phoneNumber_${batchIndex}_${i}`
          , dest_taxCode: `dest_taxCode_${batchIndex}_${i}`
          , dest_latitude: (batchSize * batchIndex) + i + 1
          , dest_longitude: (batchSize * batchIndex) + i + 1
          , srcCryptoWallet: `srcCryptoWallet_${batchIndex}_${i}`
          , destCryptoWalletCode: `destCryptoWalletCode_${batchIndex}_${i}`
          , amount: (batchSize * batchIndex) + i + 1
          , datasetCode: `datasetCode_${batchIndex}_${i}`
          , datasetSpecificFields_interest: `datasetSpecificFields_interest_${batchIndex}_${i}`
          , datasetSpecificFields_details: `datasetSpecificFields_details_${batchIndex}_${i}`
          , fakeTransaction: true
        },
        txParams: {
          gasLimit: 10000000,
          gasPrice: 1,
          nonce: (batchSize * batchIndex) + i + 1
        },
        value: 0,
		metadata: {"VM": "SolidVM"},
      });
    } else {
      txs.push({
        contractAddress: contractAddress,
        contractName: 'FiscalFactoryEvent',
        methodName: 'generateFiscal',
        args: {
            src_countryCode: `src_countryCode_${batchIndex}_${i}`
          , src_currencyCode: `src_currencyCode_${batchIndex}_${i}`
          , src_phoneNumber: `src_phoneNumber_${batchIndex}_${i}`
          , src_taxCode: `src_taxCode_${batchIndex}_${i}`
          , src_latitude: (batchSize * batchIndex) + i + 1
          , src_longitude: (batchSize * batchIndex) + i + 1
          , dest_countryCode: `dest_countryCode_${batchIndex}_${i}`
          , dest_currencyCode: `dest_currencyCode_${batchIndex}_${i}`
          , dest_phoneNumber: `dest_phoneNumber_${batchIndex}_${i}`
          , dest_taxCode: `dest_taxCode_${batchIndex}_${i}`
          , dest_latitude: (batchSize * batchIndex) + i + 1
          , dest_longitude: (batchSize * batchIndex) + i + 1
          , srcCryptoWallet: `srcCryptoWallet_${batchIndex}_${i}`
          , destCryptoWalletCode: `destCryptoWalletCode_${batchIndex}_${i}`
          , amount: (batchSize * batchIndex) + i + 1
          , datasetCode: `datasetCode_${batchIndex}_${i}`
          , datasetSpecificFields_interest: `datasetSpecificFields_interest_${batchIndex}_${i}`
          , datasetSpecificFields_details: `datasetSpecificFields_details_${batchIndex}_${i}`
          , fakeTransaction: true
          , copies: batchCopies
        },
        txParams: {
          gasLimit: 10000000*batchCopies,
          gasPrice: 1,
          nonce: (batchSize * batchIndex) + i + 1
        },
		metadata: {"VM": "SolidVM"},
        value: 0,
      });
    }
  }
  return txs;
}
