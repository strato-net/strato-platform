const common = require('../lib/common');
const config = common.config;
const constants = common.constants;
const api = common.api;
const util = common.util;
const assert = common.assert;
const itShould = common.itShould;
const User = common.model.User
const Contract = common.model.Contract;
const Call = common.model.Call;

const lib = require("blockapps-js");

// ---------------------------------------------------
//   test suites
// ---------------------------------------------------

describe('132250301_public-variables', function() {
  this.timeout(config.timeout);

  var publicVarContract=`
contract C {
  int public x;
  int y;
  int private z;
}
`

  lib.setProfile("strato-dev", config.getStratoUrl());
  var vars = 
    lib.Solidity(publicVarContract).
      get("xabi").
      get("vars");

  it('should report "int public x" as public', function(done) {
    return vars.get("x").then(function(x) {
      if (x.public) done();
      else done(new Error("failed"));
    })
  });

  it('should not report "int y" as public', function(done) {
    return vars.get("y").then(function(y) {
      if (!y.public) done();
      else done(new Error("failed"));
    })
  })

  it('should not report "int private z" as public.  Workaround in effect: z may be absent', function(done) {
    return vars.get("z").then(function(z) {
      if (!z || !z.public) done();
      else done(new Error("failed"));
    })
  })
});
