import { BigNumber } from "bignumber.js";
import {
  Endpoint,
  constructMetadata,
  constructEndpoint,
  get,
  post,
  postue,
  getNodeUrl,
  setAuthHeaders
} from "./util/api.util";
import { TxPayloadType } from "./constants";
import {
  Options,
  StratoUser,
  OAuthUser,
  BlockChainUser,
  Contract,
  ContractDefinition,
  CallArgs
} from "./types";
/*
async function getUsers(ouser:OAuthUser, options:Options) {
  const url = getNodeUrl(options);
  const endpoint = constructEndpoint(Endpoint.USERS, options);
  return get(url, endpoint, setAuthHeaders(ouser, options));
}

async function getUser(ouser:OAuthUser, options:Options) {
  const url = getNodeUrl(options);
  const urlParams = {
    username: ouser.username
  };
  const endpoint = constructEndpoint(Endpoint.USER, options, urlParams);
  return get(url, endpoint, setAuthHeaders(ouser, options));
}

async function createUser(user:StratoUser, options:Options) {
  const url = getNodeUrl(options);
  const data = {
    password: user.password
  };
  const urlParams = {
    username: user.username
  };
  const endpoint = constructEndpoint(Endpoint.USER, options, urlParams);
  return postue(url, endpoint, data, options);
}
*/
async function fill(user, options:Options) {
  const body = {};
  const url = getNodeUrl(options);
  const urlParams = {
    username: user.username,
    address: user.address
  };
  const endpoint = constructEndpoint(Endpoint.FILL, options, urlParams);
  return postue(url, endpoint, body, setAuthHeaders(user, options));
}

function getCreateArgs(contract:ContractDefinition, options:Options) {
  const src = options.config.VM === 'EVM' ? {} : { src: contract.source };

  const payload = {
    ...src,
    contract: contract.name,
    args: contract.args,
    chainid: contract.chainid,
    txParams: contract.txParams,
    metadata: constructMetadata(options, contract.name),
  };

  const tx = {
    payload,
    type: TxPayloadType.CONTRACT,
  };
  return tx;
}

async function compileContracts(user:OAuthUser, contracts, options:Options) {
  const body = contracts.map(contract => ({ contractName: contract.name, source: contract.source }));

  const url = getNodeUrl(options);
  const endpoint = constructEndpoint(Endpoint.COMPILE, options);
  return post(url, endpoint, body, setAuthHeaders(user, options));
}

async function createContract(user, contract:ContractDefinition, options:Options) {
  const tx = getCreateArgs(contract, options);
  const body = {
    txs: [tx]
  };
  const pendingTxResult = await sendTransactions(user, body, options);
  return pendingTxResult;
}

async function createContractList(user:BlockChainUser, contracts:ContractDefinition[], options:Options) {
  const txs = contracts.map(contract => getCreateArgs(contract, options));
  const body = {
    txs
  };
  const pendingTxResultList = await sendTransactions(user, body, options);
  return pendingTxResultList;
}

async function blocResults(user:OAuthUser, hashes, options:Options) {
  // TODO untested code
  const url = getNodeUrl(options);
  const endpoint = constructEndpoint(Endpoint.TXRESULTS, options);
  return post(url, endpoint, hashes, setAuthHeaders(user, options));
}

async function getAccounts(user:OAuthUser, options:Options) {
  const url = getNodeUrl(options);
  const endpoint = constructEndpoint(Endpoint.ACCOUNT, options);
  return get(url, endpoint, setAuthHeaders(user, options));
}

async function getBalance(user:OAuthUser, bcuser:BlockChainUser | null, options:Options) {
  let address;
  if (!bcuser) {
    const response = await getKey(user, options);
    address = response.address;
  }
  else address = bcuser.address;
  
  const accounts = await getAccounts(user, {
    ...options,
    // this endpoint does not accept the resolve flag
    isAsync: true,
    query: {
      address
    }
  });
  if (accounts.length == 0) {
    return new BigNumber(0);
  }

  return new BigNumber(accounts[0].balance);
}

async function getState(user:OAuthUser, contract, options:Options) {
  const url = getNodeUrl(options);
  const urlParams = {
    name: contract.name,
    address: contract.address
  };
  const endpoint = constructEndpoint(Endpoint.STATE, options, urlParams);
  return get(url, endpoint, setAuthHeaders(user, options));
}

async function getBatchStates(user:OAuthUser, stateArgs, options:Options) {
  const url = getNodeUrl(options);
  const endpoint = constructEndpoint(Endpoint.STATES, options);
  const body = stateArgs ? stateArgs : [];
  return post(url, endpoint, body, setAuthHeaders(user, options));
}

function getCallArgs(callMethodArgs, options:Options) {
  const { contract, method, args, value, chainid, txParams } = callMethodArgs;
  const valueFixed = value instanceof BigNumber ? value.toFixed(0) : value;
  const payload = {
      contractName: contract.name,
      contractAddress: contract.address,
      chainid,
      value: valueFixed,
      method,
      args,
      txParams,
      metadata: constructMetadata(options, contract.name)
  };
  const tx = {
      payload,
      type: TxPayloadType.FUNCTION
  };
  return tx;
}

async function call(user:BlockChainUser, callMethodArgs:CallArgs, options:Options) {
  const tx = getCallArgs(callMethodArgs, options);
  const body = {
    txs: [tx]
  };
  const pendingTxResult = await sendTransactions(user, body, options);
  return pendingTxResult;
}

async function callList(user, callListArgs, options:Options) {
  const txs = callListArgs.map(callArgs => getCallArgs(callArgs, options));
  const body = {
    txs
  };
  const pendingTxResultList = await sendTransactions(user, body, options);
  return pendingTxResultList;
}

