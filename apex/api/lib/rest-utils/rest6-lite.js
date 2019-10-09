const BigNumber = require('bignumber.js');

const ax = require(`${process.cwd()}/lib/rest-utils/axios-wrapper`);
const constants = require(`${process.cwd()}/lib/rest-utils/constants`);
const importer = require(`${process.cwd()}/lib/externalStorage/importer`);
const util = require(`${process.cwd()}/lib/rest-utils/util`);

function* uploadContract(user, contractName, contractFilename, args, options) {
  // get the source
  const contractSrc = yield getContractString(contractName, contractFilename);
  // upload
  return yield uploadContractString(user, contractName, contractSrc, args, options);
}


function* waitQuery(queryString, count, timeoutMilli, node) {
  if (count <= 0 ) throw new Error('waitQuery: illegal count');
  const predicate = function(results) {
    // abort if exceeded the count - unexpected records exist
    if (results.length > count) {
      throw new Error(`waitQuery: query results count ${results.length} exceed expected count ${count}`);
    }
    // count reached - done
    if (results.length == count) {
      return true;
    }
    // count not reached - sleep
    return false;
  }

  const res = yield queryUntil(queryString, predicate, timeoutMilli, node);
  return res;
}


function* compileSearch(searchableArray, contractName, contractFilename, node) {
  // get the contract string
  const source = yield getContractString(contractName, contractFilename);
  const compileList = [{
    searchable: searchableArray,
    contractName: contractName,
    source: source,
  }];
  // compile
  const compileResults = yield compile(compileList, node);
  // test if all compiled
  const compiledContractNames = compileResults.map(function(compiledContract) {
    return compiledContract.contractName;
  });
  const notFound = searchableArray.filter(function(searchable) {
    return compiledContractNames.indexOf(searchable) == -1;
  });
  // throw - if found any items in the searchable list, that are not included in the compile list results
  if (notFound.length > 0)
    throw new Error('some searchables were not compiled ' + JSON.stringify(notFound, null, 2));
  // all cool
  return compileResults;
}

function* callMethodOAuth(userHeaders, contract, methodName, args, options={}) {
  return yield callOAuth(userHeaders, contract, methodName, args, options);
}

function* getState(contract, options={}) {
  return yield state(contract.name, contract.address, options.chainId, options.node)
      .catch(function(e) {
        throw (e instanceof Error) ? e : new HttpError(e);
      });
}

function* isSearchable(codeHash) {
  // Everything is searchable as of now. Doing this to maintain backward compatibility.
  //fixme - hm, will anything be not-searchable in the future? - investigate
  return true;
  // const results = yield query(`contract?codeHash=eq.${codeHash}`);
  // return (results.length > 0);
}

//=======================
// Helper Functions
//=======================


function compile (body, node) {
  return ax.post(process.env.blocHttpHost, body, '/bloc/v2.2/contracts/compile');
}

function query(query, node) {
  return ax.get(process.env.postgrestHttpHost, `/${query}`);
}

function sendTransactions(body, headers, resolve, chainId, node) {
  const query = chainResolveQuery(chainId, resolve);

  return ax.post(process.env.blocHttpHost, body, '/bloc/v2.2/transaction' + query, headers,true);
}


function state(name, address, chainId, node) {
  const query = util.buildParam(chainId, "chainid=" + chainId);
  return ax.get(process.env.blocHttpHost, '/bloc/v2.2/contracts/' + name + '/' + address + '/state' + query);
}

/**
 * This function compiles a list of contracts
 * @method{compileList}
 * @param{[Object]} compileList list of objects of type {searchable: [String], contractName: String, source: String}
 * @param{Number} node target node
 * @returns{()} scope.compile = scope.compile.push(result-of-compilation)
 */

function* compile(compileList, node) {
  verbose('compile', {compileList, node});
  const result = yield compile(compileList, node)
      .catch(function(e) {
        throw (e instanceof Error) ? e : new HttpError(e);
      });
  return result;
}

/**
 * This function calls a method from a users contract with given args for OAuth flow.
 * @method{callOAuth}
 * @param{String} token the contract owner's token
 * @param{String} contract the target contract
 * @param{String} methodName the target method
 * @param{Object} args the arguments to be supplied to the targer method
 * @param{Object} options the optional arguments {value: Number, doNotResolve: Boolean, chainId: Number, node: Number, enableHistory: Boolean, enableIndex: Boolean}
 * @returns{()} doNotResolve=true: [transaction hash] (String), doNotResolve=false: [method call return vals] (String|Int)
 */
