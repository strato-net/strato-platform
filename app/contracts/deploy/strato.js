const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function request(user, endpoint, options, data) {
  const params = new URLSearchParams();
  const query = {
    chainid: options.chainIds,
    ...(!options.isAsync && { resolve: true }),
    ...options.stateQuery,
    ...options.query,
  };
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, item === null ? '' : String(item));
    }
  }
  const node = options.config.nodes[options.node || 0];
  const response = await axios({
    method: data === undefined ? 'GET' : 'POST',
    url: `${node.url.replace(/\/$/, '')}${endpoint}`,
    headers: { ...options.headers, Authorization: `Bearer ${user.token}` },
    params,
    data,
    timeout: options.config.timeout,
  });
  return response.data;
}

function metadata(name, options) {
  const history = options.enableHistory ? [name] : [];
  const extra = options.history === undefined ? [] : [options.history].flat();
  const result = { history: [...new Set([...history, ...extra])].join(',') };
  if (options.enableIndex === false || options.noindex) {
    result.noindex = [...new Set([
      ...(options.enableIndex === false ? [name] : []),
      ...(options.noindex || []),
    ])].join(',');
  }
  if (options.config.VM) result.VM = options.config.VM;
  return result;
}

async function until(predicate, action, options, timeout = 60000) {
  let totalSleep = 0;
  for (let delay = 500; totalSleep < timeout; delay += 10) {
    const result = await action(options);
    if (predicate(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, delay));
    totalSleep += delay;
  }
  throw new Error(`until: timeout ${timeout} ms exceeded`);
}

function assertSuccess(results) {
  const failed = results.find((result) => result.status === 'Failure');
  if (failed) throw new Error(`Transaction failed: ${JSON.stringify(failed)}`);
}

function getBlocResults(user, hashes, options) {
  return request(user, '/bloc/v2.2/transactions/results', options, hashes);
}

async function submit(user, txs, options) {
  const endpoint = '/strato/v2.3/transaction' + (options.cacheNonce ? '/parallel' : '');
  const pending = await request(user, endpoint, options, {
    txs,
    txParams: { gasLimit: 32100000000, gasPrice: 1, ...options.config.txParams, ...options.txParams },
  });
  assertSuccess(pending);
  if (options.isAsync) return pending;
  const hashes = pending.map((result) => result.hash);
  const results = await until(
    (receipts) => receipts.length === hashes.length && receipts.every((r) => r.status !== 'Pending'),
    () => getBlocResults(user, hashes, { ...options, isAsync: true }),
    options
  );
  assertSuccess(results);
  return results;
}

function functionTx(call, options) {
  return {
    type: 'FUNCTION',
    payload: {
      contractName: call.contract.name,
      contractAddress: call.contract.address,
      method: call.method,
      args: call.args,
      value: call.value,
      chainid: call.chainid,
      txParams: call.txParams,
      metadata: metadata(call.contract.name, options),
    },
  };
}

async function callList(user, calls, options) {
  const results = await submit(user, calls.map((call) => functionTx(call, options)), options);
  return options.isAsync || options.isDetailed ? results : results.map((r) => r.data?.contents);
}

async function call(user, args, options) {
  const [result] = await callList(user, [args], options);
  return result;
}

async function createContract(user, contract, options) {
  const [result] = await submit(user, [{
    type: 'CONTRACT',
    payload: {
      contract: contract.name,
      src: contract.source,
      args: contract.args,
      chainid: contract.chainid,
      txParams: contract.txParams,
      metadata: metadata(contract.name, options),
    },
  }], options);
  if (options.isAsync) return result;
  const contents = result.data?.contents;
  if (options.isDetailed && contents) return contents;
  const address = contents?.address || [result.txResult?.contractsCreated].flat()[0];
  if (!address) throw new Error(`Deployment receipt has no contract address: ${JSON.stringify(result)}`);
  return { name: contents?.name || contract.name, address };
}

async function getKey(user, options) {
  const key = await request(user, '/strato/v2.3/key', options);
  return key.address;
}

function getState(user, contract, options) {
  return request(user, `/bloc/v2.2/contracts/${encodeURIComponent(contract.name)}/${encodeURIComponent(contract.address)}/state`, options);
}

function search(user, contract, options) {
  const chainIds = options.chainIds;
  const chainQuery = chainIds?.length
    ? { chainId: chainIds.length === 1 ? `eq.${chainIds[0]}` : `in.${chainIds.join(',')}` }
    : {};
  return request(user, `/cirrus/search/${encodeURIComponent(contract.name)}`, {
    ...options, isAsync: true, chainIds: undefined, query: { ...chainQuery, ...options.query },
  });
}

// Keep the source bundle's dependency order and array/object formats used by the CLI tools.
async function combine(filename, toObject = false, relativePath = process.cwd()) {
  const names = new Set();
  const files = [];
  function read(fullname) {
    names.add(path.basename(fullname));
    let buffer = '';
    for (const line of fs.readFileSync(fullname, 'utf8').split('\n')) {
      if (line.startsWith('import') && !line.includes('<')) {
        buffer += '//' + line + '\n';
        const importName = line.match(/["']([^"']+)["']/)[1];
        if (!names.has(path.basename(importName))) {
          read(path.join(importName.startsWith('/') ? relativePath : path.dirname(fullname), importName));
        }
      } else {
        buffer += line.replace('\r', ' ') + '\n';
      }
    }
    files.push([path.basename(fullname), buffer]);
  }
  read(filename);
  return toObject ? Object.fromEntries(files) : files;
}

module.exports = {
  rest: { call, callList, createContract, getBlocResults, getKey, getState, search },
  util: { until },
  importer: { combine },
};
