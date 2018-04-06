contract A {
  uint b;

  function A(){
    b = 1;
  }
}

contract Contract {
  A val;

  function Contract() {
    val = new A();
  }

  function set(A newvar) {
      val = newvar;
  }

  function get() returns(A) {
      return val;
  }
}
