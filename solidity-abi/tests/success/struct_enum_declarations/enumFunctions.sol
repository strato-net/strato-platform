contract C {
  enum E { A, B, C }

  function f(E x) {}
  function g() returns (E) {}
  function h(E x) returns (E) {}
  function fi(uint8 x) {}
  function gi() returns (uint8) {}
  function hi(uint8 x) returns (uint8) {}
}
