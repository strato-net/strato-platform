import * as path from "path";
import * as moment from "moment";

import {
  OAuthUser,
  BlockChainUser,
  Options,
  Config,
  Contract,
  rest,
  util,
  fsUtil,
  oauthUtil,
  assert,
  constants,
  importer
  } from 'blockapps-rest';

import BigNumber from "bignumber.js";
import * as chai from "chai";
chai.should();
chai.use(require('chai-bignumber')());

let config:Config=fsUtil.getYaml("config.yaml");
let options:Options={config}

const titleManagerJs = require(`./titleManager`);
const contractName = 'Title';

describe('LOAD TEST: Upload from string', function() {
  this.timeout(999999 * 1000);

  let admin;
  const batchSize = util.getArgInt('--batchSize', 3);
  const batchCount = util.getArgInt('--batchCount', 1);

  before(async() => {
    console.log(`Creating admin user and contract`);
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    const ouser = await oauth.getAccessTokenByResourceOwnerCredential("user3", "1234", "strato-devel");
    admin = await rest.createUser(ouser, options);
    console.log(admin);
  });

  it.skip(`Upload simple - search test:`, async() => {
    const uid = util.uid();
    const contractName = 'TitleMo';
    const contractFilename = path.join(config.contractsPath, "TitleMo.sol");

    const args = {_vin: 'Vin_' + uid };
    const contract = <Contract> await rest.createContract(admin, {name: contractName, source: contractFilename, args}, options);
    const state = await rest.getState(admin, contract, options);
    const results = rest.search(admin, {...contract, name: contractName}, {...options, query: {address: `eq.${contract.address}`}});
  });

  it.only(`Stack Depth 1:`, async() => {
    const uid = util.uid();
    const contractName = 'StackDepth';
    const contractFilename = path.join(config.contractsPath, "StackDepth.sol");

    const args = {
      _s0: 's0_' + uid,
      _s1: 's1_' + uid,
      _s2: 's2_' + uid,
      _s3: 's3_' + uid,
      _s4: 's4_' + uid,
      _s5: 's5_' + uid,
      _s6: 's6_' + uid,
      _s7: 's7_' + uid,
      _s8: 's8_' + uid,
      _s9: 's9_' + uid,
      _u0: 1000,
      _u1: 1001,
      _u2: 1002,
      _u3: 1003,
      _u4: 1004,
      _u5: 1005,
      _u6: 1006,
      _u7: 1007,
      _u8: 1008,
      _u9: 1009,
    };
    const contract = <Contract> await rest.createContract(admin, {name: contractName, source: await importer.combine(contractFilename), args}, options);
    const state = await rest.getState(admin, contract, options);
    const results = await rest.search(admin, {...contract, name: contractName}, {...options, query: {address: `eq.${contract.address}`}});
  });

  it.skip(`Upload simple - from string:`, async() => {
    const uid = util.uid();
    const contractName = 'TitleCA';
    const contractString = getContractString(contractName, 20);

    const args = {_vin: 'Vin_' + uid };
    const contract = <Contract> await rest.createContract(admin, {name: contractName, source: contractString, args}, options);
    const state = await rest.getState(admin, contract, options);
    const results = rest.search(admin, {...contract, name: contractName}, {...options, query: {address: `eq.${contract.address}`}});
  });

  it.skip(`Upload simple - from string: Batch size: ${batchSize}, Batch count ${batchCount}`, async() => {
    const uid = util.uid();
    const contractName = 'TitleCA';
    const contractString = getContractString(contractName, batchSize);
    const args = {_vin: 'Vin_' + uid };

    const startTime = moment();
    for (var i = 0; i < batchCount; i++) {
      console.log(`Batch: ${i}`);
      const contract = <Contract> await rest.createContract(admin, {name: contractName, source: contractString, args}, options);
    }
    const endTime = moment();
    const seconds = endTime.diff(startTime, 'seconds');
    console.log(`Batch count: ${batchCount}  Batch size: ${batchSize}`);
    console.log(`Total:  seconds: ${seconds},  TPS ${batchCount/seconds}, 1 TX: ${seconds/batchCount} seconds `);
  });

  it.skip(`Upload simple - from string: Batch size: ${batchSize}, Batch count ${batchCount}`, async() => {
    const uid = util.uid();
    const contractName = 'TitleCA';
    const contractString = getContractString(contractName, batchSize);

    const startTime = moment();
    const doNotResolve = true;
    const hashes = [];
    for (var i = 0; i < batchCount; i++) {
      console.log(`Batch: ${i}`);
      const args = {_vin: 'Vin_' + uid + '_' + i};
      const hash = await rest.createContract(admin, {name: contractName, source: contractString, args}, {...options, doNotResolve});
      hashes.push(hash);
    }
    // wait for the hashes to resolve
    await waitResults(admin, hashes);
    printTiming(startTime, batchCount, batchSize);
  });

  it(`Upload from string: with NONCE:  Batch size: ${batchSize}, Batch count ${batchCount}`, async() => {
    const uid = util.uid();
    const contractName = 'TitleXXX';
    const contractString = getContractString(contractName, batchSize);

    const startTime = moment();

    console.log({batchSize, batchCount});
    const nonce = await getNonce(admin);
    console.log('Starting nonce', nonce);

    const doNotResolve = true;
    const hashes = [];
    for (var i = 0; i < batchCount; i++) {
      console.log(`Batch: ${i}`);
      const args = {_vin: 'Vin_' + uid + '_' + i};
      const txParams = {nonce: nonce+i};
      const hash = await rest.createContract(admin, {name: contractName, source: contractString, args, txParams}, {...options, doNotResolve});
      hashes.push(hash);
    }
    // wait for the hashes to resolve
    await waitResults(admin, hashes);
    printTiming(startTime, batchCount, batchSize);
  });

  it(`Upload from json array: with NONCE:  Batch size: ${batchSize}, Batch count ${batchCount}`, async() => {
    const uid = util.uid();
    const titlesJsonArray = createTitlesJsonArray(batchSize, batchCount);
    console.log('titlesJsonArray', titlesJsonArray);

    const startTime = moment();

    console.log({batchSize, batchCount});
    const nonce = await getNonce(admin);
    console.log('Starting nonce', nonce);

    const doNotResolve = true;
    const hashes = [];
    for (var i = 0; i < titlesJsonArray.length; i++) {
      console.log(`------------------- Contract: ${i} ---------------------`);
      const titleJson = titlesJsonArray[i];
      const contractName = 'Title_' + uid;
      const contractString = createContractStringFromJson(contractName, titleJson);
      // console.log(contractString);

      const args = {vin: titleJson.vin};
      const txParams = {nonce: nonce+i};
      const hash = await rest.createContract(admin, {name: contractName, source: contractString, args: util.usc(args), txParams}, {...options, doNotResolve});
      hashes.push(hash);
    }
    // wait for the hashes to resolve
    await waitResults(admin, hashes);
    printTiming(startTime, batchCount, batchSize);
  });
});

