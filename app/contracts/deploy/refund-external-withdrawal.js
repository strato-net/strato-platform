/**
 * Vote to refund an expired or cancelled ExternalAssetBridge withdrawal.
 *
 * Usage:
 *   node refund-external-withdrawal.js \
 *     --bridge-address <address> \
 *     --withdrawal-id <id> \
 *     [--admin-registry <address>] \
 *     [--execute]
 *
 * Without --execute, this script verifies confirmed non-payment evidence and prints the planned governance call.
 */
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('blockapps-rest');
const { Contract, JsonRpcProvider } = require('ethers');

const DEFAULT_ADMIN_REGISTRY = '000000000000000000000000000000000000100c';

function parseArgs() {
  const parsed = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--execute') {
      parsed.execute = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    parsed[arg.slice(2)] = value;
    i++;
  }
  return parsed;
}

function normalizeAddress(value, label) {
  const normalized = String(value || '').replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{40}$/.test(normalized)) {
    throw new Error(`${label} must be a 20-byte hex address`);
  }
  return normalized.toLowerCase();
}

async function callAndWait(tokenObj, registry, args) {
  const response = await rest.call(
    tokenObj,
    {
      contract: { address: registry, name: 'AdminRegistry' },
      method: 'castVoteOnIssue',
      args,
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
    { config, cacheNonce: true, isAsync: true }
  );
  const responses = Array.isArray(response) ? response : [response];
  const hashes = responses.map((item) => item && item.hash).filter(Boolean);
  if (hashes.length === 0) {
    throw new Error('AdminRegistry.castVoteOnIssue returned no transaction hash');
  }

  const results = await util.until(
    (items) =>
      Array.isArray(items) &&
      items.length > 0 &&
      items.every((item) => item && item.status && item.status !== 'Pending'),
    (options) => rest.getBlocResults(tokenObj, hashes, options),
    { config, isAsync: true },
    60000
  );
  const final = Array.isArray(results) ? results[0] : results;
  if (!final || final.status !== 'Success') {
    throw new Error(
      `Refund vote failed: ${JSON.stringify(final || results)}`
    );
  }
  return final;
}

async function prepareRefund(bridgeAddress, withdrawalId, token, options = {}) {
  const nodeUrl = (options.nodeUrl || process.env.NODE_URL || '').replace(/\/$/, '');
  const fetchImpl = options.fetchImpl || fetch;
  const read = async (pathname, params = {}) => {
    const response = await fetchImpl(`${nodeUrl}${pathname}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`Refund evidence query failed: ${response.status}`);
    return response.json();
  };
  const identity = { address: `eq.${bridgeAddress}`, key: `eq.${withdrawalId}`, select: 'value', limit: '1' };
  const [withdrawals, authorizations, metadata, bridges] = await Promise.all([
    read('/cirrus/search/BlockApps-ExternalAssetBridge-withdrawals', identity),
    read('/cirrus/search/BlockApps-ExternalAssetBridge-withdrawalAuthorizations', identity),
    read('/strato-api/eth/v1.2/metadata'),
    read('/cirrus/search/BlockApps-ExternalAssetBridge', { address: `eq.${bridgeAddress}`, select: 'settlementVerifierThreshold', limit: '1' }),
  ]);
  const expectedSourceChainId = options.sourceChainId || process.env.SOURCE_CHAIN_ID;
  if (!expectedSourceChainId || metadata.networkID == null || BigInt(metadata.networkID) !== BigInt(expectedSourceChainId)) {
    throw new Error('SOURCE_CHAIN_ID must match STRATO metadata');
  }
  const threshold = Number(bridges?.[0]?.settlementVerifierThreshold);
  if (!Number.isSafeInteger(threshold) || threshold < 2) throw new Error('Invalid refund verifier threshold');
  const withdrawal = withdrawals?.[0]?.value;
  const stored = authorizations?.[0]?.value;
  if (!withdrawal || !stored?.destinationVault ||
      !(Number(withdrawal.status) === 5 || (Number(withdrawal.status) === 3 && !withdrawal.reservationId))) {
    throw new Error('Withdrawal is not eligible for an attested refund');
  }
  const authorization = {
    sourceChainId: String(expectedSourceChainId), sourceBridge: `0x${bridgeAddress}`,
    sourceWithdrawalId: withdrawalId, destinationChainId: String(withdrawal.externalChainId),
    destinationVault: `0x${normalizeAddress(stored.destinationVault, 'destinationVault')}`,
    token: `0x${normalizeAddress(withdrawal.externalToken, 'externalToken')}`,
    recipient: `0x${normalizeAddress(withdrawal.externalRecipient, 'externalRecipient')}`,
    amount: String(withdrawal.externalTokenAmount), notBefore: String(stored.notBefore),
    deadline: String(stored.deadline), signerSetVersion: String(stored.signerSetVersion),
  };
  if (String(withdrawal.authorizationDeadline) !== authorization.deadline) throw new Error('Source authorization deadline mismatch');
  const confirmations = Number(options.confirmations ?? process.env[`CHAIN_${authorization.destinationChainId}_DEPOSIT_CONFIRMATIONS`]);
  if (!Number.isSafeInteger(confirmations) || confirmations <= 0) throw new Error('Positive external confirmation count is required');
  const rpcUrl = process.env[`CHAIN_${authorization.destinationChainId}_RPC_URL`];
  if (!options.provider && !rpcUrl) throw new Error('External RPC URL is required');
  const provider = options.provider || new JsonRpcProvider(rpcUrl);
  try {
    if (BigInt(await provider.send('eth_chainId', [])) !== BigInt(authorization.destinationChainId)) throw new Error('External RPC chain ID mismatch');
    const latest = await provider.getBlock('latest');
    if (!latest || latest.number < confirmations) throw new Error('Confirmed external state is unavailable');
    const blockTag = latest.number - confirmations;
    const block = await provider.getBlock(blockTag);
    if (!block || BigInt(block.timestamp) <= BigInt(authorization.deadline)) throw new Error('Authorization has not expired in confirmed external state');
    const vault = options.vault || new Contract(authorization.destinationVault, [
      'function getReservationId(uint256,address,uint256) pure returns (bytes32)',
      'function reservations(bytes32) view returns (uint8 status,address token,address recipient,uint256 amount,uint256 deadline,bytes32 authorizationDigest)',
      'function authorizationDigest((uint256 sourceChainId,address sourceBridge,uint256 sourceWithdrawalId,uint256 destinationChainId,address destinationVault,address token,address recipient,uint256 amount,uint256 notBefore,uint256 deadline,uint256 signerSetVersion)) view returns (bytes32)',
    ], provider);
    const reservationId = await vault.getReservationId(authorization.sourceChainId, authorization.sourceBridge, withdrawalId);
    const reservation = await vault.reservations(reservationId, { blockTag });
    const status = Number(reservation.status);
    if (status !== 0 && status !== 3) throw new Error('External reservation is reserved or already released');
    if (status === 3 && reservation.authorizationDigest.toLowerCase() !== (await vault.authorizationDigest(authorization, { blockTag })).toLowerCase()) {
      throw new Error('Cancelled reservation authorization mismatch');
    }
    return { authorization, threshold, reservationId, externalBlockNumber: blockTag, externalBlockHash: block.hash, reservationStatus: status };
  } finally {
    if (!options.provider) provider.destroy();
  }
}

async function collectRefundAttestations(evidence) {
  const chainId = evidence.authorization.destinationChainId;
  const urls = (process.env[`CHAIN_${chainId}_EXTERNAL_BRIDGE_VERIFIER_URLS`] || '').split(',').map((v) => v.trim()).filter(Boolean);
  const tokens = (process.env[`CHAIN_${chainId}_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS`] || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (!urls.length || urls.length !== tokens.length || urls.some((url) => new URL(url).protocol !== 'https:')) {
    throw new Error('HTTPS verifier URLs and matching API tokens are required');
  }
  const results = await Promise.allSettled(urls.map(async (url, index) => {
    const response = await fetch(`${url.replace(/\/$/, '')}/v1/attest-refund`, {
      method: 'POST', headers: { Authorization: `Bearer ${tokens[index]}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorization: evidence.authorization }), signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`Refund verifier rejected evidence: ${response.status}`);
    return response.json();
  }));
  const accepted = new Set(results.filter((result) => result.status === 'fulfilled' && result.value.transactionHash)
    .map((result) => String(result.value.settlementAttestor || '').toLowerCase()).filter(Boolean));
  if (accepted.size < evidence.threshold) throw new Error('Refund verifier quorum was not reached; no governance vote submitted');
}

