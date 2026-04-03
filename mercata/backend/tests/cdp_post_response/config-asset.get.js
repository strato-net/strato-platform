// GET /api/cdp/config/:asset → AssetConfig | null
const schemas = pm.require('@blockapps/mercata-schema');
const data = pm.response.json();
console.log("[CDP config asset] enter", { isNull: data === null });

const schema = {
  anyOf: [
    { type: "null" },
    schemas.cdpAssetConfig
  ]
};

pm.test("Schema matches expected asset config or null", function(){
  pm.response.to.have.jsonSchema(schema);
});

if (data) {
  pm.test("asset is 40-hex", ()=> pm.expect(schemas.hex40(data.asset)).to.be.true);
  pm.test("uint strings for limits", ()=>{
    pm.expect(schemas.isUintString(data.debtFloor)).to.be.true;
    pm.expect(schemas.isUintString(data.debtCeiling)).to.be.true;
    pm.expect(schemas.isUintString(data.unitScale)).to.be.true;
  });
}

console.log("[CDP config asset] exit");

