/**
 * Solver fast-path rollout for the STRATO-side bridges.
 *
 * WHY THIS EXISTS. Both bridge proxies are owned by the AdminRegistry, which
 * needs 60% of its admins to agree before an owner-gated call takes effect --
 * two of three, on helium. `upgrade.js` deploys an implementation and casts the
 * FIRST vote; nothing in the repo casts the second, and nothing configures the
 * fast path. This does both, one explicit subcommand at a time, so each live
 * governance call is a separate deliberate invocation rather than a step buried
 * in a longer script.
 *
 * Credentials come from app/backend/.env, which holds two admin accounts. They
 * are read with dotenv rather than sourced into the shell: sourcing that file
 * produced "invalid_grant" from Keycloak, and dotenv's parsing is the only
 * thing that should ever touch a password.
 *
 * Usage:
 *   node deploy/bridge-fastpath-rollout.js vote-upgrade \
 *     --proxy <proxyAddr> --impl <implAddr> --admin 2
 *
 *   node deploy/bridge-fastpath-rollout.js set-fee-config \
 *     --bridge <proxyAddr> --contract MercataBridge --admin 1
 *
 *   node deploy/bridge-fastpath-rollout.js set-announcement-config \
 *     --bridge <proxyAddr> --contract MercataBridge --admin 1
 *
 *   node deploy/bridge-fastpath-rollout.js show --bridge <proxyAddr>
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load the admin credentials BEFORE anything requires ./config, whose
// dotenv.config() must not win over these.
const backendEnv = dotenv.parse(
  fs.readFileSync(path.join(__dirname, '../../backend/.env'))
);

/**
 * The fee schedule and announcement bond the fast path runs under.
 *
 * A six-hour half-life is twelve halvings across the three-day window, so an
 * offered fee is about 1/4096 of its ceiling by day three and exactly zero at
 * it. The 5% cap is the anti-grief bound: occupying a claim with a dust payment
 * would cost a solver 95% of the amount, paid to the user.
 */
const FAST_PATH = {
  feeHalfLifeSeconds: 21600,
  maxFeeBps: 500,
  fillsEnabled: true,
  announcementsEnabled: true,
  // USDST on helium, 18 decimals. A bond is refunded on adoption, reclaimable
  // after the TTL, and slashed only on a governance rejection.
  bondToken: '937efa7e3a77e20bbdbd7c0d32b6514f368c1010',
  bondAmount: (10n * 10n ** 18n).toString(),
  // The genesis FeeCollector, itself AdminRegistry-owned, so a slashed bond
  // lands somewhere governance already controls.
  slashRecipient: '000000000000000000000000000000000000100d',
  announcementTtlSeconds: 604800,
};

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

function applyAdminEnv(slot) {
  const suffix = String(slot) === '2' ? '2' : '';
  const name = backendEnv[`USERNAME${suffix}`];
  const password = backendEnv[`PASSWORD${suffix}`];
  if (!name || !password) {
    throw new Error(`app/backend/.env has no USERNAME${suffix}/PASSWORD${suffix}`);
  }
  process.env.OAUTH_CLIENT_ID = backendEnv.OAUTH_CLIENT_ID;
  process.env.OAUTH_CLIENT_SECRET = backendEnv.OAUTH_CLIENT_SECRET;
  process.env.OAUTH_URL = backendEnv.OAUTH_DISCOVERY_URL;
  // Submit to a VALIDATOR, not to the app node.
  //
  // app/backend/.env points NODE_URL at app.testnet.strato.nexus, which is a
  // follower: it replays blocks and does not propose them, and on 2026-09-18 it
  // was the endpoint that was down while the validators were healthy. Governed
  // calls should go to a node that is actually producing blocks. NODE_URL in the
  // environment wins, so a caller can aim this anywhere.
  process.env.NODE_URL =
    process.env.NODE_URL || 'https://node1.testnet.strato.nexus';
  process.env.GLOBAL_ADMIN_NAME = name;
  process.env.GLOBAL_ADMIN_PASSWORD = password;
  process.env.GAS_LIMIT = process.env.GAS_LIMIT || '32100000000';
  return name;
}

