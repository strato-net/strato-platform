const ba = require('blockapps-rest');
const co = require('co');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const api = common.api;
const config = common.config;
const util = common.util;
const assert = common.assert;
const nodes = config.nodes;
const moment = require('moment');
const constants = common.constants;
const path = require('path');

const titleManagerJs = require(`../titleManager`);
const contractName = 'Title';

const adminName = util.uid('Admin');
const adminPassword = '1234';

describe('LOAD TEST: Upload from string', function() {
  this.timeout(999999 * 1000);

  let admin;
  const batchSize = util.getArgInt('--batchSize', 3);
  const batchCount = util.getArgInt('--batchCount', 1);

  before(function * () {
    console.log(`Creating admin user and contract`);
    admin = yield rest.createUser(adminName, adminPassword);
    console.log(admin);
  });

  it.skip(`Upload simple - search test:`, function * () {
    const uid = util.uid();
    const contractName = 'TitleMo';
    const contractFilename = `${config.libPath}/contracts/TitleMo.sol`;

    const args = {_vin: 'Vin_' + uid };
    const contract = yield rest.uploadContract(admin, contractName, contractFilename, args);
    const state = yield rest.getState(contract);
    const results = rest.query(`${contractName}?address=eq.${contract.address}`);
  });

  it.skip(`Upload simple - from string:`, function * () {
    const uid = util.uid();
    const contractName = 'TitleCA';
    const contractString = getContractString(20);

    const args = {_vin: 'Vin_' + uid };
    const contract = yield rest.uploadContractString(admin, contractName, contractString, args);
    const state = yield rest.getState(contract);
    const results = rest.query(`${contractName}?address=eq.${contract.address}`);
  });

  it.skip(`Upload simple - from string: Batch size: ${batchSize}, Batch count ${batchCount}`, function * () {
    const uid = util.uid();
    const contractName = 'TitleCA';
    const contractString = getContractString(contractName, batchSize);
    const args = {_vin: 'Vin_' + uid };

    const startTime = moment();
    for (var i = 0; i < batchCount; i++) {
      console.log(`Batch: ${i}`);
      const contract = yield rest.uploadContractString(admin, contractName, contractString, args);
    }
    const endTime = moment();
    const seconds = endTime.diff(startTime, 'seconds');
    console.log(`Batch count: ${batchCount}  Batch size: ${batchSize}`);
    console.log(`Total:  seconds: ${seconds},  TPS ${batchCount/seconds}, 1 TX: ${seconds/batchCount} seconds `);
  });

  it(`Upload simple - from string: Batch size: ${batchSize}, Batch count ${batchCount}`, function * () {
    const uid = util.uid();
    const contractName = 'TitleCA';
    const contractString = getContractString(contractName, batchSize);

    const startTime = moment();
    const doNotResolve = true;
    const hashes = [];
    for (var i = 0; i < batchCount; i++) {
      console.log(`Batch: ${i}`);
      const args = {_vin: 'Vin_' + uid + '_' + i};
      const hash = yield rest.uploadContractString(admin, contractName, contractString, args, doNotResolve);
      hashes.push(hash);
    }
    // wait for the hashes to resolve
    yield waitResults(hashes);
    printTiming(startTime, batchCount, batchSize);
  });

  it.only(`Upload from string: with NONCE:  Batch size: ${batchSize}, Batch count ${batchCount}`, function * () {
    const uid = util.uid();
    const contractName = 'TitleCA';
    const contractString = getContractString(contractName, batchSize);

    const startTime = moment();

    const nonce = yield getNonce(admin);
    console.log('Starting nonce', nonce);

    const doNotResolve = true;
    const hashes = [];
    for (var i = 0; i < batchCount; i++) {
      console.log(`Batch: ${i}`);
      const args = {_vin: 'Vin_' + uid + '_' + i};
      const txParams = {nonce: nonce+i};
      const hash = yield rest.uploadContractString(admin, contractName, contractString, args, doNotResolve, txParams);
      hashes.push(hash);
    }
    // wait for the hashes to resolve
    yield waitResults(hashes);
    printTiming(startTime, batchCount, batchSize);
  });
});

function printTiming(startTime, batchCount, batchSize) {
  const endTime = moment();
  const seconds = endTime.diff(startTime, 'seconds');
  console.log(`Batch count: ${batchCount}  Batch size: ${batchSize}`);
  console.log(`Total:  seconds: ${seconds},  TPS ${batchCount/seconds}, 1 TX: ${seconds/batchCount} seconds `);
}

function* waitResults(hashes) {
  const getBlockResultPromises = [];
  hashes.map(hash => {
    const resolve = true;
    const promise = api.bloc.result(hash, resolve);
    getBlockResultPromises.push(promise);
  });
  const results = yield getBlockResultPromises;
  results.map(result => {
    assert.equal(result.status, 'Success', 'no success for ' +result.hash);
  });
}

function* getNonce(admin) {
  const accounts = yield rest.getAccount(admin.address);
  const nonce = accounts[0].nonce;
  return nonce;
}

function* sleep(milli) {
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      resolve();
    }, milli);
  });
}

function getContractString(contractName, count) {
  const template = ''+
'  contract $contractName$ {'+
'    string public vin;'+
'    $vars$'+
'    function Title(string _vin) public {'+
'      vin = _vin;'+
'    }'+
'  }';

  const allVars = [];
  for (var i = 0; i < count; i++) {
    const stringVar = `string public s${i} = 's${i}'; `
    allVars.push(stringVar);
    const uintVar = `uint public u${i} = ${i}; `
    allVars.push(uintVar);
    const boolVar = `bool public b${i} = ${(i%2==1)?'false':'true'}; `
    allVars.push(boolVar);
    const addressVar = `address public a${i} = 0x100${i}; `
    allVars.push(addressVar);
  }
  const string = template.replace('$contractName$', contractName).replace('$vars$', allVars.join(' ') );
  return string;
}
