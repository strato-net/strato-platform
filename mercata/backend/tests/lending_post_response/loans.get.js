// GET /api/lend/loans → user's loan simulation object
const schemas = pm.require('@blockapps/mercata-schema');
const data = pm.response.json();
console.log("[Lending loans] enter", { type: typeof data });

pm.test("Body is an object", () => pm.expect(data).to.be.an("object"));

// Schema is flexible; check presence of core fields when loan exists
const coreFields = [
  "scaledDebt","lastUpdated","totalAmountOwed","healthFactor","healthFactorRaw",
  "totalBorrowingPowerUSD","totalCollateralValueUSD","maxAvailableToBorrowUSD",
  "interestRate","isAboveLiquidationThreshold"
];

pm.test("Loan object has core metrics", ()=>{
  coreFields.forEach(k => pm.expect(data).to.have.property(k));
});

pm.test("Numeric strings in metrics where applicable", ()=>{
  ["scaledDebt","lastUpdated","totalAmountOwed","healthFactorRaw","totalBorrowingPowerUSD","totalCollateralValueUSD","maxAvailableToBorrowUSD","interestRate"].forEach(k => {
    if (data[k] !== undefined) pm.expect(schemas.isUintString(String(data[k]))).to.be.true;
  });
});

pm.test("healthFactor is number", ()=> pm.expect(data.healthFactor).to.be.a("number"));
pm.test("isAboveLiquidationThreshold is boolean", ()=> pm.expect(data.isAboveLiquidationThreshold).to.be.a("boolean"));

console.log("[Lending loans] exit");

