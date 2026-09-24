// Build the deployable FeeRouter source: the canonical contract plus a thin subclass
// that names what the router cannot look up for itself on that network.
//
//   - STRATO was deployed after genesis, so its address differs per network (and
//     helium's STRATO address is a different token on upquark).
//   - Helium's genesis MercataGovernance (logic 0xff behind the 0x100 proxy) predates
//     staking and has no stakingContract() to ask, so the subclass names the staking
//     proxy. Upquark names none: until its governance can answer, the router sends
//     the whole USDST fee to the FeeCollector, as DeciderState's own payFees does.
//
// Neither address can live in storage — payFees is DELEGATECALLed and SolidVM storage
// is name-keyed, so a state read there resolves against the signer, not the router.
//
//   node gen-feerouter-source.js [helium|upquark] [contractName]
//   node gen-feerouter-source.js <stakingAddress> [contractName]   (helium STRATO)
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

const arg = (process.argv[2] || 'helium').replace(/^0x/, '');
const isAddress = (a) => /^[0-9a-fA-F]{40}$/.test(a);
let network;
if (NETWORKS[arg]) {
  network = { ...NETWORKS[arg], label: arg };
} else if (isAddress(arg)) {
  network = { ...NETWORKS.helium, staking: arg, label: 'helium' };
} else {
  console.error(`FAILED: expected ${Object.keys(NETWORKS).join('|')} or a 20-byte staking address, got ${arg}`);
  process.exit(1);
}
const NAME = process.argv[3] || network.name;

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

const subclass = `
// Deployment wiring for ${network.label}. Installed with
// DeciderState(0xDEC1DE02).updatePayFeeContract.
contract record ${NAME} is FeeRouter {
    function _strato() internal view override returns (address) {
        return address(0x${network.strato});
    }
${stakingOverride}}
`;

fs.writeFileSync(OUT, base.trimEnd() + '\n' + subclass);
console.log(`${OUT} written: ${fs.statSync(OUT).size} bytes | ${network.label} | contract ${NAME} | ` +
  `STRATO ${network.strato} | staking ${network.staking || '(governance only)'}`);
