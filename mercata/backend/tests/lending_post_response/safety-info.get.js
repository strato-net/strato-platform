// GET /api/lend/safety/info → SafetyModule info
const schemas = pm.require('@blockapps/mercata-schema');
const data = pm.response.json();
console.log("[Lending safety info] enter", { type: typeof data });

pm.test("Body is an object", () => pm.expect(data).to.be.an("object"));

pm.test("Schema matches safety module info", function(){
  pm.response.to.have.jsonSchema(schemas.safetyModuleInfo);
});

pm.test("Uint strings validate", ()=>{
  schemas.validateUintStrings(data, [
    'totalAssets', 'totalShares', 'userShares', 'userCooldownStart',
    'cooldownSeconds', 'unstakeWindow', 'exchangeRate', 'cooldownTimeRemaining',
    'unstakeWindowTimeRemaining'
  ]);
});

pm.test("Booleans validate", ()=>{
  pm.expect(data.canRedeem).to.be.a("boolean");
  pm.expect(data.cooldownActive).to.be.a("boolean");
});

console.log("[Lending safety info] exit");
