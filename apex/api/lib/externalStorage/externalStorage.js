/* jshint esnext: true */
const ba = require('blockapps-rest');
const rest = ba.rest;
const ax = require(`${process.cwd()}/lib/rest-utils/axios-wrapper`);

const importer = require('./importer');
const util = require('../rest-utils/util');
//const config = require('./config'); //todo - look at using this
const constants = require(`${process.cwd()}/lib/rest-utils/constants`);

const contractName = 'ExternalStorage';
const contractFilename = `./lib/externalStorage/contracts/ExternalStorage.sol`;

function* uploadContract(user, args) {
  //const contract = yield rest.uploadContract(admin, contractName, contractFilename, args);
    console.log('!! upload1 ', contractName, contractFilename,'bb')
  const contract = yield uploadContractInternal(user, contractName, contractFilename, args);
  const isContractCompiled = yield rest.isSearchable(contract.codeHash);
  if (!isContractCompiled) {
    yield compileSearch();
  }

  contract.src = 'removed';
  return setContract(user, contract);
}

function setContract(admin, contract) {
  contract.getState = function* () {
    return yield rest.getState(contract);
  };

  return contract;
}

function* compileSearch() {
  rest.verbose('compileSearch', contractName);
  const searchable = [contractName];
  yield rest.compileSearch(searchable, contractName, contractFilename);
}

// ================== contract methods ====================
function* attest(user, contractAddress, args) {
  rest.verbose('attest', args);
  let contract = {
    name: contractName,
    address: contractAddress
  }
  // function attest(bytes32 _signature) public view returns(bytes32[]) {
  const method = 'attest';
  const result = yield rest.callMethod(user, contract, method, args);
  return result;
}

// ================== wrapper methods ====================
function* getExternalStorage(address) {
  const results = (yield rest.waitQuery(`${contractName}?address=eq.${address}`, 1, 3 * 60 * 1000))[0];
  return results;
}


// =================== internal ====================

function* uploadContractInternal(user, contractName, contractFilename, args, options) {
  // get the source
  const contractSrc = yield getContractString(contractName, contractFilename);
  // upload
  return yield uploadContractString(user, contractName, contractSrc, args, options);
}

/**
 * This function return's the string of the contract belonging to a given user.
 * @method{getContractString}
 * @param{String} name the username
 * @param{String} filename the filename of the contract
 * @returns{()} scope.contracts[name] = {contract : String}
 */
function* getContractString(name, filename) {
  const string = yield importer.getBlob(filename);
  return string;
}

/*contract: function(body, from, address, resolve, chainId, node) {
    const query = chainResolveQuery(chainId, resolve);
    return ax.post('http://localhost/', body, '/users/' + from + '/' + address + '/contract' + query); //todo - return to config.getNodeUrl(node)
}*/

function sendTransactions(body, headers, resolve, chainId, node) {
    const query = chainResolveQuery(chainId, resolve);

    return ax.post(process.env.BLOC_HOST, body, '/bloc/v2.2/transaction' + query, headers,true); //todo - remove hardcode
}

function chainResolveQuery(chainId, resolve) {
    return util.buildQueryParams(
        [ util.toParam(chainId, 'chainid=' + chainId)
            , util.toParam(resolve, 'resolve')
        ]);
}



/**
 * This function uploads a user's contract with args and transaction parameters.
 * @method{uploadContractString}
 * @param{Object} user the user
 * @param{String} contractName name of the contract
 * @param{String} contractSrc src of the contract
 * @param{Object} args initialization args
 * @param{Object} options the optional arguments {doNotResolve: Boolean, txParams: Object, chainId: Number, node: Number, enableHistory: Boolean, enableIndex: Boolean}
 * @returns{()} doNotResolve=true: [transaction hash] (String), doNotResolve=false: [uploaded contract details]
 */
