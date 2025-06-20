'use strict'

import * as path from 'path';
import * as moment from "moment";

import {
  OAuthUser,
  BlockChainUser,
  Options,
  Contract,
  Config,
  rest,
  util,
  fsUtil,
  oauthUtil,
  assert,
  constants,
  importer,
  ContractDefinition
  } from 'blockapps-rest';

import BigNumber from "bignumber.js";
import * as chai from "chai";
chai.should();
chai.use(require('chai-bignumber')());

const u = require("util");

let config:Config = fsUtil.getYaml("config.yaml");
let options:Options = {config};

const contractName = 'Vehicle';
const contractFilename = path.join(config.contractsPath,"Vehicle.sol");

let txs:ContractDefinition[] = [];
let txResults = [];

describe('Strato Load Test', function() {
  this.timeout(9999 * 1000);

  let admin;

  const batchSize = util.getArgInt('--batchSize', 1);
  const batchCount = util.getArgInt('--batchCount', 1);
  const batchDelay = util.getArgInt('--batchDelay', 0);


  before(async() => {
    console.log(`Creating admin user and contract`);
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    admin = await rest.createUser(ouser, options);
    console.log(`User: ${admin.name} @ ${admin.address}`);
//    await rest.createContract(admin, {name: contractName, source: await importer.combine(contractFilename), args: {}}, options);
    let balance = new BigNumber(0);
//    while (balance.isZero()) {
//      await promiseTimeout(500);
//      const accounts = await rest.getAccounts(admin, {...options, params: {address: admin.address}})
//      balance = accounts[0].balance;

//      console.log(`Balance is: ${balance}`);
//    }
  });

  it('Upload contracts', async() => {
    const startTime = moment();
    let blocTime = 0;
    for(let i = 0; i < batchCount; i++) {
      console.log(`Creating ${batchSize} transactions for count ${i}`);
      await factory_createUploadList(batchSize, i);
      const blocStartTime = moment();
      const results = await rest.createContractList(admin,
      	    txs.slice(batchSize * i, batchSize * i + batchSize), {...options, isAsync: true, config: {...options.config, VM: "SolidVM"}});
      const blocEndTime = moment();
      blocTime += blocEndTime.diff(blocStartTime, 'seconds');
      console.log(`Received ${results.length} receipts`);
      txResults = txResults.concat(results);
      if(batchDelay > 100) {
        await promiseTimeout(batchDelay);
      }
    }
//    const lastHash = txResults[txResults.length -1].hash;

    console.log(`Waiting on address '${admin.address}' to reach nonce ${batchSize*batchCount}`);
    await waitResult(admin, admin.address, batchSize, batchCount);

    const endTime = moment();
    const seconds = endTime.diff(startTime, 'seconds');
    console.log(`Total seconds: ${seconds}, Bloc Submission Time: ${blocTime}  TPS ${batchSize * batchCount/seconds}`);
  });

});

async function waitResult(admin, address, batchSize, batchCount) {
  let nonce = 0;
    while(nonce < batchSize*batchCount) {
    await promiseTimeout(500);
    try {
      console.log(`Current Nonce is: ${nonce}`)
      console.log("waiting for : " + batchSize*batchCount)
      let result = await rest.getAccounts(admin, {...options, params: {address}})
      console.log(`Result: ${JSON.stringify(result)}`);
      nonce = result[0].nonce;
    } catch (e) {
      console.error(e);
    }
  }
  console.log("final nonce = " + nonce);
}

function promiseTimeout(timeout) {
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      resolve();
    }, timeout);
  });
}

async function factory_createUploadList(batchSize, batchIndex):Promise<ContractDefinition[]> {
  for (let i = 0; i < batchSize; i++) {
    // function Vehicle(string _vin, string _s0, string _s1, string _s2, string _s3) public
    txs.push({
      name: contractName,
      source: await importer.combine(contractFilename),
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
