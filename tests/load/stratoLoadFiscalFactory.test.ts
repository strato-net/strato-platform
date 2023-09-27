'use strict'

import * as path from "path";
import * as moment from "moment";

import {
  OAuthUser,
  BlockChainUser,
  Options,
  Config,
  rest,
  util,
  fsUtil,
  oauthUtil,
  assert,
  constants,
  CallArgs,
  importer,
  Contract
  } from 'blockapps-rest';

import BigNumber from "bignumber.js";
import * as chai from "chai";
chai.should();
chai.use(require('chai-bignumber')());

let config:Config=fsUtil.getYaml("config.yaml");
let options:Options={config}

const startingNonce = 1 // should convert to 2 if running fill

const contractName = 'FiscalFactory';
const contractFilename = path.join(config.contractsPath,"FiscalFactory.sol");

let txs:CallArgs[] = [];
let txResults = [];

describe('Strato Load Test', function() {
  this.timeout(9999 * 1000);

  let admin;
  let contractAddress;

  const batchCopies = util.getArgInt('--batchCopies', 1);
  const batchSize = util.getArgInt('--batchSize', 1);
  const batchCount = util.getArgInt('--batchCount', 1);
  const batchDelay = util.getArgInt('--batchDelay', 0);

  before(async() => {
    console.log(`Creating admin user and contract`);
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    const ouser = await oauth.getAccessTokenByResourceOwnerCredential("user3", "1234", "strato-devel");
    admin = await rest.createUser(ouser, options);
    console.log(`User: ${admin.name} @ ${admin.address}`);
    let balance = new BigNumber(0);
//    while (balance.isZero()) {
//      await promiseTimeout(500);
//      let result = await rest.getAccounts(admin, {...options, params: {address: admin.address}});
//      balance = result[0].balance;
//      console.log(`Balance is: ${balance}`);
//    }
//    await rest.compileSearch([contractName], contractName, contractFilename);
    const args = { admin: admin.address, initialOriginator: admin.address }
    const contract = <Contract> await rest.createContract(admin, {name: contractName, source: await importer.combine(contractFilename), args}, {...options, isAsync: false, config: {...options.config, VM: "SolidVM"}});
    contractAddress = contract.address;
  });

  it('Upload contracts', async() => {
    const startTime = moment();
    let blocTime = 0;
    for(let i = 0; i < batchCount; i++) {
      console.log(`Creating ${batchSize} transactions for count ${i}`);
      factory_createCallList(contractAddress, batchSize, i, batchCopies);
      const blocStartTime = moment();
      console.log("doggy1");
      const results = await rest.callList(admin, 
        txs.slice(batchSize * i, batchSize * i + batchSize), {...options, isAsync: true, cacheNonce: true});
      const blocEndTime = moment();
      blocTime += blocEndTime.diff(blocStartTime, 'seconds');
      console.log(`Received ${results.length} receipts`);
      txResults = txResults.concat(results);
      if(batchDelay > 100) {
        await promiseTimeout(batchDelay);
      }
    }

    const lastHash = txResults[txResults.length -1].hash;

    console.log(`Waiting on address '${admin.address}' to reach nonce ${batchSize*batchCount + 1}`);
    await waitResult(admin, admin.address, batchSize, batchCount);

    const endTime = moment();
    const seconds = endTime.diff(startTime, 'seconds');
    const timestamp = new Date().getTime();  //current timestamp in milliseconds
    console.log(`Total seconds: ${seconds}, Bloc Submission Time: ${blocTime}  TPS: ${(batchCopies * batchSize * batchCount)/seconds} Timestamp: ${timestamp}`);

  });

});

async function waitResult(user, address, batchSize, batchCount) {
  let nonce = 0;
  while(nonce < batchSize*batchCount + startingNonce) {
    await promiseTimeout(500);
    try {
      console.log(`Current Nonce is: ${nonce}`)
      let result = await rest.getAccounts(user, {...options, params: {address}});
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
        contract: {address: contractAddress, name: 'FiscalFactory'},
        method: 'createFiscal',
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
          nonce: (batchSize * batchIndex) + i + startingNonce
        },
        value: new BigNumber(0),
      });
    } else {
      txs.push({
        contract: {address: contractAddress, name: 'FiscalFactory'},
        method: 'generateFiscal',
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
          nonce: (batchSize * batchIndex) + i + startingNonce
        },
        value: new BigNumber(0),
      });
    }
  }
  return txs;
}