function* uploadContractString(user, contractName, contractSrc, args, options={}) {
    args = args || {};
    const txParams = options.txParams || {};
    const txs = [{
          payload: {
            src: contractSrc,
            contract: contractName,
            args: args,
            metadata: constructMetadata(options, contractName)
          },
          type: 'CONTRACT'
        }];


    //verbose('uploadContractString', {user, contractName, args, options});
console.log(' pre call ')
    let result = yield sendTransactions({
      txs,
      txParams,
    }, user, !options.doNotResolve, options.chainId, options.node)
        .catch(function(e) {
            throw (e instanceof Error) ? e : new HttpError(e);
        });
console.log(' ')
console.log(' &&& THE results are IN! &&& ')
    console.log(result)
console.log('=====================================')
  console.log(' ')
  // When options.doNotResolve=false, expect bloc to only return once transaction has either succeeded or failed.
  // When options.doNotResolve=true, bloc will return the transaction hash immediately, and it is the caller's responsibility to check it.
  if(!options.doNotResolve) {

    const resolvedResults = yield resolveResult(result, options);

    console.log(' ')
    console.log(' your resolution is here! ')
    console.log(resolvedResults)
    console.log('~~~~~~~~~~~~~~~~~~~')
    console.log(' ')

    if(resolvedResults[0].status === constants.FAILURE) {
      throw new HttpError400(resolvedResults[0].txResult.message);
    }

    const address = resolvedResults[0].data.contents.address;

    // validate address
    if (!util.isAddress(address))
      new Error('upload contract should produce a valid address ' + JSON.stringify(address));
    const contract = {name: contractName, src: contractSrc, address: address, codeHash:resolvedResults[0].data.contents.codeHash};
    contract.src = 'removed'; // not really needed

    console.log(' ')
    console.log('returning contract')
    console.log(contract)
    console.log(' ')

    return contract;
  }

  console.log(' ')
  console.log('i once knew a hash')

  return result[0].hash;
}



/**
 * This function constructes metadata that can be used to control the history and index flags
 * @method{constructMetadata}
 * @param{Object} options flags for history and indexing
 * @param{String} contractName
 * @returns{()} metadata
 */
function constructMetadata(options, contractName) {
    const metadata = {};
    if (options === {}) return metadata;

    // history flag (default: off)
    if (options.enableHistory) {
        metadata['history'] = contractName;
    }
    if (options.hasOwnProperty('history')) {
        const newContracts = options['history'].filter(contract => contract !== contractName).join();
        metadata['history'] = `${options['history']},${newContracts}`;
    }

    // index flag (default: on)
    if (options.hasOwnProperty('enableIndex') && !options.enableIndex) {
        metadata['noindex'] = contractName;
    }
    if (options.hasOwnProperty('noindex')) {
        const newContracts = options['noindex'].filter(contract => contract !== contractName).join();
        metadata['noindex'] = `${options['noindex']},${newContracts}`;
    }

    //TODO: construct the "nohistory" and "index" fields for metadata if needed
    // The current implementation only constructs "history" and "noindex"

    return metadata;
}

function* resolveResult(result, options) {
  console.log('resolve Result!')

  return (yield resolveResults([result], options))[0];
}

function* resolveResults(results, options={}) {
  console.log(' ')
  console.log('There must be a resolution')

  options.doNotResolve = true;
  let count = 0;
  let res = results;
  while (count < 60 && res.filter(r => {return r.status === constants.PENDING}).length !== 0) {
    res = yield getBlocResults(res.map(r => {return r.hash}), options);
    yield promiseTimeout(1000);
    count++;
  }
  console.log(' ')
  console.log(' are you resolved ? ')
  if(count >= 60) {
    console.log('no')
    throw new HttpError400('Transaction did not resolve');
  }

  console.log('yes!')
  return res;
}

function *blocResults(hashes, resolve, chainId, node) {
  console.log('blocResults!')
  const query = chainResolveQuery(chainId, resolve);
  return ax.post(process.env.BLOC_HOST, hashes, '/transactions/results' + query);
}
function* getBlocResults(hashes, options={}) {
  console.log('GET blocResults!')

  const result = yield blocResults(hashes, !options.doNotResolve, options.chainId, options.node)
      .catch(function(e) {
        throw (e instanceof Error) ? e : new HttpError(e);
      });
  return result;
}

class HttpError400 extends Error {
  constructor(msg, url) {
    super(`400 Bad Request: ${msg}`);
    this.name = 'HttpError400';
    this.status = 400;
    this.statusText = `Bad Request ${msg}`;
    this.url = url;
  }
}

class HttpError extends Error {
    constructor(e) {
        const data = JSON.stringify(e.data).replace(/\\n/g, '\n').replace(/\\"/g, '"')
        super(`${e.status} ${e.statusText}: ${data}: ${e.config.url}`);
        this.name = 'HttpError';
        this.status = e.status;
        this.statusText = e.statusText;
        this.data = data;
        this.url = e.config.url;
    }
}

module.exports = {
  compileSearch: compileSearch,
  uploadContract: uploadContract,
  attest: attest,
  getExternalStorage: getExternalStorage
};
