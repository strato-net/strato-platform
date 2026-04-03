// GET /api/lend/collateral → Collateral/token list for user
const schemas = pm.require('@blockapps/mercata-schema');
const data = pm.response.json();
console.log("[Lending collateral] enter", { count: Array.isArray(data) ? data.length : null });

pm.test("Body is an array", () => pm.expect(data).to.be.an("array"));

const schema = {
  type: "array",
  items: schemas.lendingCollateralInfo
};

pm.test("Schema matches expected collateral list", function(){
  pm.response.to.have.jsonSchema(schema);
});

// Use utility function for validation
schemas.validateArrayItems(data, (item, label) => {
  pm.test(`${label}: addresses`, ()=>{
    pm.expect(schemas.hex40(item.address)).to.be.true;
    pm.expect(schemas.hex40(item._owner)).to.be.true;
  });
  pm.test(`${label}: uint strings`, ()=>{
    ["_totalSupply","userBalance","userBalanceValue","collateralizedAmount","collateralizedAmountValue","maxBorrowingPower","assetPrice"].forEach(k => pm.expect(schemas.isUintString(item[k])).to.be.true);
  });
}, "Collateral");

console.log("[Lending collateral] exit");

