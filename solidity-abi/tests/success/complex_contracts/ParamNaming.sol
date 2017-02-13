contract ParamNaming {
  function f(uint key, uint value) { ... }
  function g() {
    // named arguments
    f({value: 2, key: 3});
  }
  // omitted parameters
  function func(uint k, uint) returns(uint) {
    return k;
  }
}