async function sendTransactions(user:OAuthUser, body, options:Options) {
  const url = getNodeUrl(options);
  const { cacheNonce, ...sendOptions } = options;

  let endpoint;
  if (cacheNonce) {
    endpoint = constructEndpoint(Endpoint.SEND_PARALLEL, sendOptions);
  } else {
    endpoint = constructEndpoint(Endpoint.SEND, sendOptions);
  }

  return post(url, endpoint, body, setAuthHeaders(user, sendOptions));
}

function getSendArgs(sendTx, options:Options) {
  const tx = {
    payload: sendTx,
    type: TxPayloadType.TRANSFER
  };
  return tx;
}

async function send(user, sendTx, options:Options) {
  const tx = getSendArgs(sendTx, options);
  const body = {
    txs: [tx]
  };
  return sendTransactions(user, body, options);
}

async function getKey(user:OAuthUser, options:Options):Promise<BlockChainUser | null> {
  const url = getNodeUrl(options);
  const endpoint = constructEndpoint(Endpoint.KEY, options);
  return get(url, endpoint, setAuthHeaders(user, options));
}

async function createKey(user:OAuthUser, options:Options) {
  const url = getNodeUrl(options);
  const endpoint = constructEndpoint(Endpoint.KEY, options);
  const body = {};
  return post(url, endpoint, body, setAuthHeaders(user, options));
}

async function search(user:OAuthUser, contract:Contract, options:Options) {
  const url = getNodeUrl(options);
  const urlParams = {
    name: contract.name
  };
  const endpoint = constructEndpoint(Endpoint.SEARCH, options, urlParams);
  return get(url, endpoint, setAuthHeaders(user, options));
}

async function searchWithContentRange(user:OAuthUser, contract, options:Options) {
  const url = getNodeUrl(options);
  const urlParams = {
      name: contract.name
  };
  const endpoint = constructEndpoint(Endpoint.SEARCH, options, urlParams);
  const headersWithCount = { ...options.headers, Prefer: 'count=exact' };
  const optionsWithCount = { ...options, headers: headersWithCount, getFullResponse: true };
  const { data, headers } = await get(url, endpoint, setAuthHeaders(user, optionsWithCount));
  const contentRangeStr = headers['content-range'];
  const [range, countStr] = contentRangeStr.split('/');
  const count = parseInt(countStr, 10);
  if (range === "*") {
    const contentRange = { count };
    return { data, contentRange };
  }
  const [start, end] = range.split('-').map((s) => parseInt(s, 10));
  const contentRange = { start, end, count };
  return { data, contentRange };
}

// TODO: check options.params and options.headers in axoos wrapper.
async function getChains(chainIds, options:Options) {
  const url = getNodeUrl(options);
  const endpoint = constructEndpoint(Endpoint.CHAIN, {
    config: options.config,
    chainIds
  });
  return get(url, endpoint, options);
}

async function createChain(body, options:Options) {
  const url = getNodeUrl(options);
  const endpoint = constructEndpoint(Endpoint.CHAIN, options);
  return await post(url, endpoint, body, options);
}

async function createChains(body, options:Options) {
    const url = getNodeUrl(options);
    const endpoint = constructEndpoint(Endpoint.CHAINS, options);
    return await post(url, endpoint, body, options);
}

async function uploadExtStorage(body, options:Options) {
  const url = getNodeUrl(options);
  const endpoint = constructEndpoint(Endpoint.EXT_UPLOAD, options);
  return await post(url, endpoint, body, options);
}

async function attestExtStorage(body, options:Options) {
  const url = getNodeUrl(options);
  const endpoint = constructEndpoint(Endpoint.EXT_ATTEST, options);
  return await post(url, endpoint, body, options);
}

async function verifyExtStorage(user:OAuthUser, contract, options:Options) {
  const url = getNodeUrl(options);
  const params = {
    contractAddress: contract.address
  };
  const endpoint = constructEndpoint(Endpoint.EXT_VERIFY, options, params);
  return get(url, endpoint, setAuthHeaders(user, options));
}

async function downloadExtStorage(user:OAuthUser, contract, options:Options) {
  const url = getNodeUrl(options);
  const params = {
    contractAddress: contract.address
  };
  const endpoint = constructEndpoint(Endpoint.EXT_DOWNLOAD, options, params);
  return get(url, endpoint, setAuthHeaders(user, options));
}

async function listExtStorage(user:OAuthUser, args, options:Options) {
  const url = getNodeUrl(options);
  const { limit, offset } = args;
  const params = {
    limit,
    offset
  };
  const endpoint = constructEndpoint(Endpoint.EXT_LIST, options, params);
  return get(url, endpoint, setAuthHeaders(user, options));
}

async function pingOauth(user:OAuthUser, options:Options){
  const url = getNodeUrl(options)
  const endpoint = constructEndpoint(Endpoint.KEY, options)
  const result = await get(url, endpoint, setAuthHeaders(user, options))
  return result.status
}

export default {
  getAccounts,
  getBalance,
//  getUsers,
//  getUser,
//  createUser,
  getCreateArgs,
  compileContracts,
  createContract,
  createContractList,
  fill,
  blocResults,
  getState,
  getBatchStates,
  getCallArgs,
  call,
  callList,
  getSendArgs,
  send,
  sendTransactions,
  getKey,
  createKey,
  search,
  searchWithContentRange,
  getChains,
  createChain,
  createChains,
  uploadExtStorage,
  attestExtStorage,
  verifyExtStorage,
  downloadExtStorage,
  listExtStorage,
  pingOauth,
}
