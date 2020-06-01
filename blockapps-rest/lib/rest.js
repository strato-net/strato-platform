import { BigNumber } from "bignumber.js";
import RestStatus from "http-status-codes";
import api from "./api";
import { TxResultStatus } from "./constants";
import util from "./util/util";
import { constructMetadata, setAuthHeaders } from "./util/api.util";
import { RestError, response } from "./util/rest.util";
import jwt from "jsonwebtoken";

/**
 * This is the main blockapps-rest interface.
 * @module rest
 */

/**
 * @typedef {Object} User This identifies a user
 * @property {String} token This is the OAuth JWT corresponding to this user. STRATO uses the JWT to identify the user and unlock the user's private key to sign transactions. The token must be present in most cases.
 * @property {String} address This is the address corresponding to the user's private key. This is an optional parameter.
 */

/**
 * @typedef {Object} OAuthConfig This object describes the oauth configuration of a STRATO node
 * @property {String} appTokenCookieName Specifies the HTTP only cookie name. Used to identify authentication cookie if cookies are used instead of headers
 * @property {String} scope Identifies OAuth scope
 * @property {Number} appTokenCookieMaxAge Used to set auth cookie expiration
 * @property {String} clientId OAuth client id for client credential and auth code grant flows
 * @property {String} clientSecret OAuth client secret corresponding to the clientId
 * @property {String} openIdDiscoveryUrl Discovery url for OAuth
 * @property {String} redirectUri OAuth callback url for auth code grant flow
 * @property {String} logoutRedirectUri Redirect URI to redirect user after a successful logout
 */

/**
 * @typedef {Object} Node This identifies a STRATO node and contains OAuth discovery urls to authenticate to this node.
 * @property {Number} id Node identifier
 * @property {String} url The base url of the node of the form `{PROTOCOL}://{HOST}:{PORT}`
 * @property {String} publicKey This is the public key of the node. Used to verify the identify of the node.
 * @property {Number} port This is the port number of the STRATO process on this node. Usually equals `30303`
 * @property {module:rest~OAuthConfig} oauth This describes the oauth configuration of a STRATO node
 *
 */

/**
 * @typedef {Object} Config This contains node configuration information
 * @property {String} VM This identifies the type of VM to use. It must equal one of `EVM` or `SolidVM`
 * @property {Boolean} apiDebug This flag enables debug output to be sent to the logger
 * @property {module:rest~Node[]} nodes This contains a collection of STRATO nodes which are being used. It must have atleast one member
 * @property {Number} timeout Length of time to wait before giving up on a request in milliseconds
 */

/**
 * @typedef {Object} Options This object defines options, configurations and metadata for the STRATO node
 * @property {Config} config This contains node identifiers, configuration and metadata options for this call.
 * @property {Object} logger This is a logger interface. It uses the `console` by default but can be set to custom logger like winston.
 * @property {Object} headers This allows adding custom HTTP headers for requests to STRATO
 * @property {Object} query This allows adding custom HTTP query params to requests. Useful for searching contracts
 * @property {String[]} history This allows us to specify contract names for which to track history when uploading smart contract source code
 * @property {String[]} noindex This allows us to specify contract names for which to skip relational indexing when uploading smart contract source code
 */

/**
 * @typedef {Object} Account This object defines a STRATO account
 * @property {String} kind Account type
 * @property {String} balance Eth balance in wei
 * @property {String} address Account address
 * @property {Number} latestBlockNum Last block number in which the state for this account was changed
 * @property {String} codeHash Code hash. Relevant if this is a contract account
 * @property {Number} nonce: Account nonce
 */

// =====================================================================
//   util
// =====================================================================

function isTxSuccess(txResult) {
  return txResult.status === TxResultStatus.SUCCESS;
}

function isTxFailure(txResult) {
  return txResult.status === TxResultStatus.FAILURE;
}

function assertTxResult(txResult) {
  if (isTxFailure(txResult)) {
    throw new RestError(
      RestStatus.BAD_REQUEST,
      txResult.txResult.message,
      txResult.txResult
    );
  }
  return txResult;
}

