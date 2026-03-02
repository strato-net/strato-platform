// GET /api/cdp/vaults/:asset → VaultData | null
const schemas = pm.require('@blockapps/mercata-schema');
const data = pm.response.json();
console.log("[CDP vault] enter", { type: typeof data });

const schema = {
  anyOf: [
    { type: "null" },
    schemas.cdpVaultData
  ]
};

pm.test("Schema matches expected vault or null", function(){
  pm.response.to.have.jsonSchema(schema);
});

if (data) {
  pm.test("asset is 40-hex", ()=> pm.expect(schemas.hex40(data.asset)).to.be.true);
  pm.test("uint strings", ()=>{
    pm.expect(schemas.isUintString(data.collateralAmount)).to.be.true;
    pm.expect(schemas.isUintString(data.collateralValueUSD)).to.be.true;
    pm.expect(schemas.isUintString(data.debtAmount)).to.be.true;
    pm.expect(schemas.isUintString(data.debtValueUSD)).to.be.true;
    pm.expect(schemas.isUintString(data.scaledDebt)).to.be.true;
    pm.expect(schemas.isUintString(data.rateAccumulator)).to.be.true;
  });
  pm.test("ratios and factors are numbers", ()=>{
    pm.expect(data.collateralizationRatio).to.be.a("number");
    pm.expect(data.liquidationRatio).to.be.a("number");
    pm.expect(data.healthFactor).to.be.a("number");
    pm.expect(data.stabilityFeeRate).to.be.a("number");
  });
  pm.test("health in enum", ()=>{
    pm.expect(["healthy","warning","danger"]).to.include(data.health);
  });
}

console.log("[CDP vault] exit", { isNull: data === null });

