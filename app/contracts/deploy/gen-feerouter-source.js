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
//   node gen-feerouter-source.js [helium|upquark] --pool <poolAddress> [--activate <block>] [contractName]
//   node gen-feerouter-source.js <stakingAddress> --pool <poolAddress> [contractName]   (helium STRATO)
//
// --activate: the block from which the router burns STRATO and pays rewards; before
// it the router charges the legacy fee (voucher, else 0.01 USDST to FeeCollector)
// and can be installed early. It must equal that network's `stratoGasForkBlock`
// (strato-conf Model.hs), so fees and the native token switch at the same block.
//
// Before installing, check the pool prices: once the router is deployed, read
// stratoFeeQuote() after a block has run payBlockRewards; `valid` stays false until
// the pool's observation ring covers the TWAP window.
const path = require('path');
const fs = require('fs');

const NETWORKS = {
  helium: {
    strato: '8ee9a3391e38176feebf5d43cb2c1d6c4f728b04',
    staking: 'd6726e06c3c71a3bad80b5eb6925707a31729b81',
    name: 'HeliumFeeRouter',
  },
  upquark: {
    strato: '2ca3e170e6714282da77815f7864b17f612f5f83',
    staking: null,
    name: 'UpquarkFeeRouter',
  },
};
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
const flagValues = [poolIdx, activateIdx].filter(i => i >= 0).map(i => i + 1);
const positional = argv.filter((a, i) => !['--pool', '--activate'].includes(a) && !flagValues.includes(i));

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
${stakingOverride}${activationOverride}}
`;

fs.writeFileSync(OUT, base.trimEnd() + '\n' + subclass);
console.log(`${OUT} written: ${fs.statSync(OUT).size} bytes | ${network.label} | contract ${NAME} | ` +
  `STRATO ${network.strato} | pool ${pool} | staking ${network.staking || '(governance only)'} | activation ${activate || 'genesis'}`);