function assertTxResultList(txResultList) {
  txResultList.forEach((txResult, index) => {
    if (isTxFailure(txResult)) {
      throw new RestError(
        RestStatus.BAD_REQUEST,
        `tx:${index}, message:${txResult.txResult.message}`,
        { index, txResult: txResult.txResult }
      );
    }
  });
  return txResultList;
}

async function resolveResult(user, pendingTxResult, options) {
  return (await resolveResults(user, [pendingTxResult], options))[0];
}

async function resolveResults(user, pendingResults, _options = {}) {
  const options = Object.assign({ isAsync: true }, _options);

  // wait until there are no more PENDING results
  const predicate = results =>
    results.filter(r => r.status === TxResultStatus.PENDING).length === 0;
  const action = async () =>
    getBlocResults(
      user,
      pendingResults.map(r => r.hash),
      options
    );
  const resolvedResults = await util.until(predicate, action, options);
  return resolvedResults;
}

// =====================================================================
//   account details
// =====================================================================
/**
 * This function returns the state of STRATO accounts on the STRATO node identified by `options.config.nodes` and matching the query property `options.query`.
 * @example
 * var accounts = await rest.getAccounts(user, {...options, query: {address: user.address}})
 *
 * // returns a list of one account corresponding to the users' address
 * // [ { contractRoot:'56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
 * //     next: '/eth/v1.2/account?address=25eaa2879018122d7ba25fe4d9701ac367c44bf5&index=5',
 * //     kind: 'AddressStateRef',
 * //     balance: '2000000000000000000000',
 * //     address: '25eaa2879018122d7ba25fe4d9701ac367c44bf5',
 * //     latestBlockNum: 1,
 * //     codeHash:'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
 * //     code: '',
 * //     nonce: 0 } ]
 * @param {module:rest~User} user This identifies the user performing the query and contains the authentication token for the API call
 * @param {module:rest~Options} options This identifies the options and configurations for this call
 * @returns {module:rest~Account[]} A list of account details
 */
async function getAccounts(user, options) {
  try {
    return await api.getAccounts(user, { ...options, isAsync: true });
  } catch (err) {
    throw new RestError(
      RestStatus.BAD_REQUEST,
      err.response.statusText,
      err.response.data
    );
  }
}

// =====================================================================
//   user
// =====================================================================

async function createUser(args, options) {
  const address = await createOrGetKey(args, options);
  const user = Object.assign({}, args, { address });
  return user;
}

async function fill(user, options) {
  const txResult = await api.fill(user, options);
  return assertTxResult(txResult);
}

// =====================================================================
//   compile contracts
// =====================================================================

async function compileContracts(user, contract, options) {
  try {
    return await api.compileContracts(user, contract, options);
  } catch (err) {
    throw new RestError(
      RestStatus.BAD_REQUEST,
      err.response.statusText,
      err.response.data
    );
  }
}

// =====================================================================
//   contract
// =====================================================================

async function createContract(user, contract, options) {
  const [pendingTxResult] = await api.createContract(user, contract, options);
  return createContractResolve(user, pendingTxResult, options);
}

async function createContractResolve(user, pendingTxResult, options) {
  // throw if FAILURE
  assertTxResult(pendingTxResult);
  // async - do not resolve
  if (options.isAsync) return pendingTxResult;
  // resolve - wait until not pending
  const resolvedTxResult = await resolveResult(user, pendingTxResult, options);
  // throw if FAILURE
  assertTxResult(pendingTxResult);
  // options.isDetailed - return all the data
  if (options.isDetailed) return resolvedTxResult.data.contents;
  // return basic contract object
  return {
    name: resolvedTxResult.data.contents.name,
    address: resolvedTxResult.data.contents.address
  };
}

// =====================================================================
//   contract list
// =====================================================================

async function createContractList(user, contract, options) {
  const pendingTxResult = await api.createContractList(user, contract, options);
  return createContractListResolve(user, pendingTxResult, options);
}

