// GET /api/cdp/bad-debt/juniors/:account → JuniorNote | null
const schemas = pm.require('@blockapps/mercata-schema');
const data = pm.response.json();
console.log("[CDP junior-notes] enter", { isNull: data === null });

const schema = {
  anyOf: [
    { type: "null" },
    schemas.cdpJuniorNote
  ]
};

pm.test("Schema matches expected junior note or null", function(){
  pm.response.to.have.jsonSchema(schema);
});

if (data) {
  pm.test("owner is 40-hex", ()=> pm.expect(schemas.hex40(data.owner)).to.be.true);
  pm.test("uint strings", ()=>{
    pm.expect(schemas.isUintString(data.capUSDST)).to.be.true;
    pm.expect(schemas.isUintString(data.entryIndex)).to.be.true;
    pm.expect(schemas.isUintString(data.claimableAmount)).to.be.true;
  });
}

console.log("[CDP junior-notes] exit");

