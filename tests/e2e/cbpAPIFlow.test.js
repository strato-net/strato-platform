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

const adminName = util.uid('Admin');
const adminPassword = '1234';

describe("\'contract metadata (parsed via API)-> Bloc -> Postgres\' flow test", function() {

  let admin;

  before(function * () {
  console.log(`Creating admin user`);
  admin = yield rest.createUser(adminName, adminPassword);
  console.log(admin);
  });

  it('should upload ONE contract and should verify that all fields of metadata is correct', function* () {
    const uid = util.uid();
    const contractName = 'TitleCA';
    const contractString = getContractString(contractName, 1);
    console.log('Here is the contractString', contractString);

    const args = {_vin: 'Vin_' + uid };
    const contract = yield rest.uploadContractString(admin, contractName, contractString, args);
    const state = yield rest.getState(contract);
    const results = yield rest.query(`${contractName}?address=eq.${contract.address}`);
    console.log('Here are the results', results);
  });

  function getContractString(contractName, count) {
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

});
