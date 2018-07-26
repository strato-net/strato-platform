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
    const args = {_vin: 'Vin_' + uid };
    const contract = yield rest.uploadContractString(admin, contractName, contractString, args);
    const state = yield rest.getState(contract);

    checkResultsFromContractString(state, 1);
  });


  //Helper Functions

  //Creates a contract using a template string
  function getContractString(contractName, count) {
    const template = ''+
      'contract $contractName$ {'+
      '  string public vin;'+
      '  $vars$'+
      '  function Title(string _vin) public {'+
      '    vin = _vin;'+
      '  }'+
      '}';
    const id = count - 1;
    const allVars = [];

    const stringVar = `string public testString = 's${id}'; `
    allVars.push(stringVar);
    const uintVar = `uint public testInt = ${id}; `
    allVars.push(uintVar);
    const boolVar = `bool public testBool = ${(id%2==1)?'false':'true'}; `
    allVars.push(boolVar);
    const addressVar = `address public testAddress = 0x100${id}; `
    allVars.push(addressVar);

    const string = template.replace('$contractName$', contractName).replace('$vars$', allVars.join(' ') );
    return string;
  }

  function checkResultsFromContractString(results, batchCount){
    for(let i = 0; i < batchCount; i++){
      assert.equal(results.testString, `s${i}`, 'Variable \'testString\' matched with expected state');
      assert.equal(results.testInt, `${i}`, 'Variable \'testInt\' matched with expected state');
      assert.equal(results.testAddress, `000000000000000000000000000000000000100${i}`, 'Variable \'testAddress\' matched with expected state');

      const correctBool = (i%2==1)? false : true;
      
      if(correctBool){
        assert.isTrue(results.testBool, correctBool, 'Variable \'testBool\' matched with expected state');
      } else {
        assert.isFalse(results.testBool, correctBool, 'Variable \'testBool\' matched with expected state');
      }
    }
  }

});
