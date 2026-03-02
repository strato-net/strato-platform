// GET /api/cdp/admin/global-paused → { isPaused: boolean }
const data = pm.response.json();
console.log("[CDP admin global-paused] enter");

const schema = {
  type: "object",
  required: ["isPaused"],
  properties: {
    isPaused: { type: "boolean" }
  },
  additionalProperties: true
};

pm.test("Schema matches expected", function(){
  pm.response.to.have.jsonSchema(schema);
});

pm.test("isPaused is boolean", ()=> pm.expect(typeof data.isPaused).to.equal("boolean"));

console.log("[CDP admin global-paused] exit", { isPaused: data.isPaused });

