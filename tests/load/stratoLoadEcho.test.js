'use strict'

const ba = require('blockapps-rest');
const BigNumber = require('bignumber.js');
const co = require('co');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const config = common.config
const util = common.util;
const api = common.api;
const moment = require('moment');
const path = require('path')
const process = require('process');
const rp = require('request-promise');

const adminName = util.uid('Admin');
const adminPassword = '1234';

const contractName = 'GasDeal';
const contractFilename = path.join(config.contractsPath, "GasDeal.sol");

const enums = require('./enums');
const { GasDealEvent, PowerDealEvent, EchoRole, RestStatus, GasVolumeUnits, Constants, Args, PriceType } = enums

let txs = [];
let txResults = [];
let priceType;

// Allows the possibility of sharing the faucet node with all other test
// instances, so that nonces are allocated cooperatively.
async function faucet(addr) {
  let root = config.nodes[0].stratoUrl;
  if (process.env.FAUCET_STRATO) {
    root = `http://${process.env.FAUCET_STRATO}`
  }
  const options = {
    method: 'POST',
    uri: `${root}/eth/v1.2/faucet`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: `address=${addr}`,
    // TODO(tim): Modify to work with secured networks
    auth: {
      'user': 'admin',
      'pass': 'admin',
    }
  };
  await rp(options);
}

describe('Strato Load Test', function() {
  this.timeout(9999 * 1000);

  let admin;

  const batchSize = util.getArgInt('--batchSize', 1);
  const batchCount = util.getArgInt('--batchCount', 1);
  const batchDelay = util.getArgInt('--batchDelay', 0);


  before(function * () {
    console.log(`Creating admin user and contract`);
    // Create a user with no balance
    admin = yield rest.createUser(adminName, adminPassword, true);
    console.log(`User: ${admin.name} @ ${admin.address}`);
    yield faucet(admin.address);
    yield rest.compileSearch([contractName], contractName, contractFilename);
    console.log(contractFilename)
    let balance = new BigNumber(0);
    let retryCounter = 0
    while (balance.isZero()) {
      yield promiseTimeout(500);
      balance = yield rest.getBalance(admin.address);
      console.log(`Balance is: ${balance}`);
      retryCounter++;
      if (retryCounter % 10 == 0) {
        // Faucets can sometimes race against other faucets,
        // so for now we are more forgiving about address funding.
        // strato-api should be enhanced to accept concurrent faucets
        // per block
        yield faucet(admin.address);
      }
    }
  });

  it('Upload contracts', function * () {
    const startTime = moment();
    let blocTime = 0;
    const uidt = util.uid();
    const sArgs = createGasDealFixedArgs(uidt);
    let byte32array = argsToBytes32(sArgs)
    for(let i = 0; i < batchCount; i++) {
      console.log(`Creating ${batchSize} transactions for count ${i}`);
      factory_createUploadList(batchSize, i);
      const blocStartTime = moment();
      const results = yield api.bloc.uploadList({
        password: adminPassword,
        contracts: txs,
        resolve: true
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
  let nonce = 0;
  while(nonce < batchSize*batchCount) {
     yield promiseTimeout(5000);
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

function createGasDealFixedArgs(uid, args) { // TODO ECHO-358
    const sArgs = {
      uid: `${uid}`,
      isBuyDeal: true,
      traderId: 1,
      counterPartyId: 2,
      buyParty: 'TestBuyParty',
      sellParty: 'TestSellParty',
      priceType: PriceType.FIXED,
      dealPrice: 50012400,
      indexPriceAdder: 0,
      // Added in ECHO-358
      dealDate: 'testDealDate',
      beginFlowDate: 'testFlowDate',
      endFlowDate: 'testFlowDate',
      pipelineEBB: `PipelineEBB_${uid}`,
      receiptLocation: `ReceiptLocation_${uid}`,
      volume: 30,
      volumeUnits: 0,  //GasVolumeUnits.MMBtu
      strategy: 'strategy',
    }
    return Object.assign({}, sArgs, args);
  };

util.boolToBytes32 = (value) => {
  if (value != undefined && value == true) {
    return util.intToBytes32(1)
  }
  return util.intToBytes32(0)
}

function argsToBytes32(sArgs) {
  // create b32
  const args = Array.from({ length: Args.MAX }, () => (util.intToBytes32(0)));
  // set b32 from string args
  args[Args.UID] = util.toBytes32(sArgs.uid);
  args[Args.IS_BUY_DEAL] = util.boolToBytes32(sArgs.isBuyDeal);
  args[Args.TRADER_ID] = util.intToBytes32(sArgs.traderId);
  args[Args.COUNTER_PARTY_ID] = util.intToBytes32(sArgs.counterPartyId);
  args[Args.BUY_PARTY] = util.toBytes32(sArgs.buyParty);
  args[Args.SELL_PARTY] = util.toBytes32(sArgs.sellParty);
  // Added in ECHO-302, moved from setDetails
  args[Args.DEAL_PRICE] = util.intToBytes32(sArgs.dealPrice);
  args[Args.PRICE_TYPE] = util.intToBytes32(sArgs.priceType);
  args[Args.DEAL_DATE] = util.toBytes32(sArgs.dealDate);
  args[Args.BEGIN_FLOW_DATE] = util.toBytes32(sArgs.beginFlowDate);
  args[Args.END_FLOW_DATE] = util.toBytes32(sArgs.endFlowDate);
  args[Args.PIPELINE_EBB] = util.toBytes32(sArgs.pipelineEBB);
  args[Args.RECEIPT_LOCATION] = util.toBytes32(sArgs.receiptLocation);
  args[Args.VOLUME] = util.intToBytes32(sArgs.volume);
  args[Args.INDEX_PRICE_ADDER] = util.intToBytes32(sArgs.indexPriceAdder);
  args[Args.GAS_VOLUME_UNITS] = util.intToBytes32(sArgs.volumeUnits);
  args[Args.STRATEGY] = util.toBytes32(sArgs.strategy);
  return args;
}

function factory_createUploadList(batchSize, batchIndex) {
 // const dapp = yield dappJs.bind(deployment.admin, deployment.contract);
  let nonceSave = batchSize * batchIndex
  txs = [];
  for (var i = 0; i < batchSize; i++) {
    //createGasDealFixedArgs
    const uidt = util.uid();
    console.log(uidt);
    const sArgs = createGasDealFixedArgs(uidt);
     txs.push({
      contractName: contractName,
      args: {
        _echoPermissionManager:'2383914a2cffe7bb97e0b622481b945858e08188',
        _bytes32Array:argsToBytes32(sArgs),
      },
      txParams: {
        gasLimit: 10000000,
        gasPrice: 1,
        nonce: nonceSave + i
      }
    });
  }
  return txs;
}
