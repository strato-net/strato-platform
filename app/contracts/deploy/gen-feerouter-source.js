// Build the deployable FeeRouter source: the canonical contract plus a thin subclass
// that names what the router cannot look up for itself on that network.
//
//   - STRATO was deployed after genesis, so its address differs per network (and
//     helium's STRATO address is a different token on upquark).
//   - The canonical STRATO/USDST PoolV3 the fee is priced from. Neither network has
//     one yet, so it is passed explicitly; without it every transaction that is not
//     covered by a voucher fails, which is never what a deployment wants.
//   - Helium's genesis MercataGovernance (logic 0xff behind the 0x100 proxy) predates
//     staking and has no stakingContract() to ask, so the subclass names the staking
//     proxy. Upquark names none: until its governance can answer, the router still
//     pays fees, but never notifies staking.
//
// None of these can live in storage — payFees is DELEGATECALLed and SolidVM storage
// is name-keyed, so a state read there resolves against the signer, not the router.
//
//   node gen-feerouter-source.js [helium|upquark] --pool <poolAddress> [--activate <block>] [--min-liquidity <L>] [contractName]
//   node gen-feerouter-source.js <stakingAddress> --pool <poolAddress> [contractName]   (helium STRATO)
//
// --activate: the block from which the router burns STRATO and pays rewards; before
// it the router charges the legacy fee (voucher, else 0.01 USDST to FeeCollector)
// and can be installed early. It must equal that network's `stratoGasForkBlock`
// (strato-conf Model.hs), so fees and the native token switch at the same block.
//
// --min-liquidity: the pool liquidity (PoolV3 `liquidity()`, about sqrt(STRATO wei x
// USDST wei) for a full-range position) below which the router stops pricing and
// freezes the last quote. Required for upquark: without a floor
// an emptied pool still serves its last tick from the observation ring, so the
// router would quote a stale price forever (seen live on helium 2026-10-23). Read the
// seeded pool's liquidity from `strato-gas-helium.js status` and pass a fraction of it.
//
// --block-reward: STRATO wei paid per block to the proposer (default 0.01 STRATO);
// 0 switches block rewards off.
//
// Before installing, check the pool prices: once the router is deployed, read
// stratoFeeQuote() after a block has run payBlockRewards; `valid` stays false until
// the pool's observation ring covers the TWAP window.
const path = require('path');
const fs = require('fs');

const NETWORKS = require('./networks');
const OUT = 'feerouter-source.txt';

const isAddress = (a) => /^[0-9a-fA-F]{40}$/.test(a);
const argv = process.argv.slice(2);
const poolIdx = argv.indexOf('--pool');
const pool = poolIdx >= 0 ? (argv[poolIdx + 1] || '').replace(/^0x/, '') : '';
if (!isAddress(pool)) {
  console.error('FAILED: --pool <address> is required: the canonical STRATO/USDST PoolV3 the fee is priced from');
  process.exit(1);
}
const activateIdx = argv.indexOf('--activate');
const activate = activateIdx >= 0 ? argv[activateIdx + 1] : '';
if (activateIdx >= 0 && !/^[0-9]+$/.test(activate)) {
  console.error('FAILED: --activate <block> takes a block number');
  process.exit(1);
}
const minLiquidityIdx = argv.indexOf('--min-liquidity');
const minLiquidity = minLiquidityIdx >= 0 ? argv[minLiquidityIdx + 1] : '';
if (minLiquidityIdx >= 0 && !/^[1-9][0-9]*$/.test(minLiquidity)) {
  console.error('FAILED: --min-liquidity <L> takes a positive pool liquidity');
  process.exit(1);
}
const blockRewardIdx = argv.indexOf('--block-reward');
const blockReward = blockRewardIdx >= 0 ? argv[blockRewardIdx + 1] : '';
if (blockRewardIdx >= 0 && !/^[0-9]+$/.test(blockReward)) {
  console.error('FAILED: --block-reward <wei> takes a STRATO amount in wei (0 switches rewards off)');
  process.exit(1);
}
const flagValues = [poolIdx, activateIdx, minLiquidityIdx, blockRewardIdx].filter(i => i >= 0).map(i => i + 1);
const positional = argv.filter((a, i) => !['--pool', '--activate', '--min-liquidity', '--block-reward'].includes(a) && !flagValues.includes(i));

const arg = (positional[0] || 'helium').replace(/^0x/, '');
let network;
if (NETWORKS[arg]) {
  network = { ...NETWORKS[arg], label: arg };
} else if (isAddress(arg)) {
  network = { ...NETWORKS.helium, staking: arg, label: 'helium' };
} else {
  console.error(`FAILED: expected ${Object.keys(NETWORKS).join('|')} or a 20-byte staking address, got ${arg}`);
  process.exit(1);
}
const NAME = positional[1] || network.name;
if (network.label === 'upquark' && !minLiquidity) {
  console.error('FAILED: upquark needs --min-liquidity <L>: an unfloored router keeps quoting a drained pool');
  process.exit(1);
}

const base = fs.readFileSync(
  path.join(__dirname, '../concrete/Staking/FeeRouter.sol'),
  'utf8'
);

const stakingOverride = network.staking ? `
    // The StratoStaking *Proxy*, whose address is stable across logic upgrades, so
    // this never needs to be redeployed for a staking upgrade.
    function _stakingFallback() internal view override returns (address) {
        return address(0x${network.staking});
    }
` : '';

const activationOverride = activate ? `
    // Fees burn STRATO and rewards flow from this block, the network's
    // stratoGasForkBlock; until then the router charges the legacy fee.
    function _activationBlock() internal view override returns (uint) {
        return ${activate};
    }
` : '';

const liquidityOverride = minLiquidity ? `
    // Below this pool liquidity the router stops pricing and the last quote stays
    // frozen until the pool refills.
    function _minPoolLiquidity() internal view override returns (uint) {
        return ${minLiquidity};
    }
` : '';

const rewardOverride = blockReward ? `
    // Flat STRATO reward per block paid from the router's balance; zero switches
    // block rewards off.
    function _blockReward() internal view override returns (uint) {
        return ${blockReward};
    }
` : '';

const subclass = `
// Deployment wiring for ${network.label}. Installed with
// DeciderState(0xDEC1DE02).updatePayFeeContract.
contract record ${NAME} is FeeRouter {
    function _strato() internal view override returns (address) {
        return address(0x${network.strato});
    }

    // The canonical STRATO/USDST PoolV3. Replacing it is a new router, and the new
    // pool prices nothing until its observation ring covers the TWAP window.
    function _pool() internal view override returns (address) {
        return address(0x${pool});
    }
${stakingOverride}${activationOverride}${liquidityOverride}${rewardOverride}}
`;

fs.writeFileSync(OUT, base.trimEnd() + '\n' + subclass);
console.log(`${OUT} written: ${fs.statSync(OUT).size} bytes | ${network.label} | contract ${NAME} | ` +
  `STRATO ${network.strato} | pool ${pool} | staking ${network.staking || '(governance only)'} | activation ${activate || 'genesis'} | liquidity floor ${minLiquidity || 'none'} | block reward ${blockReward || '1e16'}`);
