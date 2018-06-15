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

const contractName = 'Vehicle_Packed';
const contractFilename = path.join(config.contractsPath,`Vehicle_Packed.sol`);

describe('Throughput - upload', function () {
  this.timeout(999999 * 1000);

  let admin;
  const batchSize = util.getArgInt('--batchSize', 1);
  const batchCount = util.getArgInt('--batchCount', 1);
  const search = util.getArgInt('--search', 0);
  let batchIndex = 0;

  before(function * () {
    console.log(`Creating admin user and contract`);
    admin = yield rest.createUser(adminName, adminPassword);
    yield rest.compileSearch([contractName], contractName, contractFilename);
  });

  for(var index = 0; index < batchCount; index++) {
    it('Upload List', function * () {
      const txs = factory_createUploadList(batchSize, batchIndex);

      const startTime = moment();
      const doNotResolve = true;
      const uploadReceipts = yield rest_uploadContractList(admin, txs, doNotResolve);
      // wait for the hashes to resolve
      const uploadResults = yield waitResults(uploadReceipts);
      for(let r of zip(txs, uploadResults.data)) {
        const state = yield api.bloc.state(r.fst.contractName, r.snd.address);
        const _x = `${state.vin};${state.vehicleType};${state.vehicleYear}`;
        const _y = `${state.vehicleMake};${state.vehicleModel};${state.vehicleStyle}`;
        
        assert.equal(_x, r.fst.args.x, "Contract x is not correct");
        assert.equal(_y, r.fst.args.y, "Contract y is not correct");
      }

      // stop the clock, print timing
      printTiming(startTime, batchCount, batchSize, index);
      batchIndex++ ; // batch is done

      if (search != 0) {
        const addresses = uploadResults.data.map(r => {return r.address} );
        const csv = util.toCsv(addresses); // generate csv string
        const searchResult = yield rest.query(`${contractName}?address=in.${csv}`);
        console.log(JSON.stringify(searchResult, null, 2));
      }
    });
  }
});

function zip(a,b) {
  const c = [];
  var i = 0;
  while(i < a.length && i < b.length) {
    c.push({fst: a[i], snd: b[i]});
    i++;
  }
  return c;
}

function factory_createUploadList(batchSize, batchIndex) {
  const txs = [];
  for (var i = 0; i < batchSize; i++) {
    // function Vehicle(string _vin, string _s0, string _s1, string _s2, string _s3) public
    txs.push({
      contractName: contractName,
      args: {
        x: `vin_${batchIndex}_${i};s0_${batchIndex}_${i};s2_${batchIndex}_${i}`,
        y: `van_${batchIndex}_${i};s1_${batchIndex}_${i};s3_${batchIndex}_${i}`
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

function* setData(admin, uploadResults, batchIndex) {
  const nonce = yield getNonce(admin);
  const setDataTxs = yield createSetDataTxs(nonce, uploadResults, batchIndex);
  const doNotResolve = true;
  const receipts = yield rest.callList(admin, setDataTxs, doNotResolve);
  console.log('### Receipts:', receipts);
  const results = yield resolveTxs(receipts);
  const data = [], errors = [];
  for (var i = 0; i < results.length; i++) {
    const uploadResult = uploadResults[i % uploadResults.length];
    data.push({index:i, uploadResult: uploadResult, address: uploadResult.address});
  }
  return {data: data, errors: errors};
}

function* createSetDataTxs(nonceStart, uploadResults, batchIndex) {
  const txs = uploadResults.map((uploadResult, i) => {
    return {
      'contractName': contractName,
      'contractAddress': uploadResult.address,
      'methodName': 'set',
      'value': 0,
      'args': {
        _s4: `s4_${batchIndex}_${i}`,
        _s5: `s5_${batchIndex}_${i}`,
        _s6: `s6_${batchIndex}_${i}`,
        _s7: `s7_${batchIndex}_${i}`,
      },
      'txParams': { nonce: nonceStart++ },
    }
  });
  const txs2 = uploadResults.map((uploadResult, i) => {
    return {
      'contractName': contractName,
      'contractAddress': uploadResult.address,
      'methodName': 'set',
      'value': 0,
      'args': {
        _s4: `s4_${batchIndex}_${i}`,
        _s5: `s5_${batchIndex}_${i}`,
        _s6: `s6_${batchIndex}_${i}`,
        _s7: `s7_${batchIndex}_${i}`,
      },
      'txParams': { nonce: nonceStart++ },
    }
  });
  return txs.concat(txs2);
}
//
// function* createSetDataTxs(nonceStart, uploadResults) {
//   const txs = [];
//   for (var i = 0; i < uploadResults.length; i++) {
//     const uploadResults
//     const tx = {
//       'contractName': contractName,
//       'contractAddress': uploadResult.address,
//       'methodName': 'set',
//       'value': 0,
//       'args': {
//         _s4: 's4_' + i,
//         _s5: 's5_' + i,
//         _s6: 's6_' + i,
//         _s7: 's7_' + i,
//       },
//       'txParams': { nonce: nonceStart++ },
//     };
//     txs.push(tx);
//   }
//   return txs;
// }



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

function* getNonce(admin) {
  const accounts = yield rest.getAccount(admin.address);
  const nonce = accounts[0].nonce;
  console.log('Nonce:', nonce);
  return nonce;
}

function printTiming(startTime, batchCount, batchSize, loopIndex) {
  const endTime = moment();
  const seconds = endTime.diff(startTime, 'seconds');
  console.log(`Loop index: ${loopIndex}  Batch count: ${batchCount}  Batch size: ${batchSize}`);
  console.log(`Total:  seconds: ${seconds},  TPS ${batchSize/seconds}, 1 TX: ${seconds/batchSize} seconds `);
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