function createTitlesJsonArray(fields, count) {
  const jsonArray = [];
  for (var i = 0; i < count; i++) {
    const json = {
      vin: `vin_${i}`,
      data: {
        amount: 1000 + i,
        name: '"John Doe"',
      },
    };
    jsonArray.push(json);
  }
  return jsonArray;
}

function getTemplate():string {
  const template = '\n'+
  'contract TitleMT { \n' +
  '  uint public amount; \n'+
  '  string public name; \n'+
  '} \n' +
  'contract _contractName_ is TitleMT{ \n' +
  '  string public vin; \n'+
  '  function _contractName_(string _vin) public { \n'+
  '    vin = _vin; \n'+
  '  } \n'+
  '} \n';
  return template;
}

function createContractStringFromJson(contractName, titlesJson) {
  var template:string = getTemplate();
  template = template.replace(new RegExp('_contractName_', 'g'), contractName);
  for (let field in titlesJson.data) {
    // console.log(field, titlesJson.data[field]);
    template = template.replace(` ${field};`, ` ${field} = ${titlesJson.data[field]};`);
  }
  return template;
}

function printTiming(startTime, batchCount, batchSize) {
  const endTime = moment();
  const seconds = endTime.diff(startTime, 'seconds');
  console.log(`Batch count: ${batchCount}  Batch size: ${batchSize}`);
  console.log(`Total:  seconds: ${seconds},  TPS ${batchCount/seconds}, 1 TX: ${seconds/batchCount} seconds `);
}

async function waitResults(admin, hashes) {
  const getBlockResultPromises = [];
  hashes.map(async hash => {
    const resolve = true;
    const promise = await rest.getBlocResults(admin, hash, options);
    getBlockResultPromises.push(promise);
  });
  const results = await getBlockResultPromises;
  results.map(result => {
    assert.equal(result.status, 'Success', 'no success for ' +result.hash);
  });
}

async function getNonce(admin) {
  const accounts = await rest.getAccounts(admin, {...options, params: {address: admin.address}});
  const nonce = accounts[0].nonce;
  return nonce;
}

async function sleep(milli) {
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      resolve();
    }, milli);
  });
}

function getContractString(contractName:string, count:number) {
  const template = ''+
'contract $contractName$ {'+
'  string public vin;'+
'  $vars$'+
'  function Title(string _vin) public {'+
'    vin = _vin;'+
'  }'+
'}';

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