async function main() {
  const args = parseArgs();
  const bridgeAddress = normalizeAddress(
    args['bridge-address'],
    'bridge-address'
  );
  const withdrawalId = String(args['withdrawal-id'] || '');
  if (!/^[1-9][0-9]*$/.test(withdrawalId)) {
    throw new Error('withdrawal-id must be a positive integer');
  }
  const adminRegistry = normalizeAddress(
    args['admin-registry'] || process.env.ADMIN_REGISTRY || DEFAULT_ADMIN_REGISTRY,
    'admin-registry'
  );
  const voteArgs = {
    _target: bridgeAddress,
    _func: 'refundWithdrawal',
    _args: [{ type: 'uint256', value: withdrawalId }],
  };

  const required = [
    'GLOBAL_ADMIN_NAME',
    'GLOBAL_ADMIN_PASSWORD',
    'OAUTH_CLIENT_SECRET',
    'OAUTH_CLIENT_ID',
    'OAUTH_URL',
    'NODE_URL',
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  const token = await auth.getUserToken(
    process.env.GLOBAL_ADMIN_NAME,
    process.env.GLOBAL_ADMIN_PASSWORD
  );
  const evidence = await prepareRefund(bridgeAddress, withdrawalId, token);
  console.log(JSON.stringify({ evidence, contract: adminRegistry, method: 'castVoteOnIssue', args: voteArgs }, null, 2));
  if (!args.execute) {
    console.log('Evidence verified. Dry run only; no attestations or governance votes submitted.');
    return;
  }
  await collectRefundAttestations(evidence);
  const result = await callAndWait({ token }, adminRegistry, voteArgs);
  console.log(`Refund vote submitted successfully (${result.hash})`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = main;
module.exports.prepareRefund = prepareRefund;
