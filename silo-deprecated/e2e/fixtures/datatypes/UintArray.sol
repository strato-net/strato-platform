contract UintArray {
  uint[] val;

  mapping (uint => uint[]) uintMap;

  function UintArray(uint[] value) {
    val = value;
    uintMap[0] = value;
  }

  function set(uint[] newvar) {
      val = newvar;
  }

  function get() returns(uint[]) {
      return val;
  }
}
