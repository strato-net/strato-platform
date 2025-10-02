// GET /api/cdp/admin/all-configs → AssetConfig[] (same shape as /assets)
const schemas = pm.require('@blockapps/mercata-schema');
const data = pm.response.json();
console.log("[CDP admin all-configs] enter", { count: Array.isArray(data) ? data.length : null });

pm.test("Body is an array", () => pm.expect(data).to.be.an("array"));

const schema = {
  type: "array",
  items: schemas.cdpAssetConfig
};

pm.test("Schema matches expected admin configs", function(){
  pm.response.to.have.jsonSchema(schema);
});

// Use utility function for validation
schemas.validateArrayItems(data, (item, label) => {
  pm.test(`${label}: asset is 40-hex`, ()=> pm.expect(schemas.hex40(item.asset)).to.be.true);
  pm.test(`${label}: uint strings for limits`, ()=>{
    if (item.debtFloor) pm.expect(schemas.isUintString(item.debtFloor)).to.be.true;
    pm.expect(schemas.isUintString(item.debtCeiling)).to.be.true;
    pm.expect(schemas.isUintString(item.unitScale)).to.be.true;
  });
}, "AdminConfig");

console.log("[CDP admin all-configs] exit");

