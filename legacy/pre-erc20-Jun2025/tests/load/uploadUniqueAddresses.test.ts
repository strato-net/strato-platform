import * as path from "path";

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
  ContractDefinition,
  importer
  } from 'blockapps-rest';

import BigNumber from "bignumber.js";
import * as chai from "chai";
chai.should();
chai.use(require('chai-bignumber')());

let config:Config=fsUtil.getYaml("config.yaml");
let options:Options={config}

const contractName = 'Vehicle';
const contractFilename = path.join(config.contractsPath, "Vehicle.sol");

describe('Unique addresses', function () {
  this.timeout(60 * 1000);

  let admin;
  const batchSize = util.getArgInt('--batchSize', 1);

  before(async() => {
    console.log(`Creating admin user and contract`);
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    const ouser = await oauth.getAccessTokenByResourceOwnerCredential("user3", "1234", "strato-devel");
    admin = await rest.createUser(ouser, options);
//    await rest.createContract(admin, {name: contractName, source: await importer.combine(contractFilename), args: {}}, options);
  });

  it('should upload a list of contracts and receive a list of unique addresses', async() => {
    const txs = await factory_createUploadList(batchSize);

    const doNotResolve = true;
    const uploadReceipts = await rest_uploadContractList(admin, txs, doNotResolve);
    // wait for the hashes to resolve
    const uploadResults = await waitResults(admin, uploadReceipts);
    const uploadAddresses = [];

    for (let result of uploadResults.data) {
      let found = false;
      for (let address of uploadAddresses) {
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

async function factory_createUploadList(batchSize) {
  const txs:ContractDefinition[] = [];
  for (var i = 0; i < batchSize; i++) {
    // function Vehicle(string _vin, string _s0, string _s1, string _s2, string _s3) public
    txs.push({
      name: contractName,
      source: await importer.combine(contractFilename),
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


async function waitResults(admin, uploadReceipts) {
  // create a promise for each hash - process in parallel
  // WARNING - NodeJS might break on too many promises in parallel
  console.log('Resolving Upload receipts');
  const hashes = uploadReceipts.map((r) => {return r.hash;});
  const txResults = await resolveTxs(admin, hashes);
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

async function  rest_uploadContractList(user, txs, doNotResolve, node?){
  const resolve = doNotResolve ? false : true;
  //verbose('uploadContractList', {user, txs, resolve, node})
  const results = await rest.createContractList(user, txs, {...options, config: {...options.config, VM: "SolidVM"}});
//    .catch(function(e) {
//      throw (e instanceof Error) ? e : new HttpError(e);
//    });

  if(resolve) {
    results.map(function(result){
      if(result.status === constants.TxResultStatus.FAILURE) {
        throw result.txResult.msg; // new HttpError400(result.txResult.msg);
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

async function resolveTxs(user, hashes:string[]) {
  const resolve = true;
  const txResults = await rest.getBlocResults(user, hashes, options).catch(function(err) {
        return {status: err.status};
      });
  return txResults;
}
