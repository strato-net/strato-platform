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

const contractName = 'GasDeal';
const contractFilename = path.join(config.contractsPath, "GasDeal.sol");

let txs = [];
let txResults = [];
let PriceType;

describe('Strato Load Test', function() {
  this.timeout(9999 * 1000);

  let admin;

  const batchSize = util.getArgInt('--batchSize', 1);
  const batchCount = util.getArgInt('--batchCount', 1);
  const batchDelay = util.getArgInt('--batchDelay', 0);
  

  before(function * () {
    console.log(`Creating admin user and contract`);
    admin = yield rest.createUser(adminName, adminPassword);
    console.log(`User: ${admin.name} @ ${admin.address}`);
    const pricePath = path.join(config.contractsPath,"GasDeal/PriceType.sol")
    PriceType = yield rest.getEnums(pricePath)
    console.log(PriceType)
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

    console.log(`Waiting on address '${admin.address}' to reach nonce ${batchSize*batchCount}`);
    yield waitResult(admin.address, batchSize, batchCount);

    const endTime = moment();
    const seconds = endTime.diff(startTime, 'seconds');
    console.log(`Total seconds: ${seconds}, Bloc Submission Time: ${blocTime}  TPS ${batchSize * batchCount/seconds}`);    

  });
  
});

function * waitResult(address, batchSize, batchCount) {
  let result = [{nonce: 0}];
  while(result[0].nonce < batchSize*batchCount) {
    console.log(`Current Nonce is: ${result[0].nonce}`)
    yield promiseTimeout(500);
    try {
    result = yield api.strato.account(address);
    } catch (e) {
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
    //createGasDealFixedArgs
    txs.push({
      contractName: contractName,
      args: {
        _uid: `uid_${batchIndex}_${i}`,
        _isBuyDeal: `isBuyDeal_${batchIndex}_${i}`,
        _traderId: `traderId_${batchIndex}_${i}`,
        _counterPartyId: `counterPartyId_${batchIndex}_${i}`,
        _buyParty: `buyParty_${batchIndex}_${i}`,
        _sellParty: `sellParty_${batchIndex}_${i}`,
        _priceType: `priceType_${PriceType.FIXED}` ,
        _dealPrice: `dealPrice_${batchIndex}_${i}`,
        _indexPriceAdder: `indexPriceAdder_${batchIndex}_${i}`,
        _dealDate: `dealDate_${batchIndex}_${i}`,
        _beginFlowDate: `beginFlowDate_${batchIndex}_${i}`,
        _endFlowDate: `endFlowDate_${batchIndex}_${i}`,
        _pipelineEBB: `pipelineEBB_${batchIndex}_${i}`,
        _receiptLocation: `receiptLocation_${batchIndex}_${i}`,
        _volume: `volume_${batchIndex}_${i}`,
        _volumeUnits: `volumeUnits_${batchIndex}_${i}`,
        _strategy: `strategy_${batchIndex}_${i}`,
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
