contract C {
  function get%T() returns (%T[]) {
    %T[] result;
    // This line really shouldn't be necessary,
    // but for some reason, result is persistent.
    result.length = 0;
    result.push(%T(0x0));
    result.push(%T(0x1));
    result.push(%T(0x2));
    return result;
  }

  function getbool() returns (bool[]) {
    bool[] result;
    result.length = 0;
    result.push(true);
    result.push(false);
    result.push(true);
    return result;
  }

  enum E {A, B, C}
  function getEnum() returns (E[]) {
    E[] result;
    result.length = 0;
    result.push(E.A);
    result.push(E.B);
    result.push(E.C);
    return result;
  }
}
