// GET /api/lend/pools → Registry row (object)
const schemas = pm.require('@blockapps/mercata-schema');
const data = pm.response.json();
console.log("[Lending pools] enter", { type: typeof data });

pm.test("Body is an object", () => pm.expect(data).to.be.an("object"));

const registrySchema = {
  type: "object",
  required: ["address", "lendingPool", "oracle", "collateralVault", "liquidityPool"],
  properties: {
    address: schemas.baseAddress,
    lendingPool: {
      type: "object",
      required: ["mToken", "address", "userLoan", "borrowIndex", "lastAccrual", "assetConfigs", "debtCeilingUSD", "borrowableAsset", "reservesAccrued", "totalScaledDebt", "debtCeilingAsset"],
      properties: {
        mToken: schemas.baseAddress,
        address: schemas.baseAddress,
        userLoan: { type: "array" },
        borrowIndex: { type: "number" },
        lastAccrual: { type: "number" },
        assetConfigs: {
          type: "array",
          items: schemas.lendingAssetConfig
        },
        debtCeilingUSD: { type: "number" },
        borrowableAsset: schemas.baseAddress,
        reservesAccrued: { type: "number" },
        totalScaledDebt: { type: "number" },
        debtCeilingAsset: { type: "number" }
      }
    },
    oracle: {
      type: "object",
      required: ["prices", "address"],
      properties: {
        prices: {
          type: "array",
          items: {
            type: "object",
            required: ["asset", "price"],
            properties: {
              asset: schemas.baseAddress,
              price: schemas.baseUintString
            }
          }
        },
        address: schemas.baseAddress
      }
    },
    collateralVault: {
      type: "object",
      required: ["address", "userCollaterals"],
      properties: {
        address: schemas.baseAddress,
        userCollaterals: {
          type: "array",
          items: {
            type: "object",
            required: ["user", "asset", "amount"],
            properties: {
              user: schemas.baseAddress,
              asset: schemas.baseAddress,
              amount: schemas.baseUintString
            }
          }
        }
      }
    },
    liquidityPool: {
      type: "object",
      required: ["address"],
      properties: {
        address: schemas.baseAddress
      }
    }
  },
  additionalProperties: true
};

pm.test("Schema matches registry structure", function(){
  pm.response.to.have.jsonSchema(registrySchema);
});

// Use utility functions for validation
schemas.validateAddresses(data, [
  'address', 'lendingPool.address', 'lendingPool.mToken', 'lendingPool.borrowableAsset',
  'oracle.address', 'collateralVault.address', 'liquidityPool.address'
]);

pm.test("Asset configs have valid addresses and uint strings", ()=>{
  data.lendingPool.assetConfigs.forEach((config, i) => {
    pm.expect(schemas.hex40(config.asset), `assetConfigs[${i}].asset`).to.be.true;
    const cfg = config.AssetConfig;
    ["ltv","interestRate","reserveFactor","liquidationBonus","perSecondFactorRAY","liquidationThreshold"].forEach(k => {
      pm.expect(schemas.isUintString(cfg[k]), `assetConfigs[${i}].AssetConfig.${k}`).to.be.true;
    });
  });
});

pm.test("Oracle prices have valid addresses and uint strings", ()=>{
  data.oracle.prices.forEach((price, i) => {
    pm.expect(schemas.hex40(price.asset), `oracle.prices[${i}].asset`).to.be.true;
    pm.expect(schemas.isUintString(price.price), `oracle.prices[${i}].price`).to.be.true;
  });
});

pm.test("User collaterals have valid addresses and uint strings", ()=>{
  data.collateralVault.userCollaterals.forEach((collateral, i) => {
    pm.expect(schemas.hex40(collateral.user), `userCollaterals[${i}].user`).to.be.true;
    pm.expect(schemas.hex40(collateral.asset), `userCollaterals[${i}].asset`).to.be.true;
    pm.expect(schemas.isUintString(collateral.amount), `userCollaterals[${i}].amount`).to.be.true;
  });
});

console.log("[Lending pools] exit");

