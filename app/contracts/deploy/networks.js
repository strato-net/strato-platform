// Per-network STRATO token and staking proxy the fee router is generated against
// and the STRATO whitelist votes target.
module.exports = {
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
  // Mainnet fork for rehearsals: no block rewards, so no staking fallback.
  forktest: {
    strato: 'ac621a150f49198036f84ffe90b4f2286b623583',
    staking: null,
    name: 'ForktestFeeRouter',
  },
};
