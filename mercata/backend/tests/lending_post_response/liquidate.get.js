// GET /api/lend/liquidate → liquidatable loans array
const schemas = pm.require('@blockapps/mercata-schema');
const data = pm.response.json();
console.log("[Lending liquidate] enter", { count: Array.isArray(data) ? data.length : null });

pm.test("Body is an array", () => pm.expect(data).to.be.an("array"));

const schema = {
  type: "array",
  items: schemas.lendingLiquidationEntry
};

pm.test("Schema matches liquidatable loans", function(){
  pm.response.to.have.jsonSchema(schema);
});

// Use utility function for validation
schemas.validateArrayItems(data, (item, label) => {
  pm.test(`${label}: addresses`, ()=>{
    pm.expect(schemas.hex40(item.user), `${label}.user`).to.be.true;
    pm.expect(schemas.hex40(item.asset), `${label}.asset`).to.be.true;
  });
  pm.test(`${label}: healthFactor < 1`, ()=> pm.expect(item.healthFactor).to.be.below(1));
  pm.test(`${label}: uint strings`, ()=>{
    pm.expect(schemas.isUintString(item.amount), `${label}.amount`).to.be.true;
    if (item.maxRepay) pm.expect(schemas.isUintString(item.maxRepay), `${label}.maxRepay`).to.be.true;
  });
}, "Liquidatable");

console.log("[Lending liquidate] exit");
