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
  CallArgs,
  constants,
  importer
  } from 'blockapps-rest';

import BigNumber from "bignumber.js";
import * as chai from "chai";
chai.should();
chai.use(require('chai-bignumber')());

let config:Config = fsUtil.getYaml("config.yaml");
let options:Options = {config};

const factoryContractName = 'VehicleFactory';
const factoryContractFilename = path.join(config.contractsPath,"VehicleFactory.sol");

let theContract:Contract;
let txs:CallArgs[] = [];
let txResults = [];

describe('Throughput - upload', function () {
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
    theContract = <Contract> await rest.createContract(admin, {name: factoryContractName, source: await importer.combine(factoryContractFilename), args: {}}, {...options, isAsync: false, config: {...options.config, VM: "SolidVM"}});
  });

  it('Upload contracts', async() => {
    const startTime = moment();
    let blocTime = 0;
    for (let i = 0; i < batchCount; i++) {
      console.log(`Creating ${batchSize} transactions for count ${i}`);
      factory_createCallList(batchSize, i);
      const blocStartTime = moment();

      const results = await rest.callList(admin,
        txs.slice(batchSize * i, batchSize * i + batchSize),
      	{...options, isAsync: true, config: {...options.config, VM: "SolidVM"}});

      const blocEndTime = moment();
      blocTime += blocEndTime.diff(blocStartTime, 'seconds');
      console.log(`Received ${results.length} receipts`);
      txResults = txResults.concat(results);
      if (batchDelay > 100) {
        await promiseTimeout(batchDelay);
      }
    }

    console.log(`Waiting on address '${admin.address}' to reach nonce ${batchSize*batchCount}`);
    await waitResult(admin, admin.address, batchSize, batchCount);

    const endTime = moment();
    const seconds = endTime.diff(startTime, 'seconds');
    console.log(`Total seconds: ${seconds}, Bloc Submission Time: ${blocTime}  TPS ${batchSize * batchCount / seconds}`);

  });

});

function factory_createCallList(batchSize, batchIndex) {
  for (let i = 0; i < batchSize; i++) {
    // function Vehicle(string _vin, string _s0, string _s1, string _s2, string _s3) public
    txs.push({
      contract: theContract,
      method: 'createVehicle',
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
      value: new BigNumber(0),
    });
  }
  return txs;
}

async function waitResult(admin, address, batchSize, batchCount) {
  let result = await rest.getAccounts(admin, {...options, params: {address}});
  while(result[0].nonce < batchSize*batchCount) {
    console.log(`Current Nonce is: ${result[0].nonce}`);
    await promiseTimeout(500);
    result = await rest.getAccounts(admin, {...options, params: {address}});
  }
}

function promiseTimeout(timeout) {
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      resolve();
    }, timeout);
  });
}
