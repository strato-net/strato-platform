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

const contractName = 'Vehicle';
const contractFilename = path.join(config.contractsPath, "Vehicle.sol");

describe('Unique addresses', function () {
  this.timeout(60 * 1000);

  let admin;
  const batchSize = util.getArgInt('--batchSize', 1);

  before(function * () {
    console.log(`Creating admin user and contract`);
    admin = yield rest.createUser(adminName, adminPassword);
    yield rest.compileSearch([contractName], contractName, contractFilename);
  });

  it('should upload a list of contracts and receive a list of unique addresses', function * () {
    const txs = factory_createUploadList(batchSize);

    const doNotResolve = true;
    const uploadReceipts = yield rest_uploadContractList(admin, txs, doNotResolve);
    // wait for the hashes to resolve
    const uploadResults = yield waitResults(uploadReceipts);
    const uploadAddresses = [];

    for (let result of uploadResults.data) {
      let found = false;
      for (address of uploadAddresses) {
        if (result.address == address) {
          found = true;
          break;
        }
      }

      if (!found) {
        uploadAddresses.push(result.address);
      }
    }

    assert.equal(uploadResults.data.length, uploadAddresses.length, "There were duplicate addresses found");
  });
});

function factory_createUploadList(batchSize) {
  const txs = [];
  for (var i = 0; i < batchSize; i++) {
    // function Vehicle(string _vin, string _s0, string _s1, string _s2, string _s3) public
    txs.push({
      contractName: contractName,
      args: {
        _vin: `vin_${i}`,
        _s0: `s0_${i}`,
        _s1: `s1_${i}`,
        _s2: `s2_${i}`,
        _s3: `s3_${i}`,
      },
    });
  }
  return txs;
}


function* waitResults(uploadReceipts) {
  // create a promise for each hash - process in parallel
  // WARNING - NodeJS might break on too many promises in parallel
  console.log('Resolving Upload receipts');
  const hashes = uploadReceipts.map((r) => {return r.hash;});
  const txResults = yield resolveTxs(hashes);
  console.log('Resolved Upload receipts');
  //console.log('txResults', txResults); // process.exit();
  const errors = [];
  const data = [];
  // FIXME these might not be ordered anymore
  for (var i = 0 ; i < txResults.length; i++) {
    const txResult = txResults[i];
    const uploadReceipt = uploadReceipts[i];
    console.log(i, txResult.status);
    if (txResult.status == 'Success') {
      data.push({index:i, uploadReceipt: uploadReceipt, address: txResult.data.contents.address});
    } else {
      errors.push({index:i, uploadReceipt: uploadReceipt, txResult:txResult});
    }
  }
  console.log('### Data:', data.length);
  console.log('### Errors:', errors.length);
  return {errors: errors, data: data};
}

function*  rest_uploadContractList(user, txs, doNotResolve, node){
  const resolve = doNotResolve ? false : true;
  //verbose('uploadContractList', {user, txs, resolve, node})
  const results = yield api.bloc.uploadList({
      password: user.password,
      contracts: txs,
      resolve: resolve
    }, user.name, user.address, resolve, node)
    .catch(function(e) {
      throw (e instanceof Error) ? e : new HttpError(e);
    });

  if(resolve) {
    results.map(function(result){
      if(result.status === constants.FAILURE) {
        throw new HttpError400(result.txResult.msg);
      }
    });
    return results.map(function(r){return r.data.contents;});
  }
  return results;
}

function promiseTimeout(timeout) {
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      resolve();
    }, timeout);
  });
}

function * resolveTxs(hashes) {
  const resolve = true;
  const txResults = yield api.bloc.results(hashes, resolve).catch(function(err) {
        return {status: err.status};
      });
  return txResults;
}
