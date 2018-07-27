const ba = require('blockapps-rest');
const co = require('co');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const config = common.config;
const util = common.util;
const assert = common.assert;
const nodes = config.nodes;
const constants = common.constants;

const adminName = util.uid('Admin');
const adminPassword = '1234';

describe("\'contract metadata (parsed via API)-> Bloc -> Postgres\' flow test", function() {
  this.timeout(999999 * 1000);

  let admin;
  const batchCount = util.getArgInt('--batchCount', 10);

  before(function * () {
    console.log(`Creating admin user`);
    admin = yield rest.createUser(adminName, adminPassword);
    console.log(admin);
  });

  it('should upload — from string — ONE contract and should verify that all fields of metadata is correct', function* () {
    const uid = util.uid();
    const contractName = 'TitleCA';
    const contractString = getContractString(contractName, 1);

    const args = {_vin: 'Vin_' + uid };
    const contract = yield rest.uploadContractString(admin, contractName, contractString, args);
    yield rest.callMethod(admin, contract, "Title", args);
    const state = yield rest.getState(contract);
    const name = yield rest.callMethod(admin, contract, "__getContractName__");

    checkResultsFromContractString(state, 1, name, contractName, args._vin);
  });

  it(`should upload — from string — multiple contracts and should verify that all fields of each contract\'s metadata is correct - Batch count: ${batchCount}`, function* () {
    const uid = util.uid();
    const contractName = 'TitleCA';

    for(let i = 1; i <= batchCount; i++){
      console.log(`------------------- Contract: ${i} ---------------------`);
      const contractString = getContractString(contractName, i);

      const args = {_vin: 'Vin_' + uid };
      const contract = yield rest.uploadContractString(admin, contractName, contractString, args);
      yield rest.callMethod(admin, contract, "Title", args);
      const state = yield rest.getState(contract);
      const name = yield rest.callMethod(admin, contract, "__getContractName__");

      checkResultsFromContractString(state, i, name, contractName, args._vin);
    }
  });

  it(`should upload — from json array — multiple contracts and should verify that all fields of each contract\'s metadata is correct - Batch count: ${batchCount}`, function* () {
    const uid = util.uid();
    const titlesJsonArray = createTitlesJsonArray(batchCount);
    console.log('titlesJsonArray', titlesJsonArray);

    for(let i = 0; i < batchCount; i++){
      console.log(`------------------- Contract: ${i+1} ---------------------`);
      const titleJson = titlesJsonArray[i];
      const contractName = 'Title_' + uid;
      const contractString = createContractStringFromJson(contractName, titleJson);

      const args = {_vin: titleJson.vin};
      const contract = yield rest.uploadContractString(admin, contractName, contractString, args);
      yield rest.callMethod(admin, contract, "Title", args);
      const state = yield rest.getState(contract);
      const name = yield rest.callMethod(admin, contract, "__getContractName__");

      checkResultsFromContractJson(state, titleJson, name, contractName, args._vin);
    }

  });

  /****************
  *Helper Functions*
   ****************/

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

    const stringVar = `string public testString = 's${count}'; `
    allVars.push(stringVar);
    const uintVar = `uint public testInt = ${count}; `
    allVars.push(uintVar);
    const boolVar = `bool public testBool = ${(count%2==1)?'false':'true'}; `
    allVars.push(boolVar);
    const addressVar = `address public testAddress = 0x100${count}; `
    allVars.push(addressVar);

    const string = template.replace('$contractName$', contractName).replace('$vars$', allVars.join(' ') );
    return string;
  }

  function createTitlesJsonArray(count) {
    const jsonArray = [];
    for (var i = 1; i <= count; i++) {
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

  function createContractStringFromJson(contractName, titlesJson) {
    const template = '\n'+
    'contract TitleMT { \n' +
    '  $vars$ \n'+
    '} \n' +
    'contract _contractName_ is TitleMT{ \n' +
    '  string public vin; \n'+
    '  function Title(string _vin) public { \n'+
    '    vin = _vin; \n'+
    '  } \n'+
    '} \n';

    const allVars = [];
    const amount = `uint public amount = ${titlesJson.data.amount};`;
    allVars.push(amount);
    const name = `string public name = ${titlesJson.data.name};`;
    allVars.push(name);

    const string = template.replace(new RegExp('_contractName_', 'g'), contractName).replace('$vars$', allVars.join(' '));
    return string;
  }

  function checkResultsFromContractString(results, count, contractName, expectedName, expectedVin){
    assert.equal(results.testString, `s${count}`, 'Variable \'testString\' matched with expected state');
    assert.equal(results.testInt, `${count}`, 'Variable \'testInt\' matched with expected state');
    let expectedAddress = parseInt(`0x100${count}`);
    let contractAddress = parseInt(results.testAddress, 16);
    assert.equal(contractAddress, expectedAddress, 'Variable \'testAddress\' matched with expected state');

    assert.equal(contractName, expectedName, 'The contract\'s name matches the expected name');
    assert.equal(results.vin, expectedVin, 'Variable \'vin\' matched with the expected state');
    const correctBool = (count%2==1)? false : true;

    if(correctBool){
      assert.isTrue(results.testBool, correctBool, 'Variable \'testBool\' matched with expected state');
    } else {
      assert.isFalse(results.testBool, correctBool, 'Variable \'testBool\' matched with expected state');
    }
  }

  function checkResultsFromContractJson(results, titleJson, contractName, expectedContractName, expectedVin){
    const expectedName = titleJson.data.name.replace('"','').replace('"','');
    assert.equal(results.amount, titleJson.data.amount, 'Variable \'amount\' matched with expected state');
    assert.equal(results.name, expectedName, 'Variable \'name\' matched with expected state');

    assert.equal(contractName, expectedContractName, 'The contract\'s name matches the expected name');
    assert.equal(results.vin, expectedVin, 'Variable \'vin\' matched with the expected state');
  }

});
