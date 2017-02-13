contract InternalCalls {
  function g(uint a) returns (uint ret) { return f(); }
  function f() returns (uint ret) { return g(7) + f(); }
}