function* callOAuth(userHeaders, contract, methodName, args, options={}) {
  args = args || {};
  const value = options.value || 0;
  const valueFixed = (value instanceof BigNumber) ? value.toFixed(0) : value;

  const txs = [{
    payload: {
      contractName: contract['name'],
      contractAddress: contract['address'],
      value: valueFixed,
      method: methodName,
      args: args,
      metadata: constructMetadata(options, contract['name'])
    },
    type: 'FUNCTION'
  }];

  const result = yield sendTransactions({
    txs: txs,
  }, userHeaders, !options.doNotResolve, options.chainId, options.node)
      .catch(function(e) {
        throw (e instanceof Error) ? e : new HttpError(e);
      });

  // When options.doNotResolve=false, expect bloc to only return once transaction has either succeeded or failed.
  // When options.doNotResolve=true, bloc will return the transaction hash immediately, and it is the caller's responsibility to check it.
  if(!options.doNotResolve) {

    const resolvedResults = yield resolveResult(result, options);

    if(resolvedResults[0].status === constants.FAILURE) {
      throw new HttpError400(result[0].txResult.message);
    }
    return result[0].data.contents;
  }
  return result[0].hash;
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
function* uploadContractString(userHeaders, contractName, contractSrc, args, options={}) {
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


  let result = yield sendTransactions({
    txs,
    txParams,
  }, userHeaders, !options.doNotResolve, options.chainId, options.node)
      .catch(function(e) {
        throw (e instanceof Error) ? e : new HttpError(e);
      });

  // When options.doNotResolve=false, expect bloc to only return once transaction has either succeeded or failed.
  // When options.doNotResolve=true, bloc will return the transaction hash immediately, and it is the caller's responsibility to check it.
  if(!options.doNotResolve) {

    const resolvedResults = yield resolveResult(result, options);

    if(resolvedResults[0].status === constants.FAILURE) {
      throw new HttpError400(resolvedResults[0].txResult.message);
    }

    const address = resolvedResults[0].data.contents.address;

    // validate address
    if (!util.isAddress(address)){
      new Error('upload contract should produce a valid address ' + JSON.stringify(address));
    }
    
    const contract = {name: contractName, src: contractSrc, address: address, codeHash:resolvedResults[0].data.contents.codeHash};
    contract.src = 'removed'; // not really needed

    return contract;
  }
  
  return result[0].hash;
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

function* resolveResult(result, options) {
  return (yield resolveResults([result], options))[0];
}

function* resolveResults(results, options={}) {
  options.doNotResolve = true;
  
  let count = 0;
  let res = results;
  
  while (count < 60 && res.filter(r => {return r.status === constants.PENDING}).length !== 0) {
    res = yield getBlocResults(res.map(r => {return r.hash}), options);
    yield promiseTimeout(1000);
    count++;
  }
  
  if(count >= 60) {
    throw new HttpError400('Transaction did not resolve');
  }

  return res;
}
function *blocResults(hashes, resolve, chainId, node) {
  const query = chainResolveQuery(chainId, resolve);
  return ax.post(process.env.blocHttpHost, hashes, '/bloc/v2.2/transactions/results' + query);
}


function* getBlocResults(hashes, options={}) {
  const result = yield blocResults(hashes, !options.doNotResolve, options.chainId, options.node)
      .catch(function(e) {
        throw (e instanceof Error) ? e : new HttpError(e);
      });
  return result;
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

function* queryUntil(queryString, predicate, timeoutMilli, node) {
  if (queryString === undefined) throw new Error('queryUntil: queryString undefined');
  const action = function*(n) {
    let res;
    try {
      res = yield query(queryString, n);
    }
    catch(e) {
      // 404 is an acceptable response, since the table may not yet exist
      if(!e.status || e.status != 404) {
        throw e;
      }
      res = [];
    }
    return res;
  }

  const res = yield until(predicate, action, timeoutMilli, node);
  return res;
}

function* until(predicate, action, timeoutMilli, node) {
  if (timeoutMilli === undefined) timeoutMilli = 60*1000;
  const phi = 1.618;
  let dt = 100;
  let totalSleep = 0;
  while (totalSleep < timeoutMilli) {
    const result = yield action(node);

    if (predicate(result)) {
      return result;
    } else {
      yield promiseTimeout(dt);
      totalSleep += dt;
      dt *= phi;
    }
  }
  // retries exceeded - timeout
  throw new Error(`until: timeout ${timeoutMilli}ms exceeded`);
}

function promiseTimeout(timeout) {
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      resolve();
    }, timeout);
  });
}

function chainResolveQuery(chainId, resolve) {
  return util.buildQueryParams(
      [ util.toParam(chainId, 'chainid=' + chainId)
        , util.toParam(resolve, 'resolve')
      ]);
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

//=======================
// END Helper Functions
//=======================


module.exports = {
  callMethodOAuth,
  compileSearch,
  getState,
  isSearchable,
  uploadContract,
  waitQuery,
  query,
}
