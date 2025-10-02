// GET /api/cdp/vaults → VaultData[]
const schemas = pm.require('@blockapps/mercata-schema');
const data = pm.response.json();
console.log("[CDP vaults] enter", { count: Array.isArray(data) ? data.length : null });

pm.test("Body is an array", () => pm.expect(data).to.be.an("array"));

const schema = {
  type: "array",
  items: schemas.cdpVaultData
};

pm.test("Schema matches expected vault shape[]", function(){
  pm.response.to.have.jsonSchema(schema);
});

// Use utility function for validation
schemas.validateArrayItems(data, (item, label) => {
  if (label === "Vault[0]" && item && item.asset) {
    pm.variables.set("cdpFirstAsset", item.asset);
  }
  pm.test(`${label}: asset is 40-hex`, ()=> pm.expect(schemas.hex40(item.asset)).to.be.true);
  pm.test(`${label}: uint strings`, ()=>{
    pm.expect(schemas.isUintString(item.collateralAmount)).to.be.true;
    pm.expect(schemas.isUintString(item.collateralValueUSD)).to.be.true;
    pm.expect(schemas.isUintString(item.debtAmount)).to.be.true;
    pm.expect(schemas.isUintString(item.debtValueUSD)).to.be.true;
    pm.expect(schemas.isUintString(item.scaledDebt)).to.be.true;
    pm.expect(schemas.isUintString(item.rateAccumulator)).to.be.true;
  });
  pm.test(`${label}: ratios and factors are numbers`, ()=>{
    pm.expect(item.collateralizationRatio).to.be.a("number");
    pm.expect(item.liquidationRatio).to.be.a("number");
    pm.expect(item.healthFactor).to.be.a("number");
    pm.expect(item.stabilityFeeRate).to.be.a("number");
  });
  pm.test(`${label}: health in enum`, ()=>{
    pm.expect(["healthy","warning","danger"]).to.include(item.health);
  });
}, "Vault");

console.log("[CDP vaults] exit", { firstAsset: pm.variables.get("cdpFirstAsset") });


