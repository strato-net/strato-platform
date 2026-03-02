// GET /api/cdp/liquidatable → VaultData[] (with borrower)
const schemas = pm.require('@blockapps/mercata-schema');
const data = pm.response.json();
console.log("[CDP liquidatable] enter", { count: Array.isArray(data) ? data.length : null });

pm.test("Body is an array", () => pm.expect(data).to.be.an("array"));

const schema = {
  type: "array",
  items: schemas.cdpVaultDataWithBorrower
};

pm.test("Schema matches expected liquidatable vaults", function(){
  pm.response.to.have.jsonSchema(schema);
});

// Use utility function for validation
schemas.validateArrayItems(data, (item, label) => {
  pm.test(`${label}: addresses`, ()=>{
    pm.expect(schemas.hex40(item.asset)).to.be.true;
    pm.expect(schemas.hex40(item.borrower)).to.be.true;
  });
  pm.test(`${label}: healthFactor < 1`, ()=> pm.expect(item.healthFactor).to.be.below(1));
}, "Liquidatable");

console.log("[CDP liquidatable] exit");