const requireAddress = (value, label) => {
  const clean = String(value || '').replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(clean)) throw new Error(`${label} is not an address: ${value}`);
  return clean;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const subcommand = args._[0];

  if (subcommand === 'show') {
    // Read-only: no credentials, no votes.
    const { cirrusSearch } = require('./util');
    const bridge = requireAddress(args.bridge, '--bridge');
    const rows = await cirrusSearch(
      `BlockApps-${args.contract || 'MercataBridge'}?address=eq.${bridge}`
    );
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const admin = applyAdminEnv(args.admin || '1');
  const { callListAndWait } = require('./util');
  console.log(`acting as admin slot ${args.admin || '1'} (${admin})`);

  let calls;
  switch (subcommand) {
    /**
     * Repoint a proxy at an already-deployed implementation.
     *
     * Deliberately takes the implementation address rather than deploying one:
     * the second vote has to name the SAME implementation as the first, and a
     * script that deployed its own would cast a vote for a different address
     * and silently never reach the threshold.
     */
    case 'vote-upgrade': {
      const proxy = requireAddress(args.proxy, '--proxy');
      const impl = requireAddress(args.impl, '--impl');
      console.log(`vote: setLogicContract(${impl}) on proxy ${proxy}`);
      calls = [{
        contract: { address: proxy, name: 'Proxy' },
        method: 'setLogicContract',
        args: { _logicContract: impl },
      }];
      break;
    }

    case 'set-fee-config': {
      const bridge = requireAddress(args.bridge, '--bridge');
      console.log(
        `vote: setFeeConfig(halfLife=${FAST_PATH.feeHalfLifeSeconds}, ` +
        `maxFeeBps=${FAST_PATH.maxFeeBps}, fills=${FAST_PATH.fillsEnabled}) on ${bridge}`
      );
      calls = [{
        contract: { address: bridge, name: args.contract || 'MercataBridge' },
        method: 'setFeeConfig',
        args: {
          halfLifeSeconds: FAST_PATH.feeHalfLifeSeconds,
          feeBpsCeiling: FAST_PATH.maxFeeBps,
          enableFills: FAST_PATH.fillsEnabled,
        },
      }];
      break;
    }

    case 'set-announcement-config': {
      const bridge = requireAddress(args.bridge, '--bridge');
      console.log(
        `vote: setAnnouncementConfig(enabled=${FAST_PATH.announcementsEnabled}, ` +
        `bond=${FAST_PATH.bondAmount} of ${FAST_PATH.bondToken}, ` +
        `slashTo=${FAST_PATH.slashRecipient}, ttl=${FAST_PATH.announcementTtlSeconds}) on ${bridge}`
      );
      calls = [{
        contract: { address: bridge, name: args.contract || 'MercataBridge' },
        method: 'setAnnouncementConfig',
        args: {
          enabled: FAST_PATH.announcementsEnabled,
          bondToken: FAST_PATH.bondToken,
          bondAmount: FAST_PATH.bondAmount,
          slashRecipient: FAST_PATH.slashRecipient,
          ttlSeconds: FAST_PATH.announcementTtlSeconds,
        },
      }];
      break;
    }

    /**
     * Send tokens to the solver from an admin account.
     *
     * A plain ERC20 transfer, not a mint: the admin holds real balances and
     * minting is whitelisted to the bridge and the PSM, so a transfer is both
     * the available path and the one that does not change supply.
     *
     * USDST IS GAS ON STRATO, so a solver needs it regardless of which token it
     * intends to fill -- without it, it cannot submit anything at all.
     */
    case 'fund': {
      const token = requireAddress(args.token, '--token');
      const to = requireAddress(args.to, '--to');
      if (!args.amount) throw new Error('--amount is required (in wei)');
      console.log(`transfer ${args.amount} of ${token} -> ${to}`);
      calls = [{
        contract: { address: token, name: 'Token' },
        method: 'transfer',
        args: { to, value: String(args.amount) },
      }];
      break;
    }

    /**
     * Post a fee-bearing deposit as the relayer, for testing the fast path.
     *
     * Stands in for an observed external-chain deposit. It produces exactly the
     * record a real one would -- INITIATED, with a committed fee schedule -- so
     * a solver cannot tell the difference and the settlement path is the real
     * one. `requestedAt` is passed explicitly because the decay measures from
     * the ORIGIN chain's clock; backdating it is how you test a partially
     * decayed fee without waiting.
     */
    case 'test-deposit': {
      const chainId = args['chain-id'] || '11155111';
      const externalToken = requireAddress(args['external-token'], '--external-token');
      const target = requireAddress(args['target'], '--target');
      const recipient = requireAddress(args.recipient, '--recipient');
      const sender = requireAddress(args.sender || recipient, '--sender');
      if (!args.amount) throw new Error('--amount required (external units)');
      if (!args['max-fee']) throw new Error('--max-fee required (external units)');
      const txHash = args['tx-hash'] || ('0x' + require('crypto').randomBytes(32).toString('hex'));
      const requestedAt = args['requested-at'] || String(Math.floor(Date.now() / 1000));

      console.log(`test deposit: ${args.amount} of ${externalToken} (chain ${chainId})`);
      console.log(`  -> ${recipient} as ${target}, maxFee ${args['max-fee']}, requestedAt ${requestedAt}`);
      console.log(`  txHash ${txHash}`);
      calls = [{
        contract: { address: requireAddress(args.bridge, '--bridge'), name: 'MercataBridge' },
        method: 'depositWithFee',
        args: {
          externalChainId: chainId,
          externalSender: sender,
          externalToken,
          externalTokenAmount: String(args.amount),
          externalTxHash: txHash,
          stratoRecipient: recipient,
          targetStratoToken: target,
          maxFee: String(args['max-fee']),
          requestedAt,
        },
      }];
      break;
    }

    /**
     * Whitelist an account for one of the bridge's owner-gated methods.
     *
     * WHY THE FAST PATH NEEDS THIS. The bridges are owned by the AdminRegistry,
     * so every `onlyOwner` method is a governance vote UNLESS the caller is
     * whitelisted for that exact method name. The relayer is whitelisted for
     * `deposit`, `confirmDeposit` and friends, which is why it can post
     * deposits with a single transaction -- but a whitelist entry names ONE
     * method, so the fast path's new entry points are not covered by the old
     * grants. Until they are, every fee-bearing deposit needs two admin votes
     * and the relayer cannot post one at all.
     *
     * Methods the relayer needs for the solver fast path:
     *   MercataBridge      depositWithFee, depositBatchWithFee,
     *                      recordWithdrawalClaim, rejectAnnouncement
     *   StratoNativeBridge recordDepositWithFee, recordWithdrawalClaim
     */
    case 'whitelist': {
      const target = requireAddress(args.target, '--target');
      const account = requireAddress(args.account, '--account');
      if (!args.method) throw new Error('--method is required');
      console.log(`vote: addWhitelist(${target}, "${args.method}", ${account})`);
      calls = [{
        contract: { address: '000000000000000000000000000000000000100c', name: 'AdminRegistry' },
        method: 'addWhitelist',
        args: { _target: target, _func: args.method, _user: account },
      }];
      break;
    }

    /** Confirm a deposit: mints, redirecting to a matching claimant. */
    case 'confirm-deposit': {
      calls = [{
        contract: { address: requireAddress(args.bridge, '--bridge'), name: 'MercataBridge' },
        method: 'confirmDeposit',
        args: {
          externalChainId: args['chain-id'] || '11155111',
          externalTxHash: args['tx-hash'],
        },
      }];
      console.log(`vote: confirmDeposit(${args['chain-id']}, ${args['tx-hash']})`);
      break;
    }

    /**
     * Cast a vote for an arbitrary owner-gated method.
     *
     * Exists so that a one-off governance call does not need its own
     * subcommand. Both admins must pass byte-identical --args or the two votes
     * are for different issues and neither reaches the threshold.
     *
     *   admin-call --address <addr> --contract <name> --method <fn> \
     *     --args '{"argName":"value"}' --admin 1
     */
    case 'admin-call': {
      const address = requireAddress(args.address, '--address');
      if (!args.method) throw new Error('--method is required');
      if (!args.contract) throw new Error('--contract is required');
      let parsed;
      try {
        parsed = JSON.parse(args.args || '{}');
      } catch (e) {
        throw new Error(`--args is not valid JSON: ${e.message}`);
      }
      console.log(`vote: ${args.method}(${JSON.stringify(parsed)}) on ${address}`);
      calls = [{
        contract: { address, name: args.contract },
        method: args.method,
        args: parsed,
      }];
      break;
    }

    default:
      console.error(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
      throw new Error(`unknown subcommand: ${subcommand}`);
  }

  const results = await callListAndWait(calls);
  const final = Array.isArray(results) ? results[0] : results;
  console.log(`status: ${final && final.status}`);
  const message = final && final.txResult && final.txResult.message;
  if (message) console.log(`node message: ${message}`);
  console.log(
    'An owner-gated call on an AdminRegistry-owned contract only takes effect ' +
    'once the vote threshold is met. Confirm with `show` before treating it as live.'
  );
}

main().catch((e) => {
  console.error('FAILED: ' + e.message);
  process.exit(1);
});
