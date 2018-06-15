const ba = require('blockapps-rest');
const rest = ba.rest;
const util = ba.common.util;
const config = ba.common.config;
const path = require('path');

const contractName = 'Title';
const contractFilename = path.join(config.contractsPath, "Title.sol");

function* uploadContract(admin, args) {
  const contract = yield rest.uploadContract(admin, contractName, contractFilename, util.usc(args));
  yield compileSearch(contract);
  contract.src = 'removed';
  return bind(admin, contract);
}

/**
 * Expand a contract template using json values, and upload it
 * When nonce provided, does not resolve the transaction and returns a receipt hash
 * When nonce not provided, resolves the transaction
 * @method{uploadTemplate}
 * @param{User} admin the admin username
 * @param{Json} json expansion json object
 * @param{Integer} nonce optional nonce for upload
 * @returns{()} contract or hash
*/
function* uploadTemplate(admin, json, nonce) {
  rest.verbose('uploadTemplate', json);
  const args = {vin: json.vin};
  const templateString = yield rest.getContractString(contractName, contractFilename);
  const contractString = expandTemplate(templateString, json, '//_VARS_');
  // resolve - return contract object
  if (nonce === undefined) {
    return yield uploadTemplateSync(admin, contractString, args)
  }
  // do not resolve - nonce provided - return transaction receipt
  return yield uploadTemplateAsync(admin, contractString, args, nonce)
}

// resolve - return contract object
function* uploadTemplateSync(admin, contractString, args) {
  const contract = yield rest.uploadContractString(admin, contractName, contractString, util.usc(args));
  contract.src = 'removed';
  return bind(admin, contract);
}

// do not resolve - nonce provided - return transaction receipt
function* uploadTemplateAsync(admin, contractString, args, nonce) {
  const doNotResolve = true;
  const txParams = {nonce: nonce};
  const hash = yield rest.uploadContractString(admin, contractName, contractString, util.usc(args), doNotResolve, txParams);
  return hash;
}

// create a title from json, and block until it shows up in search
function* createTitle(admin, json) {
  const contract = yield uploadTemplate(admin, json);
  const searchResult = yield waitForVin(json.vin);
  return searchResult;
}

function bind(admin, contract) {
  contract.getState = function* () {
    return yield rest.getState(contract);
  }
  contract.vin32 = function* () {
    return yield vin32(admin, contract);
  }
  contract.setLienRelease = function* (args) {
    return yield setLienRelease(admin, contract, args);
  }

  contract.addLienHolder = function* (args) {
    return yield addLienHolder(admin, contract, args);
  }

  contract.setTitleDetails = function*(args) {
    return yield setTitleDetails(admin, contract, args);
  };

  return contract;
}

function* compileSearch(contract) {
  rest.verbose('compileSearch', contractName);

  if (yield rest.isSearchable(contract.codeHash)) {
    return;
  }
  const searchable = [contractName];
  yield rest.compileSearch(searchable, contractName, contractFilename);
}

function* setLienRelease(admin, contract, args) {
  rest.verbose('setLienRelease', args);
  // function setLienRelease(string _date, string trackingNumber, string lienholderName ) {
  const method = 'setLienRelease';
  yield rest.callMethod(admin, contract, method, util.usc(args));
}

function* addLienHolder(admin, contract, args) {
  rest.verbose('addLienHolder', args);
  const method = 'addLienHolder';
  yield rest.callMethod(admin, contract, method, util.usc(args));
}

function* setTitleDetails(admin, contract, args) {
  rest.verbose("setTitleDetails", args);
  const method = "setTitleDetails";
  yield rest.callMethod(admin, contract, method, util.usc(args));
}

// curl -i http://localhost/cirrus/search/Title?vin=eq.qwerty123456
function* getByVin(vin) {
  //console.log('titleJs', 'getByVin', vin);
  const result = yield rest.query(`${contractName}?vin=eq.${vin}`);
  return result[0];
}

function* waitForVin(vin) {
  console.log('titleJs', 'waitForVin', vin);
  const result = yield rest.waitQuery(`${contractName}?vin=eq.${vin}`, 1);
  return result[0];
}

//
function* getByAddress(address) {
  console.log('titleJs', 'getByAddress', address);
  const result = yield rest.query(`${contractName}?address=eq.${address}`);
  return result[0];
}

function* waitForAddress(address) {
  //console.log('titleJs', 'waitForAddress', address);
  const result = yield rest.waitQuery(`${contractName}?address=eq.${address}`, 1);
  return result[0];
}

function* getAll() {
  const results = yield rest.query(`${contractName}`);
  return results;
}
//
// function* getTitles(addresses) {
//   const csv = util.toCsv(addresses); // generate csv string
//   const results = yield rest.query(`${contractName}?address=in.${csv}`);
//   return results;
// }
//
// function* setLienRelease(admin, contract, args) {
//   rest.verbose('setLienRelease', args);
//   // function setLienRelease(string _date, string trackingNumber, string lienholderName ) {
//   const method = 'setLienRelease';
//   yield rest.callMethod(admin, contract, method, util.usc(args));
// }

function* vin32(admin, contract) {
  rest.verbose('vin32');
  // function vin32() returns (bytes32)
  const method = 'vin32';
  const result = yield rest.callMethod(admin, contract, method);
  return result[0];
}

function expandTemplate(template, json, hook) {
  // console.log('expandTemplate', {template, json, hook});
  const vars = [];
  // record the source json
  const comment = '/*\n' + JSON.stringify(json, null, 2) + '\n*/';
  vars.push(comment);
  // expand the json variables into the temaplte
  for (variableName in json) {
    // console.log('populating', variableName, json[variableName], typeof json[variableName]);
    if (template.indexOf(variableName) <= 0) {
      console.log('400 not found', variableName, json[variableName], typeof json[variableName]);
      throw new Error('400, Bad Request, variable name not found: ' + variableName);
    }
    if (json[variableName] === null) {
      continue;
    }
    let line;
    switch(typeof json[variableName]) {
      case 'string' :
        line = `  ${variableName} = "${json[variableName]}";`;
        break;
      case 'number' :
        line = `  ${variableName} = ${json[variableName]};`;
        break;
      default:
        console.log('expandTemplate: Error 400: unknown type for:', variableName, json[variableName], typeof json[variableName]);
        throw new Error('400, Bad Request, variable type NIY: ' + typeof json[variableName]);
    }
    vars.push(line);
  }
  const combined = vars.join('\n');
  const populated = template.replace(hook, combined);
  //console.log('populated', populated);
  return populated;
}

module.exports = {
  uploadContract: uploadContract,
  uploadTemplate: uploadTemplate,
  getByVin: getByVin,
  getAll: getAll,
  // getTitles: getTitles,
  getByAddress: getByAddress,
  waitForVin: waitForVin,
  waitForAddress: waitForAddress,
  compileSearch: compileSearch,
  contractName: contractName,
  expandTemplate: expandTemplate,
  createTitle: createTitle,
};
