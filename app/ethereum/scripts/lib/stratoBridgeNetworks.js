const DEFAULT_MERCATA_BRIDGE = "0x0000000000000000000000000000000000001008";

const STRATO_BRIDGES = {
  "114784819836269": {
    eab: DEFAULT_MERCATA_BRIDGE,
    native: "0x49f69252b00235030a4dcd4c7ef17a64ef346258",
    dependencies: {
      poolFactory: "0x000000000000000000000000000000000000100a",
      poolV3Factory: "0xe6b6f05a88e649e4102a801aade9a6bae02f352d",
      directMintPsm: "0x0b30adc5f2d90bada37afa699b75f485f04e7287",
      metalForge: "0xc5ed981b816a626981a5747d125e0e7296b2c7c6",
      saveUsdstVault: "0xceeb982f671b4ee2b4471e5b49f3126739537f15",
      priceOracle: "0x0000000000000000000000000000000000001002",
    },
  },
  "33056204878082667": {
    eab: DEFAULT_MERCATA_BRIDGE,
    native: "0x4d9e9c39180a75091b9c35bbb9064d67c7fdde5a",
    dependencies: {
      poolFactory: "0x000000000000000000000000000000000000100a",
      poolV3Factory: "0x5d630126d908b46bcf8d00bc15e591a459375809",
      directMintPsm: "0xb1efdc86eecfbedf83d0295671214fee451786f3",
      metalForge: "0x1cc5bad32dc8667878fa7c53cc5cfd6e76fdb113",
      saveUsdstVault: "0x22550671fcad04a213697ac7ae4f4366e96446ed",
      priceOracle: "0x0000000000000000000000000000000000001002",
    },
  },
};

module.exports = { DEFAULT_MERCATA_BRIDGE, STRATO_BRIDGES };
