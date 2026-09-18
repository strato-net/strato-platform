/**
 * Initialize and configure a freshly deployed HYPE YieldVault proxy.
 *
 * Use --dry-run to print the complete call plan without authenticating or submitting.
 */
const VAULT_NAME = 'HYPE Yield Vault';
const SHARE_SYMBOL = 'carryHYPE';
const RAY = 1000000000000000000000000000n;
const MAX_SAVINGS_RATE = 1000000021979553151239153027n;

function parseArgs() {
  const parsed = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue;
    const key = args[i].slice(2);
    if (key === 'dry-run') {
      parsed[key] = true;
      continue;
    }
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for argument: ${args[i]}`);
    }
    parsed[key] = value;
    i++;
  }
  return parsed;
}

function requireAddress(value, label) {
  const normalized = String(value || '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{40}$/.test(normalized)) {
    throw new Error(`${label} must be a 20-byte hex address`);
  }
  if (/^0{40}$/.test(normalized)) {
    throw new Error(`${label} must not be the zero address`);
  }
  return normalized;
}

function requireUint(value, label, max) {
  const normalized = String(value ?? '').trim();
  if (!/^[0-9]+$/.test(normalized)) {
    throw new Error(`${label} must be an unsigned integer`);
  }
  if (max != null && BigInt(normalized) > BigInt(max)) {
    throw new Error(`${label} must not exceed ${max}`);
  }
  return normalized;
}

function buildPlan(args) {
  const vaultAddress = requireAddress(args['vault-address'], 'vault-address');
  const whype = requireAddress(args.whype, 'whype');
  const khype = requireAddress(args.khype, 'khype');
  const strategy = requireAddress(args.strategy, 'strategy');
  const rewardDistributor = requireAddress(args['reward-distributor'], 'reward-distributor');
  if (strategy === rewardDistributor) {
    throw new Error('strategy and reward-distributor must be different addresses');
  }

  const minIdleBps = requireUint(args['min-idle-bps'] ?? '0', 'min-idle-bps', 10000);
  const savingsRate = requireUint(args['savings-rate'], 'savings-rate');
  if (BigInt(savingsRate) < RAY || BigInt(savingsRate) > MAX_SAVINGS_RATE) {
    throw new Error(`savings-rate must be between ${RAY} and ${MAX_SAVINGS_RATE}`);
  }
  const sweepBuffer = requireUint(args['sweep-buffer'] ?? '0', 'sweep-buffer');
  const calls = [
    { method: 'initialize', args: { asset_: whype, name_: VAULT_NAME, symbol_: SHARE_SYMBOL } },
    { method: 'setMinIdleBps', args: { minIdleBps_: minIdleBps } },
    { method: 'initializeAccrual', args: {} },
    { method: 'setRewardDistributor', args: { newRewardDistributor: rewardDistributor } },
    { method: 'setPerSecondSavingsRate', args: { newRate: savingsRate } },
    { method: 'setStrategyApproval', args: { strategy, approved: true } },
    { method: 'setStrategyYieldToken', args: { strategy, yieldToken: khype } },
    { method: 'setSweepBuffer', args: { newBuffer: sweepBuffer } },
  ];

  if (args['fee-collector']) {
    calls.push({
      method: 'setFeeCollector',
      args: { newFeeCollector: requireAddress(args['fee-collector'], 'fee-collector') },
    });
  }
  if (args['price-oracle']) {
    calls.push({
      method: 'setPriceOracle',
      args: { newOracle: requireAddress(args['price-oracle'], 'price-oracle') },
    });
  }

  return { vaultAddress, whype, khype, strategy, rewardDistributor, calls };
}

async function callVault(rest, config, tokenObj, vaultAddress, call) {
  return rest.call(
    tokenObj,
    {
      contract: { address: vaultAddress, name: 'YieldVault' },
      method: call.method,
      args: call.args,
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
    { config, cacheNonce: true }
  );
}

async function main() {
  const args = parseArgs();
  const required = [
    'vault-address',
    'whype',
    'khype',
    'strategy',
    'reward-distributor',
    'savings-rate',
  ];
  const missing = required.filter((key) => !args[key]);
  if (missing.length) {
    throw new Error(`Missing required arguments: ${missing.map((key) => `--${key}`).join(', ')}`);
  }

  const plan = buildPlan(args);
  console.log('HYPE Yield Vault configuration plan:');
  console.log(JSON.stringify(plan, null, 2));
  if (args['dry-run']) {
    console.log('\nDry run complete. No calls submitted.');
    return;
  }

  require('dotenv').config();
  const config = require('./config');
  const auth = require('./auth');
  const { rest } = require('blockapps-rest');
  const username = process.env.GLOBAL_ADMIN_NAME;
  const password = process.env.GLOBAL_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error('Missing GLOBAL_ADMIN_NAME / GLOBAL_ADMIN_PASSWORD in .env');
  }

  const token = await auth.getUserToken(username, password);
  const tokenObj = { token };
  for (const call of plan.calls) {
    console.log(`\nCalling YieldVault(${plan.vaultAddress}).${call.method}...`);
    const result = await callVault(rest, config, tokenObj, plan.vaultAddress, call);
    console.log(`${call.method} result:`, result);
  }
  console.log(`\nHYPE Yield Vault configured: ${plan.vaultAddress}`);
}

main().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