async function createContractListResolve(user, pendingTxResultList, options) {
  // throw if FAILURE
  assertTxResultList(pendingTxResultList); // @samrit what if 1 result failed ?
  // async - do not resolve
  if (options.isAsync) return pendingTxResultList;
  // resolve - wait until not pending
  const resolvedTxResultList = await resolveResults(
    user,
    pendingTxResultList,
    options
  );
  // throw if FAILURE
  assertTxResultList(resolvedTxResultList);
  // options.isDetailed - return all the data
  if (options.isDetailed) return resolvedTxResultList;
  // return a list basic contract object
  return resolvedTxResultList.map(
    resolvedTxResult => resolvedTxResult.data.contents
  );
}

// =====================================================================
//   key
// =====================================================================

async function getKey(user, options) {
  const response = await api.getKey(user, options);
  return response.address;
}

async function createKey(user, options) {
  const response = await api.createKey(user, options);
  return response.address;
}

async function createOrGetKey(user, options) {
  try {
    const response = await api.getKey(user, options);

    const balance = await api.getBalance({ ...user, ...response }, options);
    if (balance.isEqualTo(0)) {
      await fill({ ...user, ...response }, { isAsync: false, ...options });
    }
    return response.address;
  } catch (err) {
    const response = await api.createKey(user, options);
    await fill({ ...user, ...response }, { isAsync: false, ...options });
    return response.address;
  }
}

// =====================================================================
//   state
// =====================================================================

async function getBlocResults(user, hashes, options) {
  return api.blocResults(user, hashes, options);
}

async function getState(user, contract, options) {
  return api.getState(user, contract, options);
}

async function getBatchStates(user, contracts, options) {
  return api.getBatchStates(user, contracts, options);
}

async function getArray(user, contract, name, options) {
  const MAX_SEGMENT_SIZE = 100;
  options.stateQuery = { name, length: true };
  const state = await getState(user, contract, options);
  const length = state[name];
  const result = [];
  for (let segment = 0; segment < length / MAX_SEGMENT_SIZE; segment++) {
    options.stateQuery = {
      name,
      offset: segment * MAX_SEGMENT_SIZE,
      count: MAX_SEGMENT_SIZE
    };
    const state = await getState(user, contract, options);
    result.push(...state[name]);
  }
  return result;
}

// =====================================================================
//   call
// =====================================================================

async function call(user, callArgs, options) {
  const [pendingTxResult] = await api.call(user, callArgs, options);
  return callResolve(user, pendingTxResult, options);
}

async function callResolve(user, pendingTxResult, options) {
  // throw if FAILURE
  assertTxResult(pendingTxResult);
  // async - do not resolve
  if (options.isAsync) return pendingTxResult;
  // resolve - wait until not pending
  const resolvedTxResult = await resolveResult(user, pendingTxResult, options);
  // throw if FAILURE
  assertTxResult(pendingTxResult);
  // options.isDetailed - return all the data
  if (options.isDetailed) return resolvedTxResult;
  // return basic contract object
  return resolvedTxResult.data.contents;
}

// =====================================================================
//   call list
// =====================================================================

async function callList(user, callListArgs, options) {
  const pendingTxResultList = await api.callList(user, callListArgs, options);
  return callListResolve(user, pendingTxResultList, options);
}

async function callListResolve(user, pendingTxResultList, options) {
  // throw if FAILURE
  assertTxResultList(pendingTxResultList); // @samrit what if 1 result failed ?
  // async - do not resolve
  if (options.isAsync) return pendingTxResultList;
  // resolve - wait until not pending
  const resolvedTxResultList = await resolveResults(
    user,
    pendingTxResultList,
    options
  );
  // throw if FAILURE
  assertTxResultList(resolvedTxResultList);
  // options.isDetailed - return all the data
  if (options.isDetailed) return resolvedTxResultList;
  // return a list basic contract object
  return resolvedTxResultList.map(
    resolvedTxResult => resolvedTxResult.data.contents
  );
}

// =====================================================================
//   send
// =====================================================================

async function send(user, sendTx, options) {
  const [pendingTxResult] = await api.send(user, sendTx, options);

  if (options.isAsync) {
    return pendingTxResult;
  }

  const resolvedResult = await resolveResult(user, pendingTxResult, options);
  return resolvedResult.data.contents;
}

