// GET /api/lend/liquidity → liquidity + balances + metrics
const schemas = pm.require('@blockapps/mercata-schema');
const data = pm.response.json();
console.log("[Lending liquidity] enter", { type: typeof data });

pm.test("Body is an object", () => pm.expect(data).to.be.an("object"));

const schema = {
  type: "object",
  required: [
    "supplyable","withdrawable","totalUSDSTSupplied","totalBorrowed","utilizationRate",
    "availableLiquidity","totalCollateralValue","supplyAPY","maxSupplyAPY","borrowAPY","exchangeRate"
  ],
  properties: {
    supplyable: { type: "object" },
    withdrawable: { type: "object" },
    totalUSDSTSupplied: schemas.baseUintString,
    totalBorrowed: schemas.baseUintString,
    utilizationRate: { type: "number" },
    availableLiquidity: schemas.baseUintString,
    totalCollateralValue: schemas.baseUintString,
    supplyAPY: { type: "number" },
    maxSupplyAPY: { type: "number" },
    borrowAPY: { type: "number" },
    exchangeRate: schemas.baseUintString,
    borrowIndex: { type: "string" },
    reservesAccrued: { type: "string" },
    totalAmountOwed: { type: "string" },
    totalAmountOwedPreview: { type: "string" },
    totalBorrowPrincipal: { type: "string" }
  },
  additionalProperties: true
};

pm.test("Schema matches liquidity object", function(){
  pm.response.to.have.jsonSchema(schema);
});

pm.test("Numeric strings validate", ()=>{
  [data.totalUSDSTSupplied, data.totalBorrowed, data.availableLiquidity, data.totalCollateralValue, data.exchangeRate].forEach(v=> pm.expect(schemas.isUintString(v)).to.be.true);
});

pm.test("APYs are numbers", ()=>{
  pm.expect(data.supplyAPY).to.be.a("number");
  pm.expect(data.maxSupplyAPY).to.be.a("number");
  pm.expect(data.borrowAPY).to.be.a("number");
});

console.log("[Lending liquidity] exit");

