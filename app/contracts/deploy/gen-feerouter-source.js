// Build the deployable FeeRouter source: the canonical contract plus a thin subclass
// that names the staking contract. Helium's genesis MercataGovernance (logic 0xff
// behind the 0x100 proxy) predates staking and has no stakingContract() to ask, and
// the address cannot live in storage — payFees is DELEGATECALLed and SolidVM storage
// is name-keyed, so a state read there resolves against the signer, not the router.
//
//   node gen-feerouter-source.js [stakingAddress] [contractName]
const path = require('path');
const fs = require('fs');

const STAKING = (process.argv[2] || 'd6726e06c3c71a3bad80b5eb6925707a31729b81').replace(/^0x/, '');
const NAME = process.argv[3] || 'HeliumFeeRouter';
const OUT = 'feerouter-source.txt';

if (!/^[0-9a-fA-F]{40}$/.test(STAKING)) {
  console.error(`FAILED: not a 20-byte address: ${STAKING}`);
  process.exit(1);
}

const base = fs.readFileSync(
  path.join(__dirname, '../concrete/Staking/FeeRouter.sol'),
  'utf8'
);

const subclass = `
// Deployment wiring for helium. ${STAKING} is the StratoStaking *Proxy*, whose
// address is stable across logic upgrades, so this never needs to be redeployed for
// a staking upgrade. Installed with DeciderState(0xDEC1DE02).updatePayFeeContract.
contract record ${NAME} is FeeRouter {
    function _stakingFallback() internal view override returns (address) {
        return address(0x${STAKING});
    }
}
`;

fs.writeFileSync(OUT, base.trimEnd() + '\n' + subclass);
console.log(`${OUT} written: ${fs.statSync(OUT).size} bytes | contract ${NAME} | staking ${STAKING}`);
