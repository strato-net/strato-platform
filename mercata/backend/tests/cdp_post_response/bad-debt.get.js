// GET /api/cdp/bad-debt → BadDebt[]
const schemas = pm.require('@blockapps/mercata-schema');
const data = pm.response.json();
console.log("[CDP bad-debt] enter", { count: Array.isArray(data) ? data.length : null });

pm.test("Body is an array", () => pm.expect(data).to.be.an("array"));

const schema = {
  type: "array",
  items: schemas.cdpBadDebt
};

pm.test("Schema matches expected bad debt list", function(){
  pm.response.to.have.jsonSchema(schema);
});

// Use utility function for validation
schemas.validateArrayItems(data, (item, label) => {
  pm.test(`${label}: asset is 40-hex`, ()=> pm.expect(schemas.hex40(item.asset)).to.be.true);
  pm.test(`${label}: badDebt is uint string`, ()=> pm.expect(schemas.isUintString(item.badDebt)).to.be.true);
}, "BadDebt");

console.log("[CDP bad-debt] exit");