async function sendMany(user, sendTxs, options) {
  const pendingTxResults = await api.sendTransactions(
    user,
    {
      txs: sendTxs.map(tx => api.getSendArgs(tx, options))
    },
    options
  );

  if (options.isAsync) {
    return pendingTxResults.map(r => r.hash);
  }

  const resolvedResults = await resolveResults(user, pendingTxResults, options);
  return resolvedResults.map(r => r.data.contents);
}

// =====================================================================
//   search
// =====================================================================

async function search(user, contract, options) {
  try {
    const results = await api.search(user, contract, options);
    return results;
  } catch (err) {
    if (err.response && err.response.status === RestStatus.NOT_FOUND) {
      return [];
    }
    throw err;
  }
}

async function searchUntil(user, contract, predicate, options) {
  const action = async o => {
    return search(user, contract, o);
  };

  const results = await util.until(predicate, action, options);
  return results;
}

async function searchWithContentRange(user, contract, options) {
  try {
    const results = await api.searchWithContentRange(user, contract, options);
    return results;
  } catch (err) {
    if (err.response && err.response.status === RestStatus.NOT_FOUND) {
      return {};
    }
    throw err;
  }
}

async function searchWithContentRangeUntil(user, contract, predicate, options) {
  const action = async o => {
    return searchWithContentRange(user, contract, o);
  };

  const results = await util.until(predicate, action, options);
  return results;
}

// =====================================================================
//   Chains
// =====================================================================

async function getChain(user, chainId, options) {
  const results = await api.getChains([chainId], setAuthHeaders(user, options));
  return results && results.length > 0 ? results[0] : {};
}

async function getChains(user, chainIds, options) {
  const results = await api.getChains(chainIds, setAuthHeaders(user, options));
  return results;
}

async function createChain(user, chain, contract, options) {
  const result = await api.createChain(
    {
      ...chain,
      contract: contract.name,
      metadata: constructMetadata(options, contract.name)
    },
    setAuthHeaders(user, options)
  );
  return result;
}

async function createChains(user, chains, options) {
  const result = await api.createChains(chains, setAuthHeaders(user, options));
  return result;
}

// =====================================================================
//   External Storage
// =====================================================================

async function uploadExtStorage(user, args, options) {
  const result = await api.uploadExtStorage(
    args,
    setAuthHeaders(user, options)
  );
  return result;
}

async function attestExtStorage(user, args, options) {
  const result = await api.attestExtStorage(
    args,
    setAuthHeaders(user, options)
  );
  return result;
}

async function verifyExtStorage(user, contract, options) {
  const result = await api.verifyExtStorage(user, contract, options);
  return result;
}

async function downloadExtStorage(user, contract, options) {
  const result = await api.downloadExtStorage(user, contract, options);
  return result;
}

async function listExtStorage(user, args, options) {
  const result = await api.listExtStorage(user, args, options);
  return result;
}

// =====================================================================
//   OAuth
// =====================================================================

async function pingOauth(user, options) {
  const response = await api.pingOauth(user, options);
  return response;
}

// =====================================================================
//   Common patterns used in applications
// =====================================================================

async function waitForAddress(user, contract, _options) {
  const options = Object.assign(
    {
      query: {
        address: `eq.${contract.address}`
      }
    },
    _options
  );

  function predicate(response) {
    return (
      response !== undefined &&
      response.length != undefined &&
      response.length > 0
    );
  }

  const results = await searchUntil(user, contract, predicate, options);
  return results[0];
}

export default {
  getAccounts,
  createUser,
  compileContracts,
  createContract,
  createContractList,
  getState,
  getBatchStates,
  getArray,
  call,
  callList,
  //
  resolveResult,
  resolveResults,
  //
  getKey,
  createKey,
  createOrGetKey,
  //
  send,
  sendMany,
  //
  search,
  searchUntil,
  searchWithContentRange,
  searchWithContentRangeUntil,
  //
  createChain,
  createChains,
  getChain,
  getChains,
  //
  uploadExtStorage,
  attestExtStorage,
  verifyExtStorage,
  downloadExtStorage,
  listExtStorage,
  //
  pingOauth,
  //
  RestError,
  response,
  //
  waitForAddress
